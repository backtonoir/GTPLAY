// ==================================================
// GTPLAY CREATOR STATS PAGE (creator.html)
// --------------------------------------------------
// Halaman pribadi untuk content creator:
//   /creator?code=KODE#key=RAHASIA
// Kunci ada di bagian # sehingga tidak ikut terkirim ke
// server mana pun saat halaman dibuka. Data diambil lewat
// RPC creator_stats (migration_v15_referral.sql).
// ==================================================

(function () {
  const { h, $, formatRupiah, formatDateTime, toast } = GT.utils;
  const root = $("#creatorRoot");

  function stat(label, value, sub) {
    return h("div", { class: "creator-stat card" },
      h("span", { class: "help" }, label),
      h("strong", {}, value),
      sub ? h("span", { class: "help" }, sub) : null);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(GT.t("Copied."), "success");
    } catch (error) {
      window.prompt(GT.t("Copy this link:"), text);
    }
  }

  function render(data) {
    const link = `${window.location.origin}/?ref=${encodeURIComponent(data.code)}`;
    const discount = data.kind === "percent"
      ? GT.t("{value}% off", { value: data.value }) + (data.maxDiscount ? ` (${GT.t("max {amount}", { amount: formatRupiah(data.maxDiscount) })})` : "")
      : GT.t("{amount} off", { amount: formatRupiah(data.value) });

    const nameEl = h("h2", { class: "card-title" });
    nameEl.textContent = data.creator; // Nama creator: jangan diterjemahkan.

    const linkInput = h("input", { class: "input mono", value: link, readonly: true, "aria-label": GT.t("Your referral link") });
    linkInput.addEventListener("focus", () => linkInput.select());

    root.replaceChildren(
      h("div", { class: "stack" },
        h("div", { class: "card creator-profile" },
          h("div", {},
            nameEl,
            h("p", { class: "help" },
              GT.t("Code"), " ", h("code", { class: "coupon-code" }, data.code), " · ", discount, " · ",
              data.active ? GT.t("Active") : GT.t("Inactive"))
          ),
          h("div", { class: "field" },
            h("label", { class: "label" }, "Your referral link"),
            h("div", { class: "coupon-row-input" }, linkInput,
              h("button", { type: "button", class: "btn btn-primary", onclick: () => copy(link) }, "Copy")),
            h("p", { class: "help" }, "Put this link in your video description or bio. Buyers who open it get your code applied automatically on the payment page.")
          )
        ),
        h("div", { class: "creator-stat-grid" },
          stat(GT.t("Orders this month"), String(data.month.orders)),
          stat(GT.t("Sales this month"), formatRupiah(data.month.revenue)),
          data.commissionPct ? stat(GT.t("Commission this month"), formatRupiah(data.month.commission), `${data.commissionPct}%`) : null,
          stat(GT.t("Total orders"), String(data.allTime.orders), formatRupiah(data.allTime.revenue)),
          data.commissionPct ? stat(GT.t("Total commission"), formatRupiah(data.allTime.commission)) : null
        ),
        h("div", { class: "card" },
          h("h2", { class: "card-title" }, "Latest orders"),
          data.recent.length === 0
            ? h("p", { class: "help" }, "No orders with your code yet. Share your link!")
            : h("div", { class: "data-table-wrap" },
                h("table", { class: "data-table" },
                  h("thead", {}, h("tr", {},
                    h("th", {}, "Date"), h("th", {}, "GrowID"), h("th", { class: "num" }, "Total"), h("th", {}, "Status"))),
                  h("tbody", {}, data.recent.map(o => {
                    const grow = h("td", { class: "mono" });
                    grow.textContent = o.growId;
                    return h("tr", {},
                      h("td", {}, formatDateTime(o.createdAt)),
                      grow,
                      h("td", { class: "num" }, formatRupiah(o.total)),
                      h("td", {}, o.status === "paid"
                        ? h("span", { class: "status-badge tone-ok" }, "Paid")
                        : h("span", { class: "status-badge tone-muted" }, "Waiting for payment")));
                  }))
                )
              ),
          h("p", { class: "help" }, "Only paid orders count toward sales and commission. GrowIDs are partly hidden for privacy.")
        )
      )
    );
  }

  async function start() {
    const code = GT.utils.getParam("code") || "";
    const key = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key") || "";
    if (!code || !key) {
      root.replaceChildren(h("div", { class: "state-block" },
        h("p", { class: "state-title" }, "Link incomplete"),
        h("p", { class: "state-text" }, "Open the full creator stats link you got from the admin.")));
      return;
    }
    try {
      render(await GT.api.creatorStats(code, key));
    } catch (error) {
      root.replaceChildren(h("div", { class: "state-block" },
        h("p", { class: "state-title" }, "Can't open this page"),
        h("p", { class: "state-text" }, error.message)));
    }
  }

  GT.layout.init().catch(() => {});
  start();
})();
