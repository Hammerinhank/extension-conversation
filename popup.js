const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const controlsEl = $("controls");
const selectEl = $("groupSelect");
const btnOne = $("btnOne");
const btnAll = $("btnAll");
const btnCancel = $("btnCancel");
const progressEl = $("progress");
const progressText = $("progressText");

let tabId = null;
let state = { titles: [], pageTitle: "", url: "", mode: "" };
let cancelled = false;

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = "status " + (ok ? "ok" : "ko");
}

// ---------------------------------------------------------------------------
// Fonction exécutée DANS la page (injectée via chrome.scripting).
// Elle doit être autonome : aucune variable du popup n'y est accessible.
//   action "list"    -> renvoie la liste des titres de groupes réductibles
//   action "extract" -> renvoie { titre, texte } pour le groupe demandé
// ---------------------------------------------------------------------------
function inPage(action, index, expectedTitle) {
  // 1. Page Google Sites ?
  const isGoogleSite =
    location.hostname === "sites.google.com" ||
    !!document.querySelector('link[href*="gstatic.com/atari"], script[src*="gstatic.com/atari"]') ||
    !!document.querySelector('meta[name="generator"][content*="Google Sites" i]');
  if (!isGoogleSite) return { isGoogleSite: false };

  // 2. Mode : l'éditeur utilise des balises <tile>, la page publiée non.
  const mode = document.querySelector("tile") ? "édition" : "publié";
  const clean = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

  // 3. Groupes réductibles = titres (h1..h6) accompagnés d'un chevron (svg).
  //    - page publiée : le chevron est DANS le titre ;
  //    - éditeur      : le chevron est à côté du bloc de texte, dans la même ligne.
  const heads = [];
  const seen = new Set();
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
    if (h.closest('nav, [role="navigation"]')) return;
    let isGroup = !!h.querySelector("svg");
    if (!isGroup) {
      const tile = h.closest("tile");
      isGroup = !!(tile && tile.parentElement && tile.parentElement.querySelector("svg"));
    }
    if (!isGroup) return;
    const text = clean(h.textContent);
    if (!text) return;
    const key = text + "|" + Math.round(h.getBoundingClientRect().top);
    if (seen.has(key)) return;
    seen.add(key);
    heads.push(h);
  });
  const titles = heads.map((h) => clean(h.textContent));

  if (action === "list") {
    return { isGoogleSite: true, mode, titles, pageTitle: document.title, url: location.href };
  }

  // 4. Extraction du texte d'un groupe
  let i = index;
  if (titles[i] !== expectedTitle) i = titles.indexOf(expectedTitle);
  if (i < 0) return { isGoogleSite: true, error: "Groupe introuvable (la page a changé ?)" };
  const h = heads[i];

  // Conteneur du groupe : l'ancêtre « jsname=F57UId » le plus proche qui ne contient
  // aucun autre groupe ; à défaut, le plus grand ancêtre ne contenant que ce groupe.
  const others = heads.filter((x) => x !== h);
  let root = null;
  let best = null;
  for (let el = h.parentElement; el && el !== document.body; el = el.parentElement) {
    if (others.some((o) => el.contains(o))) break;
    best = el;
    if (!root && el.getAttribute("jsname") === "F57UId") root = el;
  }
  const certain = !!root;
  root = root || best;
  if (!root) return { isGoogleSite: true, titre: titles[i], texte: "", avertissement: "Conteneur du groupe introuvable" };

  const SKIP =
    'script, style, noscript, svg, input, select, textarea, [role="toolbar"], [role="tooltip"], ' +
    '[role="listbox"], [role="menu"], [aria-label="Mosaïque"], .n5vXWb';
  const BLOCK = /^(P|DIV|LI|UL|OL|H[1-6]|TR|TABLE|SECTION|BLOCKQUOTE|TILE|ROW)$/;
  let out = "";
  (function walk(n) {
    if (n === h) return; // le titre lui-même n'est pas répété dans le texte
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1 || n.matches(SKIP)) return;
    if (n.tagName === "BR") { out += "\n"; return; }
    const block = BLOCK.test(n.tagName);
    if (block) out += "\n";
    n.childNodes.forEach(walk);
    if (block) out += "\n";
  })(root);

  const texte = out
    .replace(/ /g, " ")
    .split("\n")
    .map((s) => s.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const res = { isGoogleSite: true, titre: titles[i], texte };
  if (!certain) res.avertissement = "Conteneur du groupe deviné : vérifier le texte";
  if (!texte) res.avertissement = "Aucun texte trouvé dans ce groupe";
  return res;
}
// --- fin de la fonction injectée ---

