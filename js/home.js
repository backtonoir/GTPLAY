// GTPLAY v3.7 (discount, reviews, ID/EN)
// ==================================================
// GTPLAY LANDING PAGE (index.html)
// --------------------------------------------------
// Status server, harga Blue Gem Lock, download client,
// dan pengumuman terbaru.
// ==================================================

(function () {
  const { h, $, formatRupiah, formatDateTime } = GT.utils;

  const dateLong = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(GT.utils.locale(), { day: "numeric", month: "long", year: "numeric" });
  const dateShort = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(GT.utils.locale(), { day: "numeric", month: "short" });
  const number = value => new Intl.NumberFormat("id-ID").format(value);

  // ------------------------------------------------
  // SERVER STATUS
  // ------------------------------------------------

  const statusRoot = $("#serverStatus");

  function statTile(label, value, extra) {
    return h("div", { class: "server-tile" },
      h("p", { class: "server-label" }, label),
      h("p", { class: "server-value" }, value),
      extra || null
    );
  }

  function renderServerStatus(status) {
    if (!status.configured) {
      statusRoot.replaceChildren(
        statTile("Server", h("span", { class: "server-state is-unknown" }, h("span", { class: "dot", "aria-hidden": "true" }), "Coming soon")),
        statTile("Players online", "—"),
        statTile("Active worlds", "—"),
        h("p", { class: "server-note" }, "Live server stats will appear here soon.")
      );
      return;
    }

    if (status.error) {
      statusRoot.replaceChildren(
        statTile("Server", h("span", { class: "server-state is-unknown" }, h("span", { class: "dot", "aria-hidden": "true" }), "Unavailable")),
        statTile("Players online", "—"),
        statTile("Active worlds", "—"),
        h("p", { class: "server-note" }, "Couldn't reach the status service. Retrying shortly.")
      );
      return;
    }

    const notes = [];
    if (status.uptime) notes.push(GT.t("Uptime {time}", { time: status.uptime }));
    if (status.updatedAt) notes.push(GT.t(status.online ? "Updated {time}" : "Last seen {time}", { time: formatDateTime(status.updatedAt) }));

    const has = value => value !== null && value !== undefined;

    statusRoot.replaceChildren(...[
      statTile("Server", h("span", { class: `server-state ${status.online ? "is-online" : "is-offline"}` },
        h("span", { class: "dot", "aria-hidden": "true" }), status.online ? "Online" : "Offline")),
      statTile("Players online", has(status.players) ? number(status.players) : "—"),
      has(status.worlds) ? statTile("Active worlds", number(status.worlds)) : null,
      has(status.peak) ? statTile("Peak online", number(status.peak)) : null,
      h("p", { class: "server-note" }, notes.join(" · "))
    ].filter(Boolean));
  }

  async function loadServerStatus() {
    renderServerStatus(await GT.api.getServerStatus());
  }

  // ------------------------------------------------
  // BLUE GEM LOCK PRICE
  // ------------------------------------------------

  const priceRoot = $("#bglPrice");
  const RANGES = [
    { key: "30", label: "30D", days: 30 },
    { key: "90", label: "90D", days: 90 },
    { key: "365", label: "1Y", days: 365 },
    { key: "all", label: "All", days: null }
  ];
  let allPrices = [];
  let range = "90";

  function filtered() {
    const option = RANGES.find(r => r.key === range);
    if (!option.days || allPrices.length === 0) return allPrices;
    const last = new Date(`${allPrices[allPrices.length - 1].recordedOn}T00:00:00`);
    const from = new Date(last.getTime() - option.days * 86400000);
    const list = allPrices.filter(p => new Date(`${p.recordedOn}T00:00:00`) >= from);
    return list.length ? list : allPrices.slice(-1);
  }

  function renderPrice() {
    if (allPrices.length === 0) {
      priceRoot.replaceChildren(
        h("div", { class: "state-block borderless" },
          h("p", { class: "state-title" }, "No price data yet"),
          h("p", { class: "state-text" }, "The Blue Gem Lock price chart appears once the first price is recorded."))
      );
      return;
    }

    const latest = allPrices[allPrices.length - 1];
    const previous = allPrices.length > 1 ? allPrices[allPrices.length - 2] : null;

    let change = null;
    if (previous) {
      const diff = latest.price - previous.price;
      const pct = previous.price ? (diff / previous.price) * 100 : 0;
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "■";
      const word = diff > 0 ? "up" : diff < 0 ? "down" : "no change";
      change = h("p", { class: `price-change ${diff > 0 ? "is-up" : diff < 0 ? "is-down" : ""}` },
        h("span", { "aria-hidden": "true" }, arrow),
        ` ${diff === 0 ? GT.t("No change") : `${diff > 0 ? "+" : "−"}${formatRupiah(Math.abs(diff))} (${pct > 0 ? "+" : ""}${pct.toFixed(1).replace(".", GT.i18n && GT.i18n.lang === "en" ? "." : ",")}%)`}`,
        h("span", { class: "sr-only" }, ` ${GT.t(word)}`),
        h("span", { class: "muted" }, ` ${GT.t("vs {date}", { date: dateShort(previous.recordedOn) })}`)
      );
    }

    const points = filtered().map(p => ({ date: p.recordedOn, value: p.price }));

    priceRoot.replaceChildren(
      h("div", { class: "price-head" },
        h("div", {},
          h("p", { class: "price-label" }, GT.t("Latest · {date}", { date: dateLong(latest.recordedOn) })),
          h("p", { class: "price-value" }, formatRupiah(latest.price)),
          change
        ),
        h("div", { class: "chips range-chips", role: "group", "aria-label": "Chart range" },
          RANGES.map(option => h("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(range === option.key),
            onclick: () => { range = option.key; renderPrice(); }
          }, option.label))
        )
      ),
      points.length > 1
        ? GT.lineChart(points, {
            label: "Blue Gem Lock price in Rupiah",
            formatValue: value => formatRupiah(value),
            formatDate: dateLong,
            formatDateShort: dateShort
          })
        : h("p", { class: "help" }, "More data points are needed to draw the chart.")
    );
  }

  async function loadPrices() {
    try {
      allPrices = await GT.api.listLockPrices();
      renderPrice();
    } catch (error) {
      priceRoot.replaceChildren(h("div", { class: "state-block borderless" },
        h("p", { class: "state-title" }, "Couldn't load prices"),
        h("button", { type: "button", class: "btn btn-outline", onclick: loadPrices }, "Try again")));
    }
  }

  // ------------------------------------------------
  // DOWNLOADS
  // ------------------------------------------------

  const ICONS = {
    windows: '<path d="M3 5.5 10 4.5v7H3zM11 4.3 21 3v8.5H11zM3 12.5h7v7l-7-1zM11 12.5h10V21l-10-1.4z"/>',
    android: '<path d="M6 9h12v8a1 1 0 0 1-1 1h-1v3h-2v-3h-4v3H8v-3H7a1 1 0 0 1-1-1zM4 9h1v6H4zM19 9h1v6h-1zM7.5 4.5l1.2 1.6A6 6 0 0 1 12 5a6 6 0 0 1 3.3 1.1l1.2-1.6.6.4-1.1 1.6A5.6 5.6 0 0 1 18 8H6a5.6 5.6 0 0 1 2-1.5L6.9 4.9zM9.5 7a.6.6 0 1 0 0 .01zm5 0a.6.6 0 1 0 0 .01z"/>',
    ios: '<path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h8V5zm3 14.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0z"/>',
    mac: '<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v2H8v-2h3v-2H5a2 2 0 0 1-2-2zm2 0v10h14V5z"/>'
  };

  const PLATFORMS = [
    { key: "windows", name: "Windows", hint: "PC / Laptop" },
    { key: "android", name: "Android", hint: "Phone & tablet" },
    { key: "ios", name: "iOS", hint: "iPhone & iPad" },
    { key: "mac", name: "macOS", hint: "MacBook / iMac" }
  ];

  function platformIcon(key) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = ICONS[key]; // ikon statis dari kode ini, bukan data pengguna
    return svg;
  }

  function renderDownloads(links) {
    const root = $("#downloadGrid");
    root.replaceChildren(...PLATFORMS.map(platform => {
      const url = (links && links[platform.key]) || "";
      const available = /^https:\/\//.test(url);

      return h("article", { class: `download-card${available ? "" : " is-soon"}` },
        h("div", { class: "download-icon" }, platformIcon(platform.key)),
        h("div", { class: "download-body" },
          h("h3", {}, platform.name),
          h("p", { class: "muted" }, platform.hint)
        ),
        available
          ? h("a", { class: "btn btn-primary btn-sm", href: url, target: "_blank", rel: "noopener noreferrer" }, "Download")
          : h("span", { class: "soon-badge" }, "Coming soon")
      );
    }));
  }

  // ------------------------------------------------
  // ANNOUNCEMENTS
  // ------------------------------------------------

  async function loadAnnouncements() {
    const root = $("#latestAnnouncements");
    try {
      const list = await GT.api.listAnnouncements(3);
      if (list.length === 0) {
        root.replaceChildren(h("p", { class: "muted" }, "No announcements yet."));
        return;
      }
      root.replaceChildren(...list.map(item => GT.announcementCard(item)));
    } catch (error) {
      root.replaceChildren(h("p", { class: "muted" }, "Couldn't load announcements."));
    }
  }

  // ------------------------------------------------
  // REVIEWS (ulasan asli pembeli, disetujui admin)
  // ------------------------------------------------

  async function loadReviews() {
    const root = $("#reviewList");
    const summary = $("#reviewSummary");
    if (!root) return;

    try {
      const data = await GT.api.listReviews(6);
      if (!data || !data.count) {
        summary.replaceChildren();
        root.replaceChildren(h("div", { class: "state-block borderless" },
          h("p", { class: "state-title" }, "No reviews yet"),
          h("p", { class: "state-text" }, "Buy an item and leave a review once your order is completed."),
          h("a", { class: "btn btn-outline btn-sm", href: "store.html" }, "Visit Store")));
        return;
      }

      summary.replaceChildren(
        GT.stars(data.average),
        h("strong", {}, String(data.average).replace(".", GT.i18n && GT.i18n.lang === "en" ? "." : ",")),
        h("span", { class: "muted" }, GT.t(data.count === 1 ? "from {n} review" : "from {n} reviews", { n: data.count })),
        data.count > data.items.length
          ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: loadReviews }, "↻ Show others")
          : ""
      );
      root.replaceChildren(...data.items.map(item => GT.reviewCard(item)));
    } catch (error) {
      root.replaceChildren(h("p", { class: "muted" }, "Couldn't load reviews."));
    }
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  GT.layout.init().catch(() => {});

  loadServerStatus();
  setInterval(loadServerStatus, Math.max(15, GT.config.SERVER_STATUS_REFRESH_SECONDS || 60) * 1000);

  loadPrices();
  loadReviews();
  loadAnnouncements();

  GT.api.getStoreStatus()
    .then(status => renderDownloads(status && status.downloads))
    .catch(() => renderDownloads({}));
})();
