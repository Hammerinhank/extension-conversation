const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = "status " + (ok ? "ok" : "ko");
}

// Exécutée dans la page (injectée via chrome.scripting)
function analysePage() {
  // 1. Vérification : page Google Sites ?
  const host = location.hostname;
  const isSitesHost = host === "sites.google.com";
  const hasSitesMarker =
    !!document.querySelector('link[href*="gstatic.com/atari"], script[src*="gstatic.com/atari"]') ||
    !!document.querySelector('meta[name="generator"][content*="Google Sites" i]');
  const isGoogleSite = isSitesHost || hasSitesMarker;

  if (!isGoogleSite) return { isGoogleSite: false, mode: null, titles: [] };

  // 2. Mode : l'éditeur utilise des balises <tile>, la page publiée non.
  const mode = document.querySelector("tile") ? "édition" : "publié";

  // 3. Groupes réductibles = titres (h1..h6) accompagnés d'un chevron (svg).
  //    - page publiée : le chevron est DANS le titre ;
  //    - éditeur      : le chevron est à côté du bloc de texte, dans la même ligne.
  //    Un titre ordinaire n'a pas de svg : il est ignoré.
  const seen = new Set();
  const titles = [];
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.closest('nav, [role="navigation"]')) return;

    let isGroup = !!h.querySelector("svg");
    if (!isGroup) {
      const tile = h.closest("tile");
      isGroup = !!(tile && tile.parentElement && tile.parentElement.querySelector("svg"));
    }
    if (!isGroup) return;

    const text = (h.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    if (!text) return;

    const key = text + "|" + Math.round(h.getBoundingClientRect().top);
    if (seen.has(key)) return;
    seen.add(key);
    titles.push(text);
  });

  return { isGoogleSite: true, mode, titles };
}

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: analysePage,
    });

    if (!result.isGoogleSite) {
      setStatus("Cette page n'est pas une page Google Sites.", false);
      return;
    }
    setStatus("Page Google Sites détectée ✔ (mode " + result.mode + ")", true);

    if (!result.titles.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Aucun groupe réductible trouvé.";
      listEl.appendChild(li);
      return;
    }
    result.titles.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      listEl.appendChild(li);
    });
  } catch (e) {
    setStatus("Impossible d'analyser cette page (" + e.message + ").", false);
  }
})();
