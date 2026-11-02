// GTPLAY v3.9
// ==================================================
// BLACKLIST PAGE
// --------------------------------------------------
// Halaman publik untuk memeriksa apakah GrowID masuk
// daftar blacklist, dan melihat daftar pemain yang
// di-ban dari server GTPLAY.
//
// Mode demo: data dari seedBlacklist di bawah.
// Mode Supabase: data dari tabel `blacklist` lewat
// RPC list_blacklist dan check_blacklist.
// ==================================================

window.GT = window.GT || {};

GT.blacklist = (function () {
  const { h, $, $all, formatDateTime, validateGrowId, toast, debounce } = GT.utils;

  const PAGE_SIZE = 20;
  let state = {
    page: 0,
    entries: [],
    filter: ""
  };

  // ------------------------------------------------
  // SEED DATA (demo mode)
  // ------------------------------------------------

  const seedBlacklist = [
    { id: "bl-1", growId: "Sc4mmer123", reason: "Scamming DLS dari pemain baru", bannedAt: "2026-10-28T10:00:00.000Z", active: true },
    { id: "bl-2", growId: "DupeExploit", reason: "Menggunakan exploit duplikasi item", bannedAt: "2026-10-25T14:30:00.000Z", active: true },
    { id: "bl-3", growId: "HackPlayer99", reason: "Menggunakan cheat/hack di server", bannedAt: "2026-10-20T08:15:00.000Z", active: true },
    { id: "bl-4", growId: "ToxicGamer", reason: "Toxic behavior berulang, harassment pemain lain", bannedAt: "2026-10-15T16:45:00.000Z", active: true },
    { id: "bl-5", growId: "BotFarmer", reason: "Menggunakan bot farming otomatis", bannedAt: "2026-10-10T12:00:00.000Z", active: true },
    { id: "bl-6", growId: "RealMoneyTrd", reason: "Real-money trading (RMT) di luar sistem resmi", bannedAt: "2026-10-05T09:00:00.000Z", active: true },
    { id: "bl-7", growId: "SpamBot2026", reason: "Spam broadcast dan iklan ilegal di world publik", bannedAt: "2026-09-28T11:20:00.000Z", active: true },
    { id: "bl-8", growId: "GrieferKing", reason: "Griefing berulang di world pemain lain", bannedAt: "2026-09-20T17:30:00.000Z", active: true }
  ];

  // ------------------------------------------------
  // DATA LOADING
  // ------------------------------------------------

  // Demo mode helpers
  function seedSearch(growId) {
    var normalized = growId.toLowerCase();
    var found = seedBlacklist.find(function (e) {
      return e.active && e.growId.toLowerCase() === normalized;
    });
    return found
      ? { blacklisted: true, growId: found.growId, reason: found.reason, bannedAt: found.bannedAt }
      : { blacklisted: false };
  }

  async function loadBlacklist() {
    // GT.api.listBlacklist is added by api.js (both demo & supabase adapters).
    if (typeof GT.api.listBlacklist === "function") {
      try {
        state.entries = await GT.api.listBlacklist();
        return;
      } catch (err) {
        console.warn("Blacklist: API unavailable, using seed data.", err);
      }
    }
    // Fallback: demo seed
    state.entries = seedBlacklist.filter(function (e) { return e.active; });
  }

  async function checkGrowId(growId) {
    var normalized = growId.trim();
    // GT.api.checkBlacklist is added by api.js (both demo & supabase adapters).
    if (typeof GT.api.checkBlacklist === "function") {
      try {
        return await GT.api.checkBlacklist(normalized);
      } catch (err) {
        console.warn("Blacklist check: API unavailable, searching seed.", err);
      }
    }
    // Fallback: demo seed
    return seedSearch(normalized);
  }

  // ------------------------------------------------
  // SEARCH RESULT RENDERING
  // ------------------------------------------------

  function renderSearchResult(result, growId) {
    var container = $("#blSearchResult");
    if (!container) return;
    container.textContent = "";

    if (result.blacklisted) {
      var card = h("div", { class: "bl-result bl-result--banned" },
        h("div", { class: "bl-result-icon", "aria-hidden": "true" }, "⛔"),
        h("div", { class: "bl-result-body" },
          h("p", { class: "bl-result-status" }, "BLACKLISTED"),
          h("p", { class: "bl-result-growid" }, result.growId || growId),
          h("p", { class: "bl-result-reason" },
            h("strong", null, "Alasan: "),
            result.reason || "-"
          ),
          result.bannedAt
            ? h("p", { class: "bl-result-date" },
                h("strong", null, "Tanggal ban: "),
                formatDateTime(result.bannedAt)
              )
            : null
        )
      );
      container.append(card);
    } else {
      var card2 = h("div", { class: "bl-result bl-result--clear" },
        h("div", { class: "bl-result-icon", "aria-hidden": "true" }, "✔"),
        h("div", { class: "bl-result-body" },
          h("p", { class: "bl-result-status" }, "CLEAR"),
          h("p", { class: "bl-result-growid" }, growId),
          h("p", { class: "bl-result-detail" }, "GrowID tidak ditemukan dalam daftar blacklist.")
        )
      );
      container.append(card2);
    }
  }

  // ------------------------------------------------
  // TABLE RENDERING
  // ------------------------------------------------

  function filtered() {
    var q = state.filter.toLowerCase();
    if (!q) return state.entries;
    return state.entries.filter(function (e) {
      return e.growId.toLowerCase().includes(q) || (e.reason || "").toLowerCase().includes(q);
    });
  }

  function renderTable() {
    var root = $("#blTableRoot");
    if (!root) return;
    root.textContent = "";

    var list = filtered();
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page >= totalPages) state.page = totalPages - 1;
    var start = state.page * PAGE_SIZE;
    var page = list.slice(start, start + PAGE_SIZE);

    // Filter input
    var filterRow = h("div", { class: "bl-filter" },
      h("input", {
        class: "input",
        type: "text",
        placeholder: "Cari GrowID atau alasan...",
        value: state.filter,
        oninput: debounce(function (e) {
          state.filter = e.target.value;
          state.page = 0;
          renderTable();
        }, 250)
      }),
      h("span", { class: "bl-count" }, list.length + " pemain")
    );

    if (list.length === 0) {
      root.append(
        filterRow,
        h("div", { class: "empty-state" },
          h("p", null, state.filter ? "Tidak ditemukan pemain yang cocok." : "Belum ada pemain dalam daftar blacklist.")
        )
      );
      return;
    }

    // Table
    var thead = h("thead", null,
      h("tr", null,
        h("th", null, "GrowID"),
        h("th", null, "Alasan"),
        h("th", null, "Tanggal Ban")
      )
    );

    var tbody = h("tbody", null,
      ...page.map(function (entry) {
        return h("tr", null,
          h("td", { class: "mono" }, entry.growId),
          h("td", null, entry.reason || "-"),
          h("td", null, formatDateTime(entry.bannedAt))
        );
      })
    );

    var table = h("div", { class: "data-table-wrap" },
      h("table", { class: "data-table" }, thead, tbody)
    );

    // Pagination
    var pagination = null;
    if (totalPages > 1) {
      pagination = h("div", { class: "bl-pagination" },
        h("button", {
          class: "btn btn-ghost btn-sm",
          type: "button",
          disabled: state.page === 0,
          onclick: function () { state.page--; renderTable(); }
        }, "← Sebelumnya"),
        h("span", { class: "bl-page-info" },
          "Halaman " + (state.page + 1) + " dari " + totalPages
        ),
        h("button", {
          class: "btn btn-ghost btn-sm",
          type: "button",
          disabled: state.page >= totalPages - 1,
          onclick: function () { state.page++; renderTable(); }
        }, "Selanjutnya →")
      );
    }

    root.append(filterRow, table);
    if (pagination) root.append(pagination);
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  async function init() {
    GT.layout.init({ cart: true });

    // Wire up search form
    var form = $("#blSearchForm");
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var input = $("#blGrowIdInput");
        var growId = (input ? input.value : "").trim();
        var v = validateGrowId(growId);
        if (!v.ok) {
          toast(v.message, "error");
          return;
        }
        var btn = form.querySelector("button[type=submit]");
        if (btn) { btn.disabled = true; btn.textContent = "Memeriksa..."; }
        try {
          var result = await checkGrowId(v.value);
          renderSearchResult(result, v.value);
        } catch (err) {
          toast("Gagal memeriksa GrowID. Coba lagi.", "error");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Cek GrowID"; }
        }
      });
    }

    // Load and display table
    await loadBlacklist();
    renderTable();
  }

  return { init, loadBlacklist, checkGrowId };
})();

document.addEventListener("DOMContentLoaded", function () { GT.blacklist.init(); });
