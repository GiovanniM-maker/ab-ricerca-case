/**
 * Percorre le ricerche in una scheda del TUO browser e manda l'HTML al
 * raccoglitore locale.
 *
 * Perche' un'estensione e non un browser pilotato. I sistemi anti-bot seri
 * (PerimeterX, DataDome) riconoscono un Chrome aperto al debug remoto: e'
 * proprio la porta che ci serviva per guidarlo a tradirci, al punto che li'
 * dentro il "press and hold" non passa nemmeno facendolo a mano. Un'estensione
 * invece non apre nessuna porta e non pilota niente dall'esterno: apre schede
 * come faresti tu e legge quello che c'e' a schermo. Non c'e' niente da
 * riconoscere perche' non c'e' nessuna automazione, solo il tuo browser.
 */

const COLLECTOR = "http://127.0.0.1:8787";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = (min, max) => sleep(min + Math.random() * (max - min));

let running = false;

async function say(state) {
  await chrome.storage.local.set({ state });
  chrome.runtime.sendMessage({ type: "state", state }).catch(() => {});
}

/** Aspetta che la scheda finisca di caricare, senza restare appesi in eterno. */
function waitForLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const done = (ok) => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function grabHtml(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.outerHTML,
  });
  return res?.result ?? "";
}

async function run() {
  if (running) return;
  running = true;
  let tab;
  try {
    const targets = await (await fetch(`${COLLECTOR}/targets`)).json();
    await say(`0 / ${targets.length}`);

    tab = await chrome.tabs.create({ url: "about:blank", active: true });
    let saved = 0;
    let blocked = 0;

    for (let i = 0; i < targets.length; i++) {
      if (!running) break;
      const t = targets[i];
      await chrome.tabs.update(tab.id, { url: t.url });
      await waitForLoad(tab.id);
      await wait(2000, 4000); // lascia idratare la pagina

      const html = await grabHtml(tab.id).catch(() => "");
      const r = await fetch(
        `${COLLECTOR}/save?source=${encodeURIComponent(t.source)}` +
          `&slug=${encodeURIComponent(t.slug)}&n=${t.n}`,
        { method: "POST", body: html }
      );
      const out = await r.json();

      if (out.saved) saved++;
      else blocked++;
      await say(
        `${i + 1} / ${targets.length} — ${saved} salvate` +
          (blocked ? `, ${blocked} bloccate` : "")
      );

      // Se e' un muro, la scheda e' davanti a te: risolvilo e riprendiamo.
      if (!out.saved && out.reason === "blocked") {
        for (let k = 0; k < 20 && running; k++) {
          await say(`Serve una verifica su ${t.source}. Risolvila in questa scheda…`);
          await wait(15000, 20000);
          const retry = await grabHtml(tab.id).catch(() => "");
          const rr = await fetch(
            `${COLLECTOR}/save?source=${encodeURIComponent(t.source)}` +
              `&slug=${encodeURIComponent(t.slug)}&n=${t.n}`,
            { method: "POST", body: retry }
          );
          if ((await rr.json()).saved) {
            saved++;
            blocked--;
            break;
          }
        }
      }

      await wait(3000, 7000); // ritmo umano
    }

    await fetch(`${COLLECTOR}/done`, { method: "POST" }).catch(() => {});
    await say(`Finito: ${saved} pagine salvate${blocked ? `, ${blocked} no` : ""}.`);
  } catch (e) {
    await say(`Errore: ${e.message}. Il raccoglitore e' avviato?`);
  } finally {
    running = false;
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "start") run();
  if (msg.type === "stop") running = false;
});
