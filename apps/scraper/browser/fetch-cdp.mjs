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
import { spawn } from "node:child_process";
import { join } from "node:path";
import readline from "node:readline/promises";
import {
  HERE, PAGES, TARGETS, sources, pause, isBlocked, pageUrl, slugFor,
  savePage, saveBlocked, sourceOfUrl, actLikeAHuman, diagnose,
} from "./common.mjs";

const PORT = 9222;
const PROFILE = join(HERE, ".chrome-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
  if (!existsSync(CHROME)) {
    console.log(`Non trovo Google Chrome in:\n  ${CHROME}\nInstallalo, oppure usa fetch.mjs.`);
    return false;
  }
  console.log("Avvio Chrome col debug remoto…");
  spawn(
    CHROME,
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

async function crawl(source, ctx) {
  const cfg = TARGETS[source];
  if (!cfg) throw new Error(`fonte sconosciuta: ${source}`);
  const p = await ctx.newPage();

  let saved = 0;
  let blocks = 0;
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
          blocks++;
          saveBlocked(source, blocks, html);
          console.log(`  ⚠︎  bloccato: ${url}`);
          console.log(`      titolo: "${title}" · ${html.length} byte`);
          if (blocks >= 3) {
            console.log(
              `\n${source}: bloccato anche con Chrome vero.\n` +
                `La finestra e' aperta: risolvi il captcha a mano su quella scheda,\n` +
                `poi rilancia. Se il muro resta, usa:  node fetch-cdp.mjs --manual`
            );
            await p.close();
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