async function run(action, index = 0, expectedTitle = "") {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: inPage,
    args: [action, index, expectedTitle],
  });
  return result;
}

function slug(s) {
  return (
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "groupe"
  );
}

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const pageMeta = () => ({
  titre: state.pageTitle,
  url: state.url,
  mode: state.mode,
  date: new Date().toISOString(),
});

function setBusy(busy) {
  btnOne.disabled = busy;
  btnAll.disabled = busy;
  selectEl.disabled = busy;
  btnCancel.hidden = !busy;
}

async function exportOne() {
  const i = selectEl.selectedIndex;
  if (i < 0) { progressText.textContent = "Sélectionnez d'abord un groupe."; return; }
  setBusy(true);
  btnCancel.hidden = true;
  try {
    const r = await run("extract", i, state.titles[i]);
    if (r.error) throw new Error(r.error);
    const g = { titre: r.titre, texte: r.texte };
    if (r.avertissement) g.avertissement = r.avertissement;
    download({ page: pageMeta(), groupes: [g] }, "groupe-" + slug(r.titre) + ".json");
    progressText.textContent = "Fichier généré : " + r.titre;
    progressText.className = "small" + (r.avertissement ? " warn" : "");
    if (r.avertissement) progressText.textContent += " (" + r.avertissement + ")";
  } catch (e) {
    progressText.textContent = "Erreur : " + e.message;
  } finally {
    setBusy(false);
  }
}

async function exportAll() {
  const n = state.titles.length;
  const groupes = [];
  cancelled = false;
  setBusy(true);
  progressEl.hidden = false;
  progressEl.max = n;
  progressEl.value = 0;
  let warnings = 0;

  try {
    for (let i = 0; i < n; i++) {
      if (cancelled) break;
      progressText.className = "small";
      progressText.textContent = "Groupe " + (i + 1) + " / " + n + " : " + state.titles[i];
      let g;
      try {
        const r = await run("extract", i, state.titles[i]);
        if (r.error) throw new Error(r.error);
        g = { titre: r.titre, texte: r.texte };
        if (r.avertissement) { g.avertissement = r.avertissement; warnings++; }
      } catch (e) {
        g = { titre: state.titles[i], texte: "", erreur: e.message };
        warnings++;
      }
      groupes.push(g);
      progressEl.value = i + 1;
      await new Promise((r) => setTimeout(r, 30)); // laisse l'interface se rafraîchir
    }

    if (cancelled) {
      progressText.textContent = "Annulé (" + groupes.length + " / " + n + " groupes lus, aucun fichier généré).";
    } else {
      download({ page: pageMeta(), groupes }, "groupes-" + slug(state.pageTitle || "page") + ".json");
      progressText.textContent = "Terminé : " + n + " groupes exportés" +
        (warnings ? " (" + warnings + " avertissement(s), voir le fichier)" : "") + ".";
      progressText.className = "small" + (warnings ? " warn" : "");
    }
  } finally {
    setBusy(false);
  }
}

btnOne.addEventListener("click", exportOne);
btnAll.addEventListener("click", exportAll);
btnCancel.addEventListener("click", () => { cancelled = true; });

(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    const r = await run("list");

    if (!r.isGoogleSite) {
      setStatus("Cette page n'est pas une page Google Sites.", false);
      return;
    }
    state = { titles: r.titles, pageTitle: r.pageTitle, url: r.url, mode: r.mode };

    if (!r.titles.length) {
      setStatus("Page Google Sites détectée ✔ (mode " + r.mode + ") — aucun groupe réductible trouvé.", true);
      return;
    }
    setStatus("Page Google Sites détectée ✔ (mode " + r.mode + ") — " + r.titles.length + " groupes", true);

    r.titles.forEach((t, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = (i + 1) + ". " + t;
      selectEl.appendChild(o);
    });
    selectEl.selectedIndex = 0;
    controlsEl.hidden = false;
  } catch (e) {
    setStatus("Impossible d'analyser cette page (" + e.message + ").", false);
  }
})();
