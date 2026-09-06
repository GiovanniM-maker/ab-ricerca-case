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

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline/promises";
import {
  HERE, PAGES, TARGETS, sources, pause, isBlocked, pageUrl, slugFor,
  savePage, saveBlocked, actLikeAHuman, diagnose,
} from "./common.mjs";

const PROFILE = join(HERE, ".profile");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

        if (isBlocked(html, title)) {
          blocks++;
          // Salviamo il muro cosi' com'e': senza, "bloccato" resta una nostra
          // supposizione e non si distingue un captcha vero da un falso
          // positivo del rilevatore. Fuori da pages/, che e' solo roba buona.
          saveBlocked(source, blocks, html);
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

        savePage(source, slugFor(base), n, html);
        saved++;
        console.log(`  ✓ ${slugFor(base)} p${n} (${Math.round(html.length / 1024)} KB)`);
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

if (argv.includes("--blocked")) {
  diagnose();
} else if (argv.includes("--login")) {
  await login(args[0]);
} else {
  const list = argv.includes("--all") ? sources() : args;
  if (!list.length) {
    console.log("Uso: node fetch.mjs [--login] <fonte> | --all");
    console.log("Fonti: " + sources().join(", "));
    process.exit(1);
  }
  // Le fonti che hanno bisogno di un login le lasciamo scritte qui: e' cosi'
  // che crawl.command sa per quali aprire la finestra a fine giro.
  const needsLogin = [];
  for (const s of list) {
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
