#!/usr/bin/env node
/**
 * Piano B: scarica usando Chrome VERO, non un browser guidato da Playwright.
 *
 * Perche' serve. Playwright, anche quando avvia il Chrome installato, lo lancia
 * con una trentina di switch che nessun utente usa mai (--no-first-run,
 * --disable-background-networking, --remote-debugging-pipe…). Quella lista e'
 * essa stessa un'impronta, e PerimeterX la legge. Qui invece Chrome parte da
 * solo, con gli switch normali, e noi ci COLLEGHIAMO al suo debug remoto: dal
 * punto di vista del sito e' una persona che naviga.
 *
 * Nota sul profilo: dal Chrome 136 Google ignora il debug remoto quando si usa
 * il profilo predefinito, apposta per impedire questo. Percio' usiamo un
 * profilo dedicato (.chrome-profile): stesso Chrome, sessione tutta tua, e il
 * tuo browser di ogni giorno resta libero e non viene toccato.
 *
 * USO
 *   node fetch-cdp.mjs streeteasy        # una fonte
 *   node fetch-cdp.mjs --all             # tutte
 *   node fetch-cdp.mjs --manual          # navighi tu, io salvo quello che vedi
 *   node fetch-cdp.mjs --blocked         # cosa ci ha risposto chi blocca
 */

import { existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline/promises";
import {
  HERE, PAGES, TARGETS, sources, pause, isBlocked, pageUrl, slugFor,
  savePage, saveBlocked, sourceOfUrl, actLikeAHuman, diagnose, notify,
} from "./common.mjs";

const PORT = 9222;
const PROFILE = join(HERE, ".chrome-profile");

// Chrome non sta sempre in /Applications: puo' essere nella cartella utente,
// o essere una variante (Beta, Brave, Edge — tutte Chromium, tutte con lo
// stesso debug remoto). Cerchiamolo invece di dare per scontato un percorso.
const CANDIDATES = [
  ["Google Chrome", "/Applications/Google Chrome.app"],
  ["Google Chrome", join(homedir(), "Applications/Google Chrome.app")],
  ["Google Chrome Beta", "/Applications/Google Chrome Beta.app"],
  ["Google Chrome Canary", "/Applications/Google Chrome Canary.app"],
  ["Brave Browser", "/Applications/Brave Browser.app"],
  ["Microsoft Edge", "/Applications/Microsoft Edge.app"],
  ["Chromium", "/Applications/Chromium.app"],
];

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  for (const [bin, app] of CANDIDATES) {
    const exe = join(app, "Contents/MacOS", bin);
    if (existsSync(exe)) return exe;
  }

  // Ultima carta: lo chiediamo a Spotlight, che lo trova ovunque sia.
  for (const id of ["com.google.Chrome", "com.brave.Browser", "com.microsoft.edgemac"]) {
    try {
      const app = execFileSync("mdfind", [`kMDItemCFBundleIdentifier == '${id}'`], {
        encoding: "utf8",
      })
        .split("\n")[0]
        .trim();
      if (!app) continue;
      const bin = app.split("/").pop().replace(/\.app$/, "");
      const exe = join(app, "Contents/MacOS", bin);
      if (existsSync(exe)) return exe;
    } catch {
      /* mdfind assente o indicizzazione spenta: passiamo oltre */
    }
  }
  return null;
}

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok;
  } catch {
    return false;
  }
}

/** Avvia Chrome col debug remoto, se non c'e' gia' un'istanza in ascolto. */
async function ensureChrome() {
  if (await cdpAlive()) {
    console.log(`Mi collego al Chrome gia' in ascolto sulla porta ${PORT}.`);
    return true;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.log("Non trovo nessun browser Chromium. Ho guardato in:");
    for (const [, app] of CANDIDATES) console.log(`  ${app}`);
    console.log("\nSe ce l'hai altrove, indicamelo:");
    console.log('  CHROME_PATH="/percorso/Chrome.app/Contents/MacOS/Google Chrome" node fetch-cdp.mjs streeteasy');
    return false;
  }
  console.log(`Avvio col debug remoto: ${chrome}`);
  spawn(
    chrome,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { detached: true, stdio: "ignore" }
  ).unref();

  for (let i = 0; i < 40; i++) {
    await pause(500, 500);
    if (await cdpAlive()) return true;
  }
  console.log("Chrome non ha aperto la porta di debug. Chiudi ogni finestra di Chrome e riprova.");
  return false;
}

async function connect() {
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  return { browser, ctx };
}

/** Quanto aspettare che una verifica venga risolta prima di rinunciare. */
const WAIT_FOR_HUMAN_MS = 10 * 60 * 1000;

/**
 * Aspetta che la pagina smetta di essere un muro, ricaricandola ogni tanto.
 * Torna true appena passa. La persona risolve il captcha quando se ne accorge:
 * qui non si blocca nessuno in attesa di un INVIO.
 */
