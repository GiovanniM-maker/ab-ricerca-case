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

import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

// Import pigro: il modo diagnostico (--blocked) e' proprio quello che lanci
// quando qualcosa non va, e non deve pretendere che Playwright ci sia.
async function open(headless) {
  const { chromium } = await import("playwright");
  mkdirSync(PROFILE, { recursive: true });
  const opts = {
    headless,
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  };

  // Il Chromium che scarica Playwright e' una build "for Testing": si dichiara
  // tale e ha una firma diversa da Chrome vero. Se sul Mac c'e' Chrome usiamo
  // quello: e' il singolo cambiamento che pesa di piu'.
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" });
  } catch {
    ctx = await chromium.launchPersistentContext(PROFILE, opts);
  }

  // navigator.webdriver resta true anche con AutomationControlled disattivato,
  // ed e' il primo controllo che fa qualunque anti-bot.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return ctx;
}

/** Qualche gesto umano: questi sistemi guardano se il mouse si muove. */
async function actLikeAHuman(p) {
  try {
    await p.mouse.move(300 + Math.random() * 500, 200 + Math.random() * 300);
    await pause(200, 600);
    await p.mouse.wheel(0, 400 + Math.random() * 800);
    await pause(400, 900);
    await p.mouse.wheel(0, 400 + Math.random() * 800);
  } catch {
    /* pagina gia' chiusa o navigata: non e' un errore che ci interessa */
  }
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
  // Bloccavamo le immagini per risparmiare banda, ma un browser che carica
  // l'HTML e non scarica una sola foto e' un comportamento che nessun umano
  // ha: era un altro cartello "sono un bot". Fermiamo solo i video.
  await p.route("**/*.{mp4,webm,m4v}", (r) => r.abort());

  let saved = 0;
  let blocks = 0;
  for (const base of cfg.searches) {
    for (let n = 1; n <= (cfg.pages ?? 1); n++) {
      const url = pageUrl(base, cfg, n);
      if (!url) break;
      try {
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await pause(1200, 2500); // lascia idratare la pagina
        await actLikeAHuman(p);
        const html = await p.content();
        const title = await p.title();

        if (blocked(html, title)) {
          blocks++;
          // Salviamo il muro cosi' com'e': senza, "bloccato" resta una nostra
          // supposizione e non si distingue un captcha vero da un falso
          // positivo del rilevatore. Fuori da pages/, che e' solo roba buona.
          const dump = join(HERE, "blocked");
          mkdirSync(dump, { recursive: true });
          writeFileSync(join(dump, `${source}-${blocks}.html`), html);
          console.log(`  ⚠︎  bloccato: ${url}`);
          console.log(`      titolo: "${title}" · ${html.length} byte`);
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

/** Che cosa ci ha risposto davvero chi ci blocca. */
function diagnose() {
  const dir = join(HERE, "blocked");
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  } catch {
    console.log("Nessuna pagina bloccata salvata: o non hai ancora ricrawlato, o non blocca piu'.");
    return;
  }
  const SYSTEMS = [
    ["PerimeterX / HUMAN", ["px-captcha", "perimeterx", "_pxhd", "px-cdn"]],
    ["DataDome", ["captcha-delivery", "datadome", "geo.captcha"]],
    ["Cloudflare", ["cf-chl", "challenge-platform", "cf_chl_opt", "__cf_bm"]],
    ["Akamai", ["_abck", "akam", "bm-verify"]],
    ["Imperva / Incapsula", ["incapsula", "_incap_", "distil"]],
  ];
  for (const f of files) {
    const html = readFileSync(join(dir, f), "utf8");
    const low = html.toLowerCase();
    const hits = SYSTEMS.filter(([, marks]) => marks.some((m) => low.includes(m))).map(([n]) => n);
    const title = (html.match(/<title[^>]*>(.*?)<\/title>/is) || [, "(nessuno)"])[1].trim();
    console.log(`\n${f}  ${Math.round(html.length / 1024)} KB`);
    console.log(`  titolo: ${title.slice(0, 80)}`);
    console.log(`  sistema: ${hits.length ? hits.join(", ") : "non riconosciuto"}`);
    if (!hits.length) console.log(`  inizio: ${html.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

const argv = process.argv.slice(2);
const headed = argv.includes("--headed");
const args = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--blocked")) {
  diagnose();
} else if (argv.includes("--login")) {
  await login(args[0]);
} else {
  const sources = argv.includes("--all") ? Object.keys(TARGETS).filter((k) => k[0] !== "_") : args;
  if (!sources.length) {
    console.log("Uso: node fetch.mjs [--login] <fonte> | --all");
    console.log("Fonti: " + Object.keys(TARGETS).filter((k) => k[0] !== "_").join(", "));
    process.exit(1);
  }
  // Le fonti che hanno bisogno di un login le lasciamo scritte qui: e' cosi'
  // che crawl.command sa per quali aprire la finestra a fine giro.
  const needsLogin = [];
  for (const s of sources) {
    console.log(`\n→ ${s}`);
    let { saved, blocks } = await crawl(s, headed);

    // In headless questi siti riconoscono il browser anche con la sessione
    // giusta: e' la firma piu' facile da leggere che ci sia. Con la finestra
    // visibile spesso passano, quindi prima di arrenderci proviamo cosi'.
    if (!saved && blocks && !headed) {
      console.log("  Bloccato in headless: riprovo con la finestra visibile.");
      ({ saved, blocks } = await crawl(s, true));
    }

    console.log(`  ${saved} pagine salvate${blocks ? `, ${blocks} bloccate` : ""}`);
    if (!saved && blocks) needsLogin.push(s);
  }
  const flag = join(HERE, ".needs-login");
  if (needsLogin.length) writeFileSync(flag, needsLogin.join("\n"));
  else rmSync(flag, { force: true });

  console.log(`\nHTML in ${PAGES}. Ora estrai gli annunci con:`);
  console.log(`  cd .. && python3 -m rental_radar.run --source <fonte>`);
}
