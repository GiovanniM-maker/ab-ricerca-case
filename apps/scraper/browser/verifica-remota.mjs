/**
 * La verifica dal telefono: quando un sito chiede una verifica, una persona la
 * fa davvero, guardando e toccando il Chrome degli agenti a distanza.
 * Niente la risolve da solo: qui si passano solo lo schermo e il dito.
 *
 * La pagina ascolta su 127.0.0.1 e arriva al telefono con tailscale serve, quindi
 * solo dalla tailnet. Passa solo il mouse, mai tastiera o indirizzi; il token vale
 * una verifica e il server si chiude con lei.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORTA = 8474;
const BASE = "https://ggmmachine.tail0e97eb.ts.net:8474";
const ATTESA_MS = 30 * 60 * 1000;
const SALTATA = "/tmp/flatiron-verifica-saltata";

const PAGINA = (sito, t) => `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no">
<title>Verifica ${sito}</title>
<style>body{margin:0;background:#111;color:#eee;font:15px system-ui}p{margin:10px}
img{width:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}</style>
<p>Verifica di <b>${sito}</b>: fai quello che chiede la pagina. Se chiede di tenere premuto, tieni il dito fermo.</p>
<img id=s draggable=false>
<script>
const s=document.getElementById('s'),t=${JSON.stringify(t)};
async function giro(){try{const r=await fetch('/img?t='+t);
 if(r.status==410){document.querySelector('p').textContent='Fatto, il giro riparte da solo. Puoi chiudere.';return}
 const u=URL.createObjectURL(await r.blob());s.onload=()=>URL.revokeObjectURL(u);s.src=u}catch{}
 setTimeout(giro,350)}
giro();
function manda(tipo,e){const b=s.getBoundingClientRect();
 fetch('/m?t='+t,{method:'POST',body:JSON.stringify({tipo,x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height})})}
s.addEventListener('pointerdown',e=>{e.preventDefault();s.setPointerCapture(e.pointerId);manda('move',e);manda('down',e)});
s.addEventListener('pointermove',e=>{if(e.buttons)manda('move',e)});
s.addEventListener('pointerup',e=>manda('up',e));
s.addEventListener('pointercancel',e=>manda('up',e));
s.addEventListener('contextmenu',e=>e.preventDefault());
</script>`;

function oggi() {
  return new Date().toISOString().slice(0, 10);
}

function avvisa(sito, link) {
  // La scheda la manda il sistema, che ha bot e stile.
  const dev = join(homedir(), "sistema-dev");
  execFileSync(join(dev, ".venv/bin/python"), ["-m", "strumenti.flatiron_verifica", sito, link],
    { cwd: dev, env: { ...process.env, DRY_RUN: "0" }, stdio: "inherit" });
}

/**
 * Chiede la verifica e aspetta. true se la pagina non e' piu' un muro.
 * Senza risposta entro 30 minuti le fonti dopo non chiedono: un giro al giorno,
 * una sola attesa a vuoto.
 */
export async function chiediVerifica(p, sito, bloccata) {
  if (existsSync(SALTATA) && readFileSync(SALTATA, "utf8").trim() === oggi()) return false;

  const token = randomBytes(24).toString("hex");
  let finita = false;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.searchParams.get("t") !== token) return res.writeHead(404).end();
    if (u.pathname === "/") {
      return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGINA(sito, token));
    }
    if (finita) return res.writeHead(410).end();
    try {
      if (u.pathname === "/img") {
        const img = await p.screenshot({ type: "jpeg", quality: 60, timeout: 5000 });
        return res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(img);
      }
      if (u.pathname === "/m" && req.method === "POST") {
        let corpo = "";
        for await (const c of req) corpo += c;
        const { tipo, x, y } = JSON.parse(corpo);
        const v = p.viewportSize() ?? (await p.evaluate(() => ({ width: innerWidth, height: innerHeight })));
        if (tipo === "move") await p.mouse.move(x * v.width, y * v.height);
        else if (tipo === "down") await p.mouse.down();
        else if (tipo === "up") await p.mouse.up();
        return res.writeHead(204).end();
      }
    } catch {
      return res.writeHead(503).end(); // la pagina sta cambiando
    }
    res.writeHead(404).end();
  });
  await new Promise((ok, ko) => server.once("error", ko).listen(PORTA, "127.0.0.1", ok));

  try {
    await p.bringToFront().catch(() => {});
    try {
      avvisa(sito, `${BASE}/?t=${token}`);
    } catch (e) {
      console.log(`  scheda non partita: ${e.message.split("\n")[0]}`);
      return false;
    }
    const fine = Date.now() + ATTESA_MS;
    while (Date.now() < fine) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        // Niente ricarica: interromperebbe il dito ancora premuto.
        if (!bloccata(await p.content(), await p.title())) return true;
      } catch {
        /* la pagina sta navigando */
      }
    }
    writeFileSync(SALTATA, oggi());
    return false;
  } finally {
    finita = true;
    await new Promise((r) => setTimeout(r, 1000)); // il telefono legge il 410
    server.close();
    server.closeAllConnections();
  }
}
