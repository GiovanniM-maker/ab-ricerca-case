const el = document.getElementById("state");

// Il popup si chiude appena clicchi altrove, ma il lavoro va avanti nel
// service worker: lo stato sta in storage, cosi' riaprendolo lo ritrovi.
chrome.storage.local.get("state").then(({ state }) => {
  if (state) el.textContent = state;
});
chrome.runtime.onMessage.addListener((m) => {
  if (m.type === "state") el.textContent = m.state;
});

document.getElementById("go").onclick = () => {
  el.textContent = "Avvio…";
  chrome.runtime.sendMessage({ type: "start" });
};
document.getElementById("stop").onclick = () => {
  chrome.runtime.sendMessage({ type: "stop" });
  el.textContent = "Fermato.";
};
