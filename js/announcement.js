// GTPLAY v3.9 (GoPay & BCA)
// ==================================================
// ANNOUNCEMENT PAGE (announcement.html)
// --------------------------------------------------
// Pengumuman dikelola dari Admin → Announcements
// (mode Supabase) — tidak perlu edit file ini lagi.
// ==================================================

(function () {
  const { h, $ } = GT.utils;
  const list = $("#announcementList");

  async function load() {
    list.replaceChildren(h("div", { class: "state-block" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading announcements…"));

    try {
      const items = await GT.api.listAnnouncements();
      if (items.length === 0) {
        list.replaceChildren(h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No announcements yet")));
        return;
      }
      list.replaceChildren(...items.map(item => GT.announcementCard(item)));
    } catch (error) {
      list.replaceChildren(h("div", { class: "state-block" },
        h("p", { class: "state-title" }, "Couldn't load announcements"),
        h("button", { type: "button", class: "btn btn-outline", onclick: load }, "Try again")));
    }
  }

  GT.layout.init().catch(() => {});
  load();
})();
