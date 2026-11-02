// GTPLAY v3.9
// ==================================================
// CHANGELOG PAGE (changelog.html)
// --------------------------------------------------
// Riwayat perubahan (versi, fitur baru, bugfix, dsb.)
// dikelola dari Admin → Changelog (mode Supabase).
// Data awal (seed) dipakai di demo mode.
// ==================================================

window.GT = window.GT || {};

GT.seedChangelog = [
  {
    id: "cl-1",
    version: "3.9",
    title: "GoPay & BCA Payment Support",
    content: "Ditambahkan metode pembayaran GoPay dan Bank BCA selain QRIS. Sistem checkout diperbarui untuk mendukung multiple payment methods.",
    category: "feature",
    publishedOn: "2026-11-01",
    published: true
  },
  {
    id: "cl-2",
    version: "3.8",
    title: "Review System & Star Rating",
    content: "Pembeli yang sudah menyelesaikan pesanan kini bisa memberikan ulasan dan rating bintang. Ulasan ditampilkan di halaman utama setelah disetujui admin.",
    category: "feature",
    publishedOn: "2026-10-20",
    published: true
  },
  {
    id: "cl-3",
    version: "3.7",
    title: "Perbaikan Keamanan Upload Bukti Pembayaran",
    content: "Fixed vulnerability pada upload bukti pembayaran. File validation diperkuat dan storage policy diperbarui.",
    category: "bugfix",
    publishedOn: "2026-10-15",
    published: true
  },
  {
    id: "cl-4",
    version: "3.6",
    title: "GTPS Cloud Server Status Integration",
    content: "Landing page sekarang menampilkan status server real-time (online/offline, jumlah pemain, uptime) dari GTPS Cloud API.",
    category: "improvement",
    publishedOn: "2026-10-10",
    published: true
  },
  {
    id: "cl-5",
    version: "3.5",
    title: "Redeem Code System",
    content: "Admin sekarang bisa generate dan assign redeem code untuk setiap pesanan yang sudah verified. Pembeli melihat kode setelah pesanan completed.",
    category: "feature",
    publishedOn: "2026-10-01",
    published: true
  },
  {
    id: "cl-6",
    version: "3.4",
    title: "Diskon Per-Produk & Harga Coret",
    content: "Admin bisa mengatur diskon persentase dan batas waktu untuk setiap produk. Harga coret otomatis ditampilkan di halaman Store.",
    category: "feature",
    publishedOn: "2026-09-25",
    published: true
  },
  {
    id: "cl-7",
    version: "3.3",
    title: "Optimasi Performa Mobile",
    content: "Layout toko dan checkout dioptimasi untuk layar kecil. Loading time berkurang ~40% dengan lazy-loading gambar dan code splitting.",
    category: "improvement",
    publishedOn: "2026-09-15",
    published: true
  },
  {
    id: "cl-8",
    version: "3.2",
    title: "Fix Double-Open WhatsApp Bug",
    content: "Memperbaiki bug di mana klik tombol WhatsApp membuka dua tab sekaligus. Sekarang hanya membuka satu tab dengan benar.",
    category: "bugfix",
    publishedOn: "2026-09-10",
    published: true
  }
];

// ==================================================
// PAGE MODULE
// ==================================================

(function () {
  "use strict";

  var h = GT.utils.h;
  var $ = GT.utils.$;

  var CATEGORIES = {
    all:         { label: "Semua",       tone: "" },
    feature:     { label: "Feature",     tone: "blue" },
    bugfix:      { label: "Bug Fix",     tone: "danger" },
    improvement: { label: "Improvement", tone: "green" },
    security:    { label: "Security",    tone: "amber" }
  };

  var state = { entries: [], filter: "all" };

  var timeline = $("#changelogTimeline");
  var chips    = $("#changelogChips");

  // ------------------------------------------------
  // DATA
  // ------------------------------------------------

  function loadSeed() {
    return (GT.seedChangelog || [])
      .filter(function (e) { return e.published; })
      .sort(function (a, b) { return (b.publishedOn || "").localeCompare(a.publishedOn || ""); });
  }

  async function fetchEntries() {
    if (!GT.isBackendConfigured || !GT.isBackendConfigured()) {
      return loadSeed();
    }

    try {
      var sb = GT.api._supabase ? await GT.api._supabase() : null;
      if (!sb) return loadSeed();

      var result = await sb.rpc("list_changelog");
      if (result.error) throw result.error;

      return (result.data || []).map(function (row) {
        return {
          id: row.id,
          version: row.version,
          title: row.title,
          content: row.content,
          category: row.category,
          publishedOn: row.published_on
        };
      });
    } catch (err) {
      return loadSeed();
    }
  }

  // ------------------------------------------------
  // RENDER
  // ------------------------------------------------

  function categoryBadge(cat) {
    var meta = CATEGORIES[cat] || CATEGORIES.improvement;
    return h("span", { class: "changelog-badge tone-" + (meta.tone || "muted") }, meta.label);
  }

  function versionBadge(version) {
    return h("span", { class: "changelog-version" }, "v" + version);
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(GT.utils.locale(), { day: "numeric", month: "long", year: "numeric" });
  }

  function entryCard(entry) {
    return h("article", { class: "changelog-card" },
      h("div", { class: "changelog-card-head" },
        h("div", { class: "changelog-card-badges" },
          versionBadge(entry.version),
          categoryBadge(entry.category)
        ),
        h("time", { class: "changelog-card-date", datetime: entry.publishedOn || "" }, formatDate(entry.publishedOn))
      ),
      h("h3", { class: "changelog-card-title" }, entry.title),
      h("p", { class: "changelog-card-body" }, entry.content)
    );
  }

  function filtered() {
    if (state.filter === "all") return state.entries;
    return state.entries.filter(function (e) { return e.category === state.filter; });
  }

  function renderChips() {
    var seen = new Set(state.entries.map(function (e) { return e.category; }));
    var cats = ["all"].concat(Object.keys(CATEGORIES).filter(function (k) { return k !== "all" && seen.has(k); }));

    chips.replaceChildren.apply(chips, cats.map(function (cat) {
      var meta = CATEGORIES[cat] || CATEGORIES.all;
      return h("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(state.filter === cat),
        onclick: function () {
          state.filter = cat;
          renderChips();
          renderTimeline();
        }
      }, meta.label);
    }));
  }

  function renderTimeline() {
    var list = filtered();

    if (list.length === 0) {
      timeline.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, state.filter === "all" ? "Belum ada changelog." : "Tidak ada entri untuk kategori ini."))
      );
      return;
    }

    timeline.replaceChildren.apply(timeline, list.map(function (e) { return entryCard(e); }));
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  async function init() {
    timeline.replaceChildren(
      h("div", { class: "state-block" },
        h("span", { class: "spinner", "aria-hidden": "true" }),
        "Memuat changelog…"
      )
    );

    try {
      state.entries = await fetchEntries();
    } catch (err) {
      state.entries = loadSeed();
    }

    renderChips();
    renderTimeline();
  }

  GT.layout.init().catch(function () {});
  init();
})();
