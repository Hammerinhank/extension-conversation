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

  if (!isGoogleSite) return { isGoogleSite: false, titles: [] };

  // 2. Groupes réductibles : en-têtes repliables (aria-expanded),
  //    hors menu de navigation du site.
  const seen = new Set();
  const titles = [];
  document.querySelectorAll("[aria-expanded]").forEach((el) => {
    if (el.closest('nav, [role="navigation"], header')) return;
    if (el.matches("input, select, textarea")) return;
    const text = (el.innerText || el.textContent || "")
      .split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (!text) return;
    const key = text + "|" + (el.getBoundingClientRect().top | 0);
    if (seen.has(key)) return;
    seen.add(key);
    titles.push(text);
  });

  return { isGoogleSite: true, titles };
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
    setStatus("Page Google Sites détectée ✔", true);

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
