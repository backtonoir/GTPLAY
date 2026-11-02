// GTPLAY v3.7 (discount, reviews, ID/EN)
// ==================================================
// GTPLAY LANGUAGE (Bahasa Indonesia / English)
// --------------------------------------------------
// • Pilihan bahasa disimpan di perangkat (localStorage).
//   Default: bahasa browser (Indonesia → ID, lainnya → EN).
// • Teks statis di HTML diterjemahkan otomatis bila isinya
//   persis ada di kamus (js/i18n-dict.js).
// • Teks dari JavaScript diterjemahkan lewat GT.utils.h()
//   dan GT.t("Teks {variabel}", { variabel }).
// • Ganti bahasa = halaman dimuat ulang, jadi semua bagian
//   (termasuk yang dibuat JS) ikut berganti.
// Menambah terjemahan: tambahkan pasangan [English, Indonesia]
// di js/i18n-dict.js.
// ==================================================

window.GT = window.GT || {};

(function () {
  const KEY = "gtplay:lang";
  const norm = value => String(value).replace(/\s+/g, " ").trim();

  function detect() {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "en" || saved === "id") return saved;
    } catch (error) {
      /* storage diblokir */
    }
    return /^(id|in|ms)\b/i.test(navigator.language || "") ? "id" : "en";
  }

  const lang = detect();
  const enToId = new Map();
  const idToEn = new Map();
  const english = new Set();

  // Pasangan [English, Indonesia] atau [English, Indonesia, teksLamaDiHTML]
  // (teks lama = kalimat yang di HTML sudah berbahasa Indonesia).
  (GT.i18nPairs || []).forEach(([en, id, source]) => {
    enToId.set(norm(en), id);
    english.add(norm(en));
    if (!idToEn.has(norm(id))) idToEn.set(norm(id), en);
    if (source) {
      enToId.set(norm(source), id);
      idToEn.set(norm(source), en);
    }
  });

  function lookup(text) {
    const key = norm(text);
    if (!key) return null;
    if (lang === "id") {
      const hit = enToId.get(key);
      return hit === undefined ? null : hit;
    }
    // Teks yang sudah berbahasa Inggris tidak diubah.
    if (english.has(key)) return null;
    const hit = idToEn.get(key);
    return hit === undefined || hit === key ? null : hit;
  }

  GT.t = function (text, vars) {
    const source = String(text);
    const found = lookup(source);
    const out = found === null ? source : found;
    return vars ? out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : out;
  };

  // ------------------------------------------------
  // HTML STATIS
  // ------------------------------------------------

  const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "svg", "TEXTAREA", "CODE"]);
  const INLINE = new Set(["A", "STRONG", "EM", "SPAN", "BR", "B", "I", "SMALL", "TIME", "S"]);
  const ATTRS = ["placeholder", "aria-label", "title", "alt"];

  function inlineOnly(el) {
    return Array.from(el.children).every(child => INLINE.has(child.tagName) && inlineOnly(child));
  }

  function translateAttrs(el) {
    ATTRS.forEach(name => {
      const value = el.getAttribute(name);
      if (!value) return;
      const hit = lookup(value);
      if (hit !== null) el.setAttribute(name, hit);
    });
  }

  function walk(el) {
    if (SKIP.has(el.tagName) || el.hasAttribute("data-i18n-skip")) return;
    translateAttrs(el);

    if (el.children.length === 0 || inlineOnly(el)) {
      const hit = lookup(el.innerHTML);
      if (hit !== null) {
        // Isi kamus statis milik website (bukan data pengguna).
        if (/[<&]/.test(hit)) el.innerHTML = hit;
        else el.textContent = hit;
        return;
      }
      if (el.children.length === 0) return;
    }

    Array.from(el.children).forEach(walk);
  }

  function translatePage() {
    document.documentElement.lang = lang;
    const title = lookup(document.title);
    if (title !== null) document.title = title;
    if (document.body) walk(document.body);
  }

  // ------------------------------------------------
  // TOMBOL BENDERA
  // ------------------------------------------------

  function set(next) {
    if (next !== "en" && next !== "id") return;
    try {
      window.localStorage.setItem(KEY, next);
    } catch (error) {
      /* tetap ganti untuk halaman ini */
    }
    if (next !== lang) window.location.reload();
  }

  function bindSwitch() {
    document.querySelectorAll("[data-lang]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
      button.addEventListener("click", () => set(button.dataset.lang));
    });
  }

  GT.i18n = {
    lang,
    locale: lang === "id" ? "id-ID" : "en-GB",
    set,
    translate: walk
  };

  translatePage();
  bindSwitch();
})();
