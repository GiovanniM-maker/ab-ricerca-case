/** Parti condivise fra i due modi di scaricare: Playwright (fetch.mjs) e
 *  Chrome vero via debug remoto (fetch-cdp.mjs).
 *
 *  Stanno qui perche' il riconoscimento delle pagine-muro e i percorsi di
 *  salvataggio devono essere identici nei due casi: due copie divergerebbero
 *  e ci ritroveremmo a diagnosticare il salvataggio invece del sito.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const PAGES = join(HERE, "pages");
export const BLOCKED = join(HERE, "blocked");
export const TARGETS = JSON.parse(readFileSync(join(HERE, "targets.json"), "utf8"));

/** Nomi delle fonti configurate (le chiavi con _ sono note, non fonti). */
export const sources = () => Object.keys(TARGETS).filter((k) => k[0] !== "_");

/** Pausa casuale: un ritmo umano riduce il rischio di finire in blacklist. */
export const pause = (min, max) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

/** Riconosce le pagine-muro (captcha, "press & hold", 403) prima di salvarle. */
export function isBlocked(html, title) {
  const t = (title || "").toLowerCase();
  // Prima guardavamo solo i primi 4000 caratteri: i muri che mettono il
  // messaggio piu' in basso passavano indisturbati e finivano fra le pagine
  // buone. Costa poco leggerla tutta.
  const h = html.toLowerCase();
  const marks = [
    "px-captcha",
    "please verify you are a human",
    "access to this page has been denied",
    "are you a robot",
    "captcha-delivery",
    "attention required",
    "request unsuccessful",
    "unusual traffic",
    "enable javascript and cookies",
  ];
  // Una pagina di risultati vera sta sui 300 KB - 1,8 MB. Sotto i 20 KB non
  // e' un elenco di case: e' un muro, un redirect o una pagina vuota.
  return marks.some((m) => h.includes(m) || t.includes(m)) || html.length < 20_000;
}

export function pageUrl(base, cfg, n) {
  if (n === 1) return base;
  if (cfg.pathPage) return base.replace(/\/?$/, "") + cfg.pathPage.replace("{n}", n);
  if (cfg.pageParam)
    return base + (base.includes("?") ? "&" : "?") + `${cfg.pageParam}=${n}`;
  return null;
}

export const slugFor = (base) =>
  base.replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9]+/gi, "-") || "home";

export function savePage(source, slug, n, html) {
  const out = join(PAGES, source);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${slug}-${n}.html`), html);
}

export function saveBlocked(source, i, html) {
  mkdirSync(BLOCKED, { recursive: true });
  writeFileSync(join(BLOCKED, `${source}-${i}.html`), html);
}

/** Da un URL alla fonte che lo riguarda, guardando il dominio in targets.json. */
export function sourceOfUrl(url) {
  for (const s of sources()) {
    for (const search of TARGETS[s].searches) {
      try {
        if (new URL(search).host === new URL(url).host) return s;
      } catch {
        /* URL non valido: semplicemente non e' di nessuna fonte */
      }
    }
  }
  return null;
}

/** Qualche gesto umano: questi sistemi guardano se il mouse si muove. */
export async function actLikeAHuman(p) {
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

/** Che cosa ci ha risposto davvero chi ci blocca. */
export function diagnose() {
  let files = [];
  try {
    files = readdirSync(BLOCKED).filter((f) => f.endsWith(".html"));
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
    const html = readFileSync(join(BLOCKED, f), "utf8");
    const low = html.toLowerCase();
    const hits = SYSTEMS.filter(([, m]) => m.some((x) => low.includes(x))).map(([n]) => n);
    const title = (html.match(/<title[^>]*>(.*?)<\/title>/is) || [, "(nessuno)"])[1].trim();
    console.log(`\n${f}  ${Math.round(html.length / 1024)} KB`);
    console.log(`  titolo: ${title.slice(0, 80)}`);
    console.log(`  sistema: ${hits.length ? hits.join(", ") : "non riconosciuto"}`);
    if (!hits.length) console.log(`  inizio: ${html.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