async function waitUntilUnblocked(p, url, source) {
  const deadline = Date.now() + WAIT_FOR_HUMAN_MS;
  let announced = false;
  while (Date.now() < deadline) {
    await pause(15000, 25000);
    try {
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await pause(1500, 3000);
      if (!isBlocked(await p.content(), await p.title())) return true;
    } catch {
      /* pagina che non carica: riproviamo al giro dopo */
    }
    const left = Math.round((deadline - Date.now()) / 60000);
    if (!announced && left <= 5) {
      announced = true;
      notify("Flatiron Radar", `${source}: ancora ${left} min per la verifica in Chrome.`);
    }
    console.log(`      … attendo la verifica (ancora ${left} min)`);
  }
  return false;
}

async function crawl(source, ctx) {
  const cfg = TARGETS[source];
  if (!cfg) throw new Error(`fonte sconosciuta: ${source}`);
  const p = await ctx.newPage();

  let saved = 0;
  let blocks = 0;
  let warned = false;
  for (const base of cfg.searches) {
    for (let n = 1; n <= (cfg.pages ?? 1); n++) {
      const url = pageUrl(base, cfg, n);
      if (!url) break;
      try {
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await pause(1500, 3000);
        await actLikeAHuman(p);
        const html = await p.content();
        const title = await p.title();

        if (isBlocked(html, title)) {
          saveBlocked(source, ++blocks, html);
          console.log(`  ⚠︎  bloccato: ${url}`);
          console.log(`      titolo: "${title}" · ${html.length} byte`);

          // Invece di arrenderci e chiedere di rilanciare a mano, portiamo la
          // finestra davanti, avvisiamo e RIPROVIAMO da soli. Cosi' puoi
          // risolvere il captcha quando ti pare e il crawl riparte da solo:
          // e' la differenza fra restare a guardare e fare altro.
          if (!warned) {
            warned = true;
            await p.bringToFront().catch(() => {});
            notify("Flatiron Radar", `${source} chiede una verifica: risolvila in Chrome.`);
          }
          const passed = await waitUntilUnblocked(p, url, source);
          if (!passed) {
            console.log(`\n${source}: la verifica non e' stata risolta, passo oltre.`);
            await p.close();
            return { saved, blocks };
          }
          console.log("  ✓ verifica superata, riprendo");
        }

        const good = await p.content();
        savePage(source, slugFor(base), n, good);
        saved++;
        console.log(`  ✓ ${slugFor(base)} p${n} (${Math.round(good.length / 1024)} KB)`);
      } catch (e) {
        console.log(`  ✗ ${url}: ${e.message.split("\n")[0]}`);
      }
      await pause(3000, 7000);
    }
  }
  await p.close();
  return { saved, blocks };
}

/**
 * Ultima spiaggia: navighi tu nella finestra, io salvo le schede aperte.
 * Nessuna automazione da riconoscere — le pagine le ha chieste una persona.
 */
async function manual(ctx) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    "\nNella finestra di Chrome apri le ricerche che ti interessano, una per\n" +
      "scheda (anche piu' pagine di risultati). Quando sono tutte caricate,\n" +
      "torna qui e premi INVIO: salvo il contenuto di ogni scheda riconosciuta.\n"
  );
  await rl.question("Pronto? INVIO per salvare… ");
  rl.close();

  const counters = {};
  let saved = 0;
  for (const p of ctx.pages()) {
    const url = p.url();
    const source = sourceOfUrl(url);
    if (!source) continue;
    try {
      const html = await p.content();
      const title = await p.title();
      if (isBlocked(html, title)) {
        console.log(`  ⚠︎  ${url} — la scheda mostra un blocco, la salto`);
        continue;
      }
      counters[source] = (counters[source] ?? 0) + 1;
      savePage(source, "manuale", counters[source], html);
      saved++;
      console.log(`  ✓ ${source} — ${url.slice(0, 70)} (${Math.round(html.length / 1024)} KB)`);
    } catch (e) {
      console.log(`  ✗ ${url}: ${e.message.split("\n")[0]}`);
    }
  }
  console.log(`\n${saved} schede salvate in ${PAGES}.`);
  if (!saved) console.log("Nessuna scheda apparteneva a una fonte in targets.json.");
}

const argv = process.argv.slice(2);
const args = argv.filter((a) => !a.startsWith("--"));

if (argv.includes("--blocked")) {
  diagnose();
} else {
  if (!(await ensureChrome())) process.exit(1);
  const { browser, ctx } = await connect();

  if (argv.includes("--manual")) {
    await manual(ctx);
    console.log("Lascio la finestra aperta: le schede ti servono ancora.");
  } else {
    const list = argv.includes("--all") ? sources() : args;
    if (!list.length) {
      console.log("Uso: node fetch-cdp.mjs <fonte> | --all | --manual | --blocked");
      console.log("Fonti: " + sources().join(", "));
      process.exit(1);
    }
    for (const s of list) {
      console.log(`\n→ ${s}`);
      const { saved, blocks } = await crawl(s, ctx);
      console.log(`  ${saved} pagine salvate${blocks ? `, ${blocks} bloccate` : ""}`);
    }
    console.log(`\nHTML in ${PAGES}. Ora estrai con:`);
    console.log(`  cd .. && python3 -m rental_radar.run --source <fonte>`);
    // Chiudiamo solo il Chrome dedicato che abbiamo avviato noi: il tuo
    // browser di ogni giorno gira su un altro profilo e non lo tocchiamo.
    await browser.close().catch(() => {});
  }
}
