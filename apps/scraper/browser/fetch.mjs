#!/usr/bin/env node
/**
 * Scarica le pagine di ricerca dei siti che bloccano gli script (StreetEasy,
 * Zillow, Apartments.com, RentHop) usando un browser VERO sul tuo Mac.
 *
 * Perche' funziona qui e non dal server: quei siti non guardano tanto il login,
 * quanto l'IP e l'impronta del client. Un IP residenziale + Chrome vero passa;
 * un datacenter no, nemmeno loggato. Il profilo persistente serve a tenere la
 * sessione (e il "sei umano" gia' risolto) tra un crawl e l'altro.
 *
 * USO
 *   node fetch.mjs --login streeteasy    # una volta: apre la finestra, ti logghi tu
 *   node fetch.mjs streeteasy            # poi: scarica in silenzio
 *   node fetch.mjs --all                 # tutte le fonti configurate
 *
 * Questo script NON fa parsing: salva solo l'HTML grezzo in pages/<fonte>/.
 * A estrarre gli annunci ci pensa `python3 -m rental_radar.run --source streeteasy`.
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, ".profile");
const PAGES = join(HERE, "pages");
const TARGETS = JSON.parse(readFileSync(join(HERE, "targets.json"), "utf8"));

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Pausa casuale: un ritmo umano riduce il rischio di finire in blacklist. */
const pause = (min, max) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

async function open(headless) {
  mkdirSync(PROFILE, { recursive: true });
  return chromium.launchPersistentContext(PROFILE, {
    headless,
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/** Riconosce le pagine-muro (captcha, "press & hold", 403) prima di salvarle. */
function blocked(html, title) {
  const t = (title || "").toLowerCase();
  const h = html.slice(0, 4000).toLowerCase();
  const marks = [
    "px-captcha",
    "please verify you are a human",
    "access to this page has been denied",
    "are you a robot",
    "captcha-delivery",
    "attention required",
    "request unsuccessful",
  ];
  return marks.some((m) => h.includes(m) || t.includes(m)) || html.length < 5000;
}

function pageUrl(base, cfg, n) {
  if (n === 1) return base;
  if (cfg.pathPage) return base.replace(/\/?$/, "") + cfg.pathPage.replace("{n}", n);
  if (cfg.pageParam)
    return base + (base.includes("?") ? "&" : "?") + `${cfg.pageParam}=${n}`;
  return null;
}

async function login(source) {
  const cfg = TARGETS[source];
  if (!cfg) throw new Error(`fonte sconosciuta: ${source}`);
  const ctx = await open(false);
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.goto(cfg.loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    `\nSi e' aperta una finestra su ${source}.\n` +
      `Loggati (o risolvi il captcha) e naviga a una ricerca qualsiasi per\n` +
      `confermare che i risultati si vedano. La sessione resta salvata in\n` +
      `  ${PROFILE}\n`
  );
  await rl.question("Quando hai finito premi INVIO qui… ");
  rl.close();
  await ctx.close();
  console.log("✓ Sessione salvata. Ora puoi lanciare: node fetch.mjs " + source);
}

async function crawl(source, headed) {
  const cfg = TARGETS[source];
  if (!cfg) throw new Error(`fonte sconosciuta: ${source}`);
  const out = join(PAGES, source);
  mkdirSync(out, { recursive: true });

  const ctx = await open(!headed);
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  // Le immagini sono il grosso del traffico e a noi serve solo l'HTML.
  await p.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,mp4}", (r) => r.abort());

  let saved = 0;
  let blocks = 0;
  for (const base of cfg.searches) {
    for (let n = 1; n <= (cfg.pages ?? 1); n++) {
      const url = pageUrl(base, cfg, n);
      if (!url) break;
      try {
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await pause(1200, 2500); // lascia idratare la pagina
        const html = await p.content();
        const title = await p.title();

        if (blocked(html, title)) {
          blocks++;
          console.log(`  ⚠︎  bloccato: ${url}`);
          if (blocks >= 3) {
            console.log(
              `\n${source}: bloccato 3 volte di fila. Rilancia con:\n` +
                `  node fetch.mjs --login ${source}\n` +
                `risolvi il captcha a mano, poi riprova.`
            );
            await ctx.close();
            return { saved, blocks };
          }
          await pause(8000, 15000);
          continue;
        }

        const slug =
          base.replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9]+/gi, "-") || "home";
        writeFileSync(join(out, `${slug}-${n}.html`), html);
        saved++;
        process.stdout.write(`  ✓ ${slug} p${n} (${Math.round(html.length / 1024)} KB)\n`);
      } catch (e) {
        console.log(`  ✗ ${url}: ${e.message.split("\n")[0]}`);
      }
      await pause(3000, 7000); // ritmo umano tra una pagina e l'altra
    }
  }
  await ctx.close();
  return { saved, blocks };
}

const argv = process.argv.slice(2);
const headed = argv.includes("--headed");
const args = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--login")) {
  await login(args[0]);
} else {
  const sources = argv.includes("--all") ? Object.keys(TARGETS).filter((k) => k[0] !== "_") : args;
  if (!sources.length) {
    console.log("Uso: node fetch.mjs [--login] <fonte> | --all");
    console.log("Fonti: " + Object.keys(TARGETS).filter((k) => k[0] !== "_").join(", "));
    process.exit(1);
  }
  for (const s of sources) {
    console.log(`\n→ ${s}`);
    const { saved, blocks } = await crawl(s, headed);
    console.log(`  ${saved} pagine salvate${blocks ? `, ${blocks} bloccate` : ""}`);
  }
  console.log(`\nHTML in ${PAGES}. Ora estrai gli annunci con:`);
  console.log(`  cd .. && python3 -m rental_radar.run --source <fonte>`);
}
