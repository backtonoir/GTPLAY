// GTPLAY v3.8 (clean URLs)
// ==================================================
// GTPLAY ADMIN DASHBOARD (admin.html)
// --------------------------------------------------
// • SUPABASE MODE: login Supabase Auth (email + password).
//   Hanya akun yang terdaftar di tabel `admins` yang bisa
//   masuk. Setiap aksi dicek ulang oleh RLS / RPC di server
//   — halaman ini tidak menyimpan password apa pun.
// • DEMO MODE: tanpa login; hanya mengelola data demo di
//   browser ini (tidak memengaruhi pembeli lain).
// ==================================================

(function () {
  const {
    h, $, formatRupiah, formatDateTime, toast, statusBadge, STATUS,
    confirmDialog, lockScroll, unlockScroll, debounce
  } = GT.utils;

  const admin = GT.api.admin;
  const root = $("#adminRoot");
  const userSlot = $("#adminUser");

  // ------------------------------------------------
  // ROUTING TAB
  // --------------------------------------------------
  // Saat di-deploy (URL bersih): /admin, /admin/orders, …
  // Saat dibuka sebagai file lokal (admin.html): pakai #hash.
  // Slug URL bisa beda dari key tab (mis. /admin/announcement).
  // ------------------------------------------------

  const TABS = ["overview", "orders", "products", "reviews", "announcements", "prices", "downloads", "server"];
  const TAB_SLUGS = { overview: "", orders: "orders", products: "products", reviews: "reviews", announcements: "announcements", prices: "prices", downloads: "downloads", server: "server" };
  const SLUG_TO_TAB = {
    "": "overview", overview: "overview", orders: "orders", products: "products",
    reviews: "reviews", review: "reviews", announcements: "announcements", announcement: "announcements",
    prices: "prices", price: "prices", "bgl-price": "prices", downloads: "downloads", download: "downloads", server: "server"
  };

  function usePathRouting() {
    const path = window.location.pathname;
    return !/\.html$/i.test(path) && /\/admin(\/|$)/.test(path);
  }

  function slugToTab(slug) {
    slug = String(slug || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(SLUG_TO_TAB, slug) ? SLUG_TO_TAB[slug] : null;
  }

  function tabFromUrl() {
    if (usePathRouting()) {
      const m = window.location.pathname.match(/\/admin\/([^/]+)/);
      const pathTab = m ? slugToTab(decodeURIComponent(m[1])) : null;
      if (pathTab) return pathTab;
      // Fallback ke #hash: bookmark lama admin.html#products → /admin#products.
      const hashTab = slugToTab(window.location.hash.replace("#", ""));
      if (hashTab) return hashTab;
      return m ? null : "overview";
    }
    return slugToTab(window.location.hash.replace("#", ""));
  }

  function urlForTab(key) {
    if (usePathRouting()) {
      const slug = TAB_SLUGS[key] || "";
      return "/admin" + (slug ? "/" + slug : "");
    }
    return "#" + key;
  }

  function goTab(key) {
    state.tab = key;
    try { history.replaceState(null, "", urlForTab(key)); } catch (error) { /* abaikan */ }
    renderDashboard();
  }

  const state = {
    tab: "overview",
    orders: [],
    products: [],
    search: "",
    status: "all",
    session: null,
    reviews: [],
    reviewFilter: "pending"
  };

  const ACTION_LABELS = {
    payment_verified: { label: "Verify Payment", style: "btn-primary" },
    processing: { label: "Mark Processing", style: "btn-outline" },
    completed: { label: "Mark Completed", style: "btn-primary" },
    rejected: { label: "Reject Payment", style: "btn-danger", needsNote: true },
    cancelled: { label: "Cancel Order", style: "btn-danger" }
  };

  // ------------------------------------------------
  // MODAL HELPERS
  // ------------------------------------------------

  function openModal(title, body, options) {
    const previous = document.activeElement;
    const closeBtn = h("button", { type: "button", class: "icon-button", "aria-label": "Close" }, "×");
    const modal = h("div", {
      class: `modal${options && options.wide ? " modal-wide" : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title
    },
      h("div", { class: "modal-head" }, h("h2", { class: "modal-title" }, title), closeBtn),
      body
    );
    const overlay = h("div", { class: "modal-overlay" }, modal);

    function close() {
      overlay.classList.remove("show");
      document.removeEventListener("keydown", onKey);
      unlockScroll();
      setTimeout(() => overlay.remove(), 200);
      if (previous && previous.focus) previous.focus();
    }

    function onKey(event) {
      // Modal bertumpuk (mis. generator di atas form) → Escape menutup yang paling atas saja.
      const overlays = document.querySelectorAll(".modal-overlay");
      if (event.key === "Escape" && overlays[overlays.length - 1] === overlay) close();
    }

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", event => { if (event.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
    lockScroll();
    // Fokus langsung (bukan di frame berikutnya) agar ketikan
    // pengguna tidak "berpindah" ke field pertama.
    const first = modal.querySelector("input:not(.sr-only), textarea, select");
    (first || closeBtn).focus();
    requestAnimationFrame(() => overlay.classList.add("show"));

    return close;
  }

  function promptDialog({ title, label, value, required, confirmLabel, mono, tools }) {
    return new Promise(resolve => {
      let done = false;
      const input = h("textarea", { class: mono ? "input mono" : "input", id: "promptInput", rows: "3", spellcheck: mono ? "false" : null });
      input.value = value || "";
      const error = h("p", { class: "error-text", role: "alert" });

      const form = h("form", {
        novalidate: true,
        onsubmit: event => {
          event.preventDefault();
          if (required && !input.value.trim()) {
            error.textContent = "This field is required.";
            return;
          }
          done = true;
          close();
          resolve(input.value.trim());
        }
      },
        h("div", { class: "field" }, h("label", { class: "label", for: "promptInput" }, label), input, error),
        tools ? tools(input) : null,
        h("div", { class: "modal-actions" },
          h("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Back"),
          h("button", { type: "submit", class: "btn btn-primary" }, confirmLabel || "Save")
        )
      );

      const close = openModal(title, form);
      // Resolve null bila ditutup tanpa submit.
      const observer = new MutationObserver(() => {
        if (!document.body.contains(form)) {
          observer.disconnect();
          if (!done) resolve(null);
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  // ------------------------------------------------
  // DATA
  // ------------------------------------------------

  async function loadData() {
    const [orders, products, storeStatus, reviews] = await Promise.all([
      admin.listOrders(),
      admin.listProducts(),
      GT.api.getStoreStatus().catch(() => null),
      admin.listReviews().catch(() => null)
    ]);
    state.orders = orders;
    state.products = products;
    state.storeStatus = storeStatus;
    state.reviews = reviews || [];
    state.reviewsUnavailable = reviews === null;
  }

  function stats() {
    const paidStatuses = ["payment_verified", "processing", "completed"];
    return {
      total: state.orders.length,
      revenue: state.orders.filter(o => paidStatuses.includes(o.status)).reduce((sum, o) => sum + o.total, 0),
      pending: state.orders.filter(o => ["pending_payment", "payment_submitted"].includes(o.status)).length,
      completed: state.orders.filter(o => o.status === "completed").length,
      available: state.products.filter(p => p.active && p.stock > 0).length
    };
  }

  // ------------------------------------------------
  // LOGIN
  // ------------------------------------------------

  function renderLogin(message) {
    userSlot.replaceChildren();
    const error = h("p", { class: "error-text", role: "alert" }, message || "");
    const email = h("input", { class: "input", type: "email", id: "loginEmail", autocomplete: "username", required: true });
    const password = h("input", { class: "input", type: "password", id: "loginPassword", autocomplete: "current-password", required: true });
    const submit = h("button", { class: "btn btn-primary btn-block btn-lg", type: "submit" }, "Sign in");

    root.replaceChildren(
      h("form", {
        class: "card login-card",
        novalidate: true,
        onsubmit: async event => {
          event.preventDefault();
          error.textContent = "";
          if (!email.value || !password.value) {
            error.textContent = "Enter your email and password.";
            return;
          }
          submit.disabled = true;
          submit.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "Signing in…");
          try {
            state.session = await admin.signIn(email.value.trim(), password.value);
            password.value = "";
            await showDashboard();
          } catch (err) {
            error.textContent = err.message;
            submit.disabled = false;
            submit.textContent = "Sign in";
          }
        }
      },
        h("p", { class: "eyebrow" }, "Admin access"),
        h("h1", { class: "login-title" }, "Sign in"),
        h("p", { class: "muted login-sub" }, "Use the admin account created in Supabase Auth."),
        h("div", { class: "field" }, h("label", { class: "label", for: "loginEmail" }, "Email"), email),
        h("div", { class: "field" }, h("label", { class: "label", for: "loginPassword" }, "Password"), password),
        error,
        submit
      )
    );
  }

  // ------------------------------------------------
  // DASHBOARD SHELL
  // ------------------------------------------------

  function renderUser() {
    userSlot.replaceChildren(...[
      h("span", { class: "admin-email" }, state.session.demo ? "Demo admin" : state.session.email),
      state.session.demo ? null : h("button", {
        type: "button",
        class: "btn btn-outline btn-sm",
        onclick: async () => {
          await admin.signOut();
          state.session = null;
          renderLogin();
        }
      }, "Sign out")
    ].filter(Boolean));
  }

  async function showDashboard() {
    renderUser();
    root.replaceChildren(h("div", { class: "state-block" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading dashboard…"));

    try {
      await loadData();
    } catch (error) {
      root.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "Couldn't load data"),
          h("p", { class: "state-text" }, error.message),
          h("button", { type: "button", class: "btn btn-outline", onclick: showDashboard }, "Try again")
        )
      );
      return;
    }

    const urlTab = tabFromUrl();
    if (urlTab) state.tab = urlTab;
    renderDashboard();
  }

  async function reload() {
    try {
      await loadData();
      renderDashboard();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderDashboard() {
    const tabs = [
      ["overview", "Overview"],
      ["orders", `Orders (${state.orders.length})`],
      ["products", `Products (${state.products.length})`],
      ["reviews", state.reviews.filter(r => r.status === "pending").length ? `Reviews (${state.reviews.filter(r => r.status === "pending").length})` : "Reviews"],
      ["announcements", "Announcements"],
      ["prices", "BGL Price"],
      ["downloads", "Downloads"],
      ["server", "Server"]
    ];

    const panel = h("div", { id: "tabPanel", role: "tabpanel" });

    root.replaceChildren(
      h("div", { class: "admin-top" },
        h("div", {}, h("p", { class: "eyebrow" }, "GTPLAY Store"), h("h1", {}, "Dashboard")),
        h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: reload }, "↻ Refresh")
      ),
      h("div", { class: "tabs", role: "tablist", "aria-label": "Dashboard sections" },
        tabs.map(([key, label]) => h("button", {
          type: "button",
          class: "tab",
          role: "tab",
          "aria-selected": String(state.tab === key),
          onclick: () => goTab(key)
        }, label))
      ),
      panel
    );

    if (state.tab === "orders") renderOrders(panel);
    else if (state.tab === "products") renderProducts(panel);
    else if (state.tab === "announcements") renderAnnouncements(panel);
    else if (state.tab === "reviews") renderReviews(panel);
    else if (state.tab === "prices") renderPrices(panel);
    else if (state.tab === "downloads") renderDownloads(panel);
    else if (state.tab === "server") renderServer(panel);
    else renderOverview(panel);
  }

  // ------------------------------------------------
  // OVERVIEW
  // ------------------------------------------------

  function renderOverview(panel) {
    const s = stats();
    const attention = state.orders.filter(o => o.status === "payment_submitted");
    const toProcess = state.orders.filter(o => ["payment_verified", "processing"].includes(o.status));

    panel.replaceChildren(
      maintenanceCard(),
      h("div", { class: "stat-grid" },
        statCard("Total Orders", s.total),
        statCard("Total Revenue", formatRupiah(s.revenue), "Verified, processing & completed"),
        statCard("Pending Orders", s.pending, "Awaiting payment or verification"),
        statCard("Completed Orders", s.completed),
        statCard("Available Products", s.available, "Active & in stock")
      ),
      h("div", { class: "split" },
        orderListCard("Needs verification", attention, "No payments waiting for verification."),
        orderListCard("Ready to deliver", toProcess, "Nothing to deliver right now.")
      )
    );
  }

  // ------------------------------------------------
  // MAINTENANCE TOGGLE
  // ------------------------------------------------

  function maintenanceCard() {
    const status = state.storeStatus;

    if (!status) {
      return h("div", { class: "notice notice-warn store-card" },
        h("p", {}, "Couldn't read the store status. If you just updated the website, run the latest supabase/schema.sql in Supabase SQL Editor."));
    }

    const on = Boolean(status.maintenance);

    const eta = h("input", {
      class: "input",
      id: "maintEta",
      maxlength: "60",
      placeholder: "e.g. ~30 menit"
    });
    eta.value = status.eta || "";

    const message = h("textarea", {
      class: "input",
      id: "maintMessage",
      rows: "2",
      maxlength: "500",
      placeholder: "Leave empty to use the default maintenance text."
    });
    message.value = status.message || "";

    async function save(nextOn, button, successText) {
      button.disabled = true;
      try {
        state.storeStatus = await admin.setMaintenance(nextOn, message.value, eta.value);
        toast(successText, "success");
        renderDashboard();
      } catch (error) {
        toast(error.message, "error");
        button.disabled = false;
      }
    }

    const toggle = h("button", {
      type: "button",
      class: on ? "btn btn-light" : "btn btn-primary",
      onclick: async event => {
        const button = event.currentTarget;
        if (!on) {
          const ok = await confirmDialog({
            title: "Turn on maintenance?",
            message: "Customers will see the maintenance page and new orders are paused. Existing orders can still be paid and tracked.",
            confirmLabel: "Turn on maintenance"
          });
          if (!ok) return;
          save(true, button, "Maintenance mode is ON.");
        } else {
          save(false, button, "Store is open again.");
        }
      }
    }, on ? "Open store" : "Turn on maintenance");

    const saveText = on ? h("button", {
      type: "button",
      class: "btn btn-outline",
      onclick: event => save(true, event.currentTarget, "Maintenance message updated.")
    }, "Save message") : null;

    return h("section", { class: `card store-card${on ? " is-maintenance" : ""}`, "aria-labelledby": "storeStatusTitle" },
      h("div", { class: "store-card-head" },
        h("div", {},
          h("h2", { class: "card-title", id: "storeStatusTitle" }, "Store status"),
          h("p", { class: "help" }, on
            ? "Customers see the maintenance page. New orders are blocked by the server."
            : "The store is open and accepting orders.")
        ),
        h("span", { class: `status-badge ${on ? "tone-warn" : "tone-ok"}` }, on ? "Maintenance" : "Open")
      ),
      h("div", { class: "store-card-fields" },
        h("div", { class: "field" }, h("label", { class: "label", for: "maintEta" }, "Estimated time"), eta),
        h("div", { class: "field" }, h("label", { class: "label", for: "maintMessage" }, "Message for customers"), message)
      ),
      h("div", { class: "modal-actions start no-margin" }, toggle, saveText, h("a", {
        class: "btn btn-ghost",
        href: "/maintenance",
        target: "_blank",
        rel: "noopener"
      }, "Preview page"))
    );
  }

  function statCard(label, value, hint) {
    return h("div", { class: "stat" },
      h("p", { class: "stat-label" }, label),
      h("p", { class: "stat-value" }, String(value)),
      hint ? h("p", { class: "help" }, hint) : null
    );
  }

  function orderListCard(title, orders, emptyText) {
    return h("div", { class: "card" },
      h("h2", { class: "card-title" }, `${title} (${orders.length})`),
      orders.length === 0
        ? h("p", { class: "muted" }, emptyText)
        : h("ul", { class: "device-orders" }, orders.slice(0, 8).map(order =>
            h("li", {}, h("a", {
              href: urlForTab("orders"),
              onclick: event => {
                event.preventDefault();
                openOrder(order.id);
              }
            },
              h("span", {}, order.id),
              h("span", { class: "muted" }, `${order.growId} · ${formatRupiah(order.total)}`)
            ))
          ))
    );
  }

  // ------------------------------------------------
  // ORDERS
  // ------------------------------------------------

  function filteredOrders() {
    const query = state.search.trim().toLowerCase();
    return state.orders.filter(order => {
      const statusOk = state.status === "all" || order.status === state.status;
      const queryOk = !query || order.id.toLowerCase().includes(query) || order.growId.toLowerCase().includes(query);
      return statusOk && queryOk;
    });
  }

  function renderOrders(panel) {
    const tableWrap = h("div", { class: "data-table-wrap" });

    const search = h("input", {
      class: "input",
      type: "search",
      placeholder: "Search Order ID or GrowID…",
      "aria-label": "Search orders",
      value: state.search,
      oninput: debounce(event => {
        state.search = event.target.value;
        renderTable();
      }, 150)
    });

    const statusSelect = h("select", {
      class: "select",
      "aria-label": "Filter by status",
      onchange: event => {
        state.status = event.target.value;
        renderTable();
      }
    },
      h("option", { value: "all" }, "All statuses"),
      Object.entries(STATUS).map(([key, meta]) => h("option", { value: key, selected: state.status === key }, meta.label))
    );

    function renderTable() {
      const list = filteredOrders();

      if (list.length === 0) {
        tableWrap.replaceChildren(h("div", { class: "state-block borderless" }, h("p", { class: "state-title" }, "No orders found")));
        return;
      }

      tableWrap.replaceChildren(
        h("table", { class: "data-table" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Order ID"),
            h("th", { scope: "col" }, "Date"),
            h("th", { scope: "col" }, "GrowID"),
            h("th", { scope: "col" }, "Items"),
            h("th", { scope: "col", class: "num" }, "Total"),
            h("th", { scope: "col" }, "Status")
          )),
          h("tbody", {}, list.map(order =>
            h("tr", { class: "clickable", tabindex: "0", onclick: () => openOrder(order.id), onkeydown: event => { if (event.key === "Enter") openOrder(order.id); } },
              h("td", { class: "mono" }, order.id),
              h("td", {}, formatDateTime(order.createdAt)),
              h("td", {}, order.growId),
              h("td", {}, String(order.items.reduce((sum, item) => sum + item.quantity, 0))),
              h("td", { class: "num" }, formatRupiah(order.total)),
              h("td", {}, statusBadge(order.status))
            )
          ))
        )
      );
    }

    panel.replaceChildren(h("div", { class: "admin-filters" }, search, h("div", { class: "select-field" }, statusSelect)), tableWrap);
    renderTable();
  }

  async function openOrder(orderId) {
    let order;
    try {
      order = await admin.getOrder(orderId);
    } catch (error) {
      toast(error.message, "error");
      return;
    }

    const allowed = GT.api.ADMIN_TRANSITIONS[order.status] || [];
    const actions = h("div", { class: "modal-actions start" });

    const body = h("div", { class: "stack" },
      h("div", { class: "order-head" }, h("span", { class: "order-id" }, order.id), statusBadge(order.status)),
      h("div", {},
        row("GrowID", order.growId),
        row("Created", formatDateTime(order.createdAt)),
        row("Payment window ends", formatDateTime(order.expiresAt)),
        order.proofSubmittedAt ? row("Proof submitted", formatDateTime(order.proofSubmittedAt)) : null
      ),
      h("table", { class: "line-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Item"), h("th", {}, "Unit"), h("th", {}, "Qty"), h("th", {}, "Subtotal"))),
        h("tbody", {}, order.items.map(item => h("tr", {},
          h("td", {}, item.name),
          h("td", {},
            item.listPrice && item.listPrice > item.unitPrice ? h("s", { class: "price-old block" }, formatRupiah(item.listPrice)) : null,
            formatRupiah(item.unitPrice)),
          h("td", {}, `×${item.quantity}`),
          h("td", {}, formatRupiah(item.subtotal))
        )))
      ),
      h("div", { class: "summary-row summary-total" }, h("span", {}, "Total"), h("strong", {}, formatRupiah(order.total))),
      proofBlock(order),
      redeemEditor(order, () => close()),
      order.adminNote ? h("div", { class: "notice" }, h("p", {}, h("strong", {}, "Admin note: "), order.adminNote)) : null,
      h("div", {}, h("h3", { class: "card-title timeline-title-head" }, "Timeline"), GT.timeline ? GT.timeline(order) : eventsList(order)),
      allowed.length ? h("h3", { class: "card-title timeline-title-head" }, "Update status") : null,
      actions
    );

    const close = openModal("Order details", body, { wide: true });

    allowed.forEach(next => {
      const meta = ACTION_LABELS[next] || { label: STATUS[next].label, style: "btn-outline" };
      actions.append(h("button", {
        type: "button",
        class: `btn ${meta.style}`,
        onclick: async () => {
          let note = null;
          let redeemCode = null;

          if (next === "completed") {
            redeemCode = await promptDialog({
              title: "Complete order",
              label: "Redeem code (one per line if more than one) — shown to the customer",
              value: order.redeemCode || "",
              required: true,
              confirmLabel: "Save & complete",
              mono: true,
              tools: input => generatorButton(order, codes => { input.value = codes; })
            });
            if (redeemCode === null) return;
          } else if (meta.needsNote) {
            note = await promptDialog({ title: "Reject payment", label: "Reason (shown to the customer)", required: true, confirmLabel: "Reject payment" });
            if (note === null) return;
          } else if (next === "cancelled") {
            const ok = await confirmDialog({ title: "Cancel this order?", message: "Reserved stock will be returned to the store.", confirmLabel: "Cancel order", danger: true });
            if (!ok) return;
          } else if (order.status === "expired") {
            const ok = await confirmDialog({ title: "Verify an expired order?", message: "Use this only if the customer paid after the timer ended. Stock will be reserved again.", confirmLabel: "Verify payment" });
            if (!ok) return;
          }

          try {
            await admin.updateStatus(order.id, next, note, redeemCode);
            toast(`Order marked as ${STATUS[next].label}.`, "success");
            close();
            await reload();
          } catch (error) {
            toast(error.message, "error");
          }
        }
      }, meta.label));
    });
  }

  // Redeem code bisa diisi lebih awal (Verified/Processing) dan
  // diperbaiki setelah Completed bila salah ketik.
  function redeemEditor(order, closeModal) {
    if (!["payment_verified", "processing", "completed"].includes(order.status)) return null;

    const area = h("textarea", {
      class: "input mono",
      id: "redeemInput",
      rows: "3",
      maxlength: "2000",
      placeholder: "One redeem code per line",
      spellcheck: "false"
    });
    area.value = order.redeemCode || "";

    const save = h("button", {
      type: "button",
      class: "btn btn-outline btn-sm",
      onclick: async () => {
        save.disabled = true;
        try {
          await admin.setRedeemCode(order.id, area.value);
          toast("Redeem code saved.", "success");
          closeModal();
          await reload();
        } catch (error) {
          toast(error.message, "error");
          save.disabled = false;
        }
      }
    }, "Save redeem code");

    return h("div", { class: "field redeem-editor" },
      h("label", { class: "label", for: "redeemInput" }, "Redeem code"),
      area,
      h("p", { class: "help" }, order.status === "completed"
        ? "Visible to the customer now. Edit only to fix a mistake."
        : "The customer sees this once you mark the order as Completed."),
      h("div", { class: "modal-actions start no-margin" },
        generatorButton(order, codes => { area.value = codes; }),
        save)
    );
  }

  // ------------------------------------------------
  // REDEEM CODE GENERATOR
  // --------------------------------------------------
  // 1. Website membuat code acak (crypto) dengan prefix.
  // 2. Server mengecek code belum pernah dipakai pesanan lain.
  // 3. Admin membuat code yang SAMA di game lalu mencentang
  //    konfirmasi → code dimasukkan ke kolom redeem code.
  // 4. Admin tetap menekan Save / Save & complete.
  // ------------------------------------------------

  const PREFIX_KEY = "gtplay:admin:redeem-prefix";
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function makeRedeemCode(prefix) {
    const random = GT.utils.randomCode(8, CODE_ALPHABET);
    const body = `${random.slice(0, 4)}-${random.slice(4)}`;
    return prefix ? `${prefix}-${body}` : body;
  }

  function generatorButton(order, onUse) {
    return h("button", {
      type: "button",
      class: "btn btn-outline btn-sm",
      onclick: async () => {
        const codes = await openRedeemGenerator(order);
        if (codes) onUse(codes);
      }
    }, "⚙ Generate code");
  }

  function openRedeemGenerator(order) {
    return new Promise(resolve => {
      let done = false;
      let codes = [];
      let checked = false;

      const totalQty = order.items.reduce((sum, item) => sum + item.quantity, 0);
      const savedPrefix = GT.utils.storage.get(PREFIX_KEY, "GTPLAY");

      const prefix = h("input", {
        class: "input mono",
        id: "genPrefix",
        maxlength: "12",
        value: savedPrefix,
        spellcheck: "false",
        autocapitalize: "characters",
        oninput: () => { prefix.value = prefix.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
      });
      const count = h("input", { class: "input", id: "genCount", type: "number", min: "1", max: "20", step: "1", value: "1", inputmode: "numeric" });

      const list = h("ul", { class: "gen-list" });
      const status = h("div", { class: "gen-status", "aria-live": "polite" });
      const confirmBox = h("input", { type: "checkbox", id: "genConfirm", disabled: true, onchange: update });
      const useBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true }, "Use these codes");
      const copyAll = h("button", {
        type: "button",
        class: "btn btn-ghost btn-sm",
        hidden: true,
        onclick: async () => {
          const ok = await GT.utils.copyText(codes.join("\n"));
          toast(ok ? "All codes copied." : "Couldn't copy — select the codes manually.", ok ? "success" : "error");
        }
      }, "Copy all");

      function update() {
        useBtn.disabled = !(codes.length && checked && confirmBox.checked);
      }

      async function generate() {
        const n = Math.min(20, Math.max(1, Math.floor(Number(count.value) || 1)));
        count.value = String(n);
        GT.utils.storage.set(PREFIX_KEY, prefix.value);
        codes = [];
        while (codes.length < n) {
          const code = makeRedeemCode(prefix.value);
          if (!codes.includes(code)) codes.push(code);
        }
        checked = false;
        confirmBox.checked = false;
        confirmBox.disabled = true;
        update();

        list.replaceChildren(...codes.map(code => h("li", {},
          h("code", { class: "redeem-code" }, code),
          GT.utils.copyButton(code, "Redeem code")
        )));
        copyAll.hidden = codes.length < 2;
        status.className = "gen-status";
        status.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), " Checking that the codes are unique…");

        try {
          const result = await admin.checkRedeemCodes(order.id, codes.join("\n"));
          if (result.duplicates && result.duplicates.length) {
            status.className = "gen-status notice notice-danger";
            status.replaceChildren(h("p", {}, `Already used in another order: ${result.duplicates.join(", ")}. Generate again.`));
            return;
          }
          checked = true;
          confirmBox.disabled = false;
          status.className = "gen-status notice notice-ok";
          status.replaceChildren(h("p", {}, "✓ Unique — not used in any other order."));
          update();
        } catch (error) {
          status.className = "gen-status notice notice-warn";
          status.replaceChildren(h("p", {}, `${error.message} If you just updated the website, run the latest supabase/schema.sql.`));
        }
      }

      useBtn.addEventListener("click", () => {
        done = true;
        close();
        resolve(codes.join("\n"));
      });

      const body = h("div", { class: "stack" },
        h("div", { class: "notice notice-info" },
          h("p", {}, h("strong", {}, "For: "), `${order.growId} · `, order.items.map(item => `${item.name} ×${item.quantity}`).join(", ")),
          h("p", {}, "Codes only work after you create the same code in the game. Check them before giving them to the buyer.")
        ),
        h("div", { class: "form-grid" },
          h("div", { class: "field" }, h("label", { class: "label", for: "genPrefix" }, "Prefix"), prefix, h("p", { class: "help" }, "Letters/numbers. Leave empty for no prefix.")),
          h("div", { class: "field" }, h("label", { class: "label", for: "genCount" }, "How many codes"), count,
            h("p", { class: "help" }, totalQty > 1 ? `This order has ${totalQty} items in total.` : "One code per order is usual."))
        ),
        h("div", { class: "modal-actions start no-margin" },
          h("button", { type: "button", class: "btn btn-outline", onclick: generate }, "Generate"),
          copyAll
        ),
        list,
        status,
        h("label", { class: "checkbox", for: "genConfirm" }, confirmBox,
          h("span", {}, "I've created these codes in the game and checked that they work.")),
        h("div", { class: "modal-actions" },
          h("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Back"),
          useBtn
        )
      );

      const close = openModal("Generate redeem code", body);
      generate();

      const observer = new MutationObserver(() => {
        if (!document.body.contains(body)) {
          observer.disconnect();
          if (!done) resolve(null);
        }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  function row(label, value) {
    return h("div", { class: "summary-row" }, h("span", {}, label), h("span", { class: "value" }, value));
  }

  function proofBlock(order) {
    if (order.proofUrl) {
      return h("div", {},
        h("h3", { class: "card-title timeline-title-head" }, "Payment proof"),
        h("a", { href: order.proofUrl, target: "_blank", rel: "noopener noreferrer" },
          h("img", { class: "proof-image", src: order.proofUrl, alt: `Payment proof for ${order.id}` }))
      );
    }
    if (order.proofName) {
      return h("div", { class: "notice notice-info" }, h("p", {}, `Proof file: ${order.proofName}. In demo mode the image is not stored — check WhatsApp.`));
    }
    return h("div", { class: "notice" }, h("p", {}, "No payment proof uploaded yet."));
  }

  function eventsList(order) {
    return h("ul", {}, (order.events || []).map(e => h("li", {}, `${STATUS[e.status] ? STATUS[e.status].label : e.status} — ${formatDateTime(e.at)}`)));
  }

  // ------------------------------------------------
  // REVIEWS (moderasi ulasan pembeli)
  // ------------------------------------------------

  function renderReviews(panel) {
    if (state.reviewsUnavailable) {
      panel.replaceChildren(h("div", { class: "notice notice-warn" }, h("p", {}, "Reviews need the latest database. Run supabase/schema.sql again in the Supabase SQL Editor.")));
      return;
    }

    const filters = [["pending", "Waiting"], ["approved", "Published"], ["hidden", "Hidden"], ["all", "All"]];
    const list = state.reviews.filter(r => state.reviewFilter === "all" || r.status === state.reviewFilter);
    const badge = { pending: ["tone-warn", "Waiting"], approved: ["tone-ok", "Published"], hidden: ["tone-muted", "Hidden"] };

    async function act(review, action) {
      try {
        if (action === "delete") {
          const ok = await confirmDialog({ title: "Delete this review?", message: "The buyer cannot send a new review for this order afterwards.", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          await admin.deleteReview(review.id);
          toast("Review deleted.", "success");
        } else {
          await admin.setReviewStatus(review.id, action);
          toast(action === "approved" ? "Review published." : action === "hidden" ? "Review hidden." : "Review moved back to waiting.", "success");
        }
        await reload();
      } catch (error) {
        toast(error.message, "error");
      }
    }

    panel.replaceChildren(
      h("div", { class: "admin-top admin-toolbar" },
        h("p", { class: "muted" }, "Only published reviews appear on the landing page (random order). Reviews come from buyers with a Completed order."),
        h("div", { class: "chips no-margin", role: "group", "aria-label": "Filter reviews" },
          filters.map(([key, label]) => h("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(state.reviewFilter === key),
            onclick: () => { state.reviewFilter = key; renderDashboard(); }
          }, `${label} (${key === "all" ? state.reviews.length : state.reviews.filter(r => r.status === key).length})`))
        )
      ),
      list.length === 0
        ? h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No reviews here"))
        : h("div", { class: "admin-reviews" }, list.map(review => h("article", { class: "card admin-review" },
            h("div", { class: "order-head" },
              h("div", { class: "admin-review-head" }, GT.stars ? GT.stars(review.rating) : `${review.rating}/5`, h("span", { class: `status-badge ${badge[review.status][0]}` }, badge[review.status][1])),
              h("span", { class: "help" }, formatDateTime(review.createdAt))
            ),
            review.comment ? h("p", { class: "review-comment" }, review.comment) : h("p", { class: "muted" }, "(no comment)"),
            h("p", { class: "help" }, `${review.growId} · `, h("button", { type: "button", class: "link-button mono", onclick: () => openOrder(review.orderId) }, review.orderId)),
            h("div", { class: "row-actions start" },
              review.status !== "approved" ? h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => act(review, "approved") }, "Publish") : null,
              review.status !== "hidden" ? h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => act(review, "hidden") }, "Hide") : null,
              h("button", { type: "button", class: "btn btn-danger btn-sm", onclick: () => act(review, "delete") }, "Delete")
            )
          )))
    );
  }

  // ------------------------------------------------
  // PRODUCTS
  // ------------------------------------------------

  function renderProducts(panel) {
    const categories = [...new Set(state.products.map(p => p.category))];

    panel.replaceChildren(
      h("div", { class: "admin-top admin-toolbar" },
        h("p", { class: "muted" }, `${state.products.length} products · ${categories.length} categories`),
        h("div", { class: "modal-actions start no-margin" },
          GT.api.isDemo ? h("button", {
            type: "button",
            class: "btn btn-ghost btn-sm",
            onclick: async () => {
              const ok = await confirmDialog({ title: "Reset demo data?", message: "Products and demo orders in this browser go back to the defaults.", confirmLabel: "Reset", danger: true });
              if (!ok) return;
              await admin.resetDemo();
              await reload();
            }
          }, "Reset demo data") : null,
          h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: openCategories }, "Manage categories"),
          h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => openProductForm(null) }, "+ Add product")
        )
      ),
      state.products.length === 0
        ? h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No products yet"))
        : h("div", { class: "data-table-wrap" },
            h("table", { class: "data-table" },
              h("thead", {}, h("tr", {},
                h("th", { scope: "col" }, "Product"),
                h("th", { scope: "col" }, "Category"),
                h("th", { scope: "col", class: "num" }, "Price"),
                h("th", { scope: "col", class: "num" }, "Stock"),
                h("th", { scope: "col" }, "Status"),
                h("th", { scope: "col", class: "num" }, "Actions")
              )),
              h("tbody", {}, state.products.map(product => h("tr", {},
                h("td", {}, h("strong", {}, product.name), h("div", { class: "help mono" }, product.id)),
                h("td", {}, product.category),
                h("td", { class: "num" }, productPriceCell(product)),
                h("td", { class: "num" }, product.stock <= 0 ? h("span", { class: "status-badge tone-danger" }, "0") : String(product.stock)),
                h("td", {}, product.active
                  ? h("span", { class: "status-badge tone-ok" }, "Active")
                  : h("span", { class: "status-badge tone-muted" }, "Hidden")),
                h("td", {}, h("div", { class: "row-actions" },
                  h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => openProductForm(product) }, "Edit"),
                  h("button", {
                    type: "button",
                    class: "btn btn-danger btn-sm",
                    onclick: async () => {
                      const ok = await confirmDialog({
                        title: `Delete ${product.name}?`,
                        message: "Past orders keep their item names and prices. To only hide it from the store, edit it and untick Active instead.",
                        confirmLabel: "Delete",
                        danger: true
                      });
                      if (!ok) return;
                      try {
                        await admin.deleteProduct(product.id);
                        toast("Product deleted.", "success");
                        await reload();
                      } catch (error) {
                        toast(error.message, "error");
                      }
                    }
                  }, "Delete")
                ))
              )))
            )
          )
    );
  }

  function productPriceCell(product) {
    const percent = Number(product.discountPercent || 0);
    if (!percent) return formatRupiah(product.price);
    const active = GT.api.discountActive(product);
    return h("div", { class: "price-cell" },
      active ? h("s", { class: "price-old" }, formatRupiah(product.price)) : formatRupiah(product.price),
      active ? h("strong", { class: "is-sale" }, formatRupiah(GT.api.effectivePrice(product))) : null,
      h("span", { class: `status-badge ${active ? "tone-danger" : "tone-muted"}` }, active ? `−${percent}%` : `−${percent}% ended`)
    );
  }

  // datetime-local (waktu lokal) ↔ ISO
  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openProductForm(product) {
    const p = product || { name: "", category: "", description: "", price: "", stock: "", active: true, image: "", fallback: "", sortOrder: state.products.length + 1, discountPercent: 0, discountEndsAt: null };
    const categories = [...new Set(state.products.map(item => item.category))];
    const error = h("p", { class: "error-text", role: "alert" });

    function field(id, label, input, help, span) {
      return h("div", { class: `field${span ? " span-2" : ""}` }, h("label", { class: "label", for: id }, label), input, help ? h("p", { class: "help" }, help) : null);
    }

    const name = h("input", { class: "input", id: "pName", value: p.name, required: true, maxlength: "60" });
    const category = h("input", { class: "input", id: "pCategory", value: p.category, list: "categoryOptions", required: true, maxlength: "40" });
    const description = h("textarea", { class: "input", id: "pDesc", rows: "3", maxlength: "300" });
    description.value = p.description || "";
    const price = h("input", { class: "input", id: "pPrice", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.price, required: true });
    const stock = h("input", { class: "input", id: "pStock", type: "number", min: "0", step: "1", inputmode: "numeric", value: p.stock, required: true });
    const image = h("input", { class: "input", id: "pImage", value: p.image, placeholder: "images/items/item.png or https://…" });
    const fallback = h("input", { class: "input", id: "pFallback", value: p.fallback, maxlength: "10", placeholder: "Short text if image fails" });
    const sortOrder = h("input", { class: "input", id: "pSort", type: "number", step: "1", value: p.sortOrder });
    const active = h("input", { type: "checkbox", id: "pActive", checked: p.active });
    const discount = h("input", { class: "input", id: "pDiscount", type: "number", min: "0", max: "90", step: "1", inputmode: "numeric", value: String(p.discountPercent || 0), oninput: () => previewSale() });
    const discountEnds = h("input", { class: "input", id: "pDiscountEnds", type: "datetime-local", value: toLocalInput(p.discountEndsAt), oninput: () => previewSale() });
    const salePreview = h("p", { class: "help sale-preview", "aria-live": "polite" });

    function previewSale() {
      const pct = Number(discount.value || 0);
      const base = Number(price.value || 0);
      if (!pct) {
        salePreview.textContent = "No discount. 0 = normal price.";
        return;
      }
      if (!Number.isInteger(pct) || pct < 0 || pct > 90) {
        salePreview.textContent = "Use a whole number from 0 to 90.";
        return;
      }
      const ends = discountEnds.value ? new Date(discountEnds.value) : null;
      const sale = GT.api.effectivePrice({ price: base, discountPercent: pct, discountEndsAt: null });
      salePreview.textContent = `Sale price: ${formatRupiah(sale)} (save ${formatRupiah(base - sale)})` +
        (ends ? (ends.getTime() <= Date.now() ? " · end time is in the past, so the discount is off" : ` · until ${formatDateTime(ends)}`) : " · no end date");
    }

    const upload = h("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      class: "sr-only",
      id: "pUpload",
      onchange: async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          toast("Uploading image…", "info");
          image.value = await admin.uploadProductImage(file);
          toast("Image uploaded.", "success");
        } catch (err) {
          toast(err.message, "error");
        }
        event.target.value = "";
      }
    });

    const submit = h("button", { type: "submit", class: "btn btn-primary" }, product ? "Save changes" : "Add product");

    const form = h("form", {
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        error.textContent = "";

        const data = {
          id: product ? product.id : undefined,
          name: name.value,
          category: category.value,
          description: description.value,
          price: Number(price.value),
          stock: Number(stock.value),
          image: image.value,
          fallback: fallback.value,
          sortOrder: Number(sortOrder.value),
          active: active.checked,
          discountPercent: Number(discount.value || 0),
          discountEndsAt: discountEnds.value ? new Date(discountEnds.value).toISOString() : null
        };

        if (!data.name.trim() || !data.category.trim()) {
          error.textContent = "Name and category are required.";
          return;
        }
        if (price.value === "" || !Number.isInteger(data.price) || data.price < 0) {
          error.textContent = "Price must be a whole number in Rupiah (0 or more).";
          return;
        }
        if (stock.value === "" || !Number.isInteger(data.stock) || data.stock < 0) {
          error.textContent = "Stock must be a whole number (0 or more).";
          return;
        }
        if (!Number.isInteger(data.discountPercent) || data.discountPercent < 0 || data.discountPercent > 90) {
          error.textContent = "Discount must be a whole number from 0 to 90 percent.";
          return;
        }

        submit.disabled = true;
        try {
          await admin.saveProduct(data);
          toast(product ? "Product updated." : "Product added.", "success");
          close();
          await reload();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      }
    },
      h("datalist", { id: "categoryOptions" }, categories.map(c => h("option", { value: c }))),
      h("div", { class: "form-grid" },
        field("pName", "Name", name),
        field("pCategory", "Category", category, "Pick an existing one or type a new category."),
        field("pDesc", "Description", description, null, true),
        field("pPrice", "Price (Rp)", price),
        field("pStock", "Stock", stock),
        h("div", { class: "span-2 discount-box" },
          h("p", { class: "label" }, "Discount"),
          h("div", { class: "form-grid" },
            field("pDiscount", "Discount (%)", discount, "0–90. The store shows the old price crossed out."),
            field("pDiscountEnds", "Ends at (optional)", discountEnds, "Empty = until you set it back to 0.")
          ),
          salePreview
        ),
        h("div", { class: "field span-2" },
          h("label", { class: "label", for: "pImage" }, "Image"),
          h("div", { class: "input-row" },
            image,
            h("label", { class: "btn btn-outline btn-sm", for: "pUpload" }, "Upload"),
            upload
          ),
          h("p", { class: "help" }, GT.api.isDemo ? "Demo mode: type a path to an image in the images/ folder." : "Upload to Supabase Storage or paste an image URL.")
        ),
        field("pFallback", "Fallback text", fallback),
        field("pSort", "Sort order", sortOrder, "Lower numbers appear first."),
        h("label", { class: "checkbox span-2", for: "pActive" }, active, h("span", {}, "Active — show this product in the store"))
      ),
      error,
      h("div", { class: "modal-actions" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Cancel"),
        submit
      )
    );

    price.addEventListener("input", previewSale);
    previewSale();
    const close = openModal(product ? "Edit product" : "Add product", form, { wide: true });
  }

  function openCategories() {
    const counts = state.products.reduce((map, p) => map.set(p.category, (map.get(p.category) || 0) + 1), new Map());

    const list = h("div", {},
      counts.size === 0 ? h("p", { class: "muted" }, "No categories yet. Categories are created when you add a product.") : null,
      [...counts.entries()].map(([category, count]) =>
        h("div", { class: "category-row" },
          h("span", {}, h("strong", {}, category), h("span", { class: "muted" }, ` · ${count} product${count === 1 ? "" : "s"}`)),
          h("button", {
            type: "button",
            class: "btn btn-outline btn-sm",
            onclick: async () => {
              const next = await promptDialog({ title: `Rename "${category}"`, label: "New category name", value: category, required: true, confirmLabel: "Rename" });
              if (!next || next === category) return;
              try {
                await admin.renameCategory(category, next);
                toast("Category renamed.", "success");
                close();
                await reload();
              } catch (error) {
                toast(error.message, "error");
              }
            }
          }, "Rename")
        )
      ),
      h("p", { class: "help category-help" }, "To add a category, add or edit a product and type a new category name.")
    );

    const close = openModal("Manage categories", list);
  }

  // ------------------------------------------------
  // ANNOUNCEMENTS
  // ------------------------------------------------

  function formatDay(iso) {
    return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
  }

  function loadingPanel(panel) {
    panel.replaceChildren(h("div", { class: "state-block borderless" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading…"));
  }

  async function renderAnnouncements(panel) {
    loadingPanel(panel);
    let items;
    try {
      items = await admin.listAnnouncements();
    } catch (error) {
      panel.replaceChildren(h("div", { class: "notice notice-warn" }, h("p", {}, `${error.message} If you just updated the website, run the latest supabase/schema.sql.`)));
      return;
    }

    panel.replaceChildren(
      h("div", { class: "admin-top admin-toolbar" },
        h("p", { class: "muted" }, `${items.length} announcement${items.length === 1 ? "" : "s"} · shown on the landing page and Announcement page`),
        h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => openAnnouncementForm(null) }, "+ New announcement")
      ),
      items.length === 0
        ? h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No announcements yet"))
        : h("div", { class: "data-table-wrap" },
            h("table", { class: "data-table" },
              h("thead", {}, h("tr", {},
                h("th", { scope: "col" }, "Date"),
                h("th", { scope: "col" }, "Category"),
                h("th", { scope: "col" }, "Title"),
                h("th", { scope: "col" }, "Status"),
                h("th", { scope: "col", class: "num" }, "Actions")
              )),
              h("tbody", {}, items.map(item => h("tr", {},
                h("td", {}, formatDay(item.publishedOn)),
                h("td", {}, h("span", { class: `announcement-badge ${item.category}` }, item.category)),
                h("td", {}, h("strong", {}, item.title), h("div", { class: "help clamp-1" }, item.content)),
                h("td", {}, item.published
                  ? h("span", { class: "status-badge tone-ok" }, "Published")
                  : h("span", { class: "status-badge tone-muted" }, "Draft")),
                h("td", {}, h("div", { class: "row-actions" },
                  h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => openAnnouncementForm(item) }, "Edit"),
                  h("button", {
                    type: "button",
                    class: "btn btn-danger btn-sm",
                    onclick: async () => {
                      const ok = await confirmDialog({ title: "Delete announcement?", message: `"${item.title}" will be removed from the website.`, confirmLabel: "Delete", danger: true });
                      if (!ok) return;
                      try {
                        await admin.deleteAnnouncement(item.id);
                        toast("Announcement deleted.", "success");
                        renderDashboard();
                      } catch (error) {
                        toast(error.message, "error");
                      }
                    }
                  }, "Delete")
                ))
              )))
            )
          )
    );
  }

  function openAnnouncementForm(item) {
    const a = item || { category: "update", title: "", content: "", publishedOn: GT.api.todayISO(), published: true };
    const error = h("p", { class: "error-text", role: "alert" });

    const category = h("select", { class: "select", id: "aCategory" },
      [["update", "Update"], ["event", "Event"], ["maintenance", "Maintenance"]].map(([value, label]) =>
        h("option", { value, selected: a.category === value }, label)));
    const date = h("input", { class: "input", id: "aDate", type: "date", value: a.publishedOn, required: true });
    const title = h("input", { class: "input", id: "aTitle", value: a.title, maxlength: "120", required: true });
    const content = h("textarea", { class: "input", id: "aContent", rows: "5", maxlength: "2000", required: true });
    content.value = a.content;
    const published = h("input", { type: "checkbox", id: "aPublished", checked: a.published });
    const submit = h("button", { type: "submit", class: "btn btn-primary" }, item ? "Save changes" : "Publish");

    const form = h("form", {
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        error.textContent = "";
        if (!title.value.trim() || !content.value.trim() || !date.value) {
          error.textContent = "Title, content, and date are required.";
          return;
        }
        submit.disabled = true;
        try {
          await admin.saveAnnouncement({
            id: item ? item.id : undefined,
            createdAt: item ? item.createdAt : undefined,
            category: category.value,
            title: title.value,
            content: content.value,
            publishedOn: date.value,
            published: published.checked
          });
          toast(item ? "Announcement updated." : "Announcement published.", "success");
          close();
          renderDashboard();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      }
    },
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { class: "label", for: "aCategory" }, "Category"), h("div", { class: "select-field" }, category)),
        h("div", { class: "field" }, h("label", { class: "label", for: "aDate" }, "Date"), date),
        h("div", { class: "field span-2" }, h("label", { class: "label", for: "aTitle" }, "Title"), title),
        h("div", { class: "field span-2" }, h("label", { class: "label", for: "aContent" }, "Content"), content),
        h("label", { class: "checkbox span-2", for: "aPublished" }, published, h("span", {}, "Published — visible on the website (untick to save as draft)"))
      ),
      error,
      h("div", { class: "modal-actions" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => close() }, "Cancel"),
        submit
      )
    );

    const close = openModal(item ? "Edit announcement" : "New announcement", form, { wide: true });
  }

  // ------------------------------------------------
  // BLUE GEM LOCK PRICE
  // ------------------------------------------------

  async function renderPrices(panel) {
    loadingPanel(panel);
    let prices;
    try {
      prices = await GT.api.listLockPrices();
    } catch (error) {
      panel.replaceChildren(h("div", { class: "notice notice-warn" }, h("p", {}, `${error.message} If you just updated the website, run the latest supabase/schema.sql.`)));
      return;
    }

    const date = h("input", { class: "input", id: "pDate", type: "date", value: GT.api.todayISO(), required: true });
    const price = h("input", { class: "input", id: "pBgl", type: "number", min: "1", step: "1", inputmode: "numeric", placeholder: "e.g. 25000", required: true });
    const error = h("p", { class: "error-text", role: "alert" });
    const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Save price");

    const form = h("form", {
      class: "card price-form",
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        error.textContent = "";
        const value = Number(price.value);
        if (!date.value || !Number.isInteger(value) || value <= 0) {
          error.textContent = "Enter a date and a whole price above 0.";
          return;
        }
        submit.disabled = true;
        try {
          await admin.saveLockPrice({ recordedOn: date.value, price: value });
          toast(`Price for ${formatDay(date.value)} saved.`, "success");
          renderDashboard();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      }
    },
      h("h2", { class: "card-title" }, "Record Blue Gem Lock price"),
      h("p", { class: "help price-form-help" }, "One price per date. Saving a date that already exists replaces its price."),
      h("div", { class: "price-form-row" },
        h("div", { class: "field" }, h("label", { class: "label", for: "pDate" }, "Date"), date),
        h("div", { class: "field" }, h("label", { class: "label", for: "pBgl" }, "Price (Rp)"), price),
        h("div", { class: "field price-form-submit" }, submit)
      ),
      error
    );

    const history = prices.slice().reverse();

    panel.replaceChildren(
      form,
      prices.length > 1
        ? h("div", { class: "card admin-chart" },
            h("h2", { class: "card-title" }, "Preview"),
            GT.lineChart(prices.map(p => ({ date: p.recordedOn, value: p.price })), {
              label: "Blue Gem Lock price in Rupiah",
              formatValue: value => formatRupiah(value),
              formatDate: formatDay,
              formatDateShort: iso => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" })
            }))
        : null,
      history.length === 0
        ? h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No prices recorded yet"))
        : h("div", { class: "data-table-wrap" },
            h("table", { class: "data-table compact" },
              h("thead", {}, h("tr", {},
                h("th", { scope: "col" }, "Date"),
                h("th", { scope: "col", class: "num" }, "Price"),
                h("th", { scope: "col", class: "num" }, "Change"),
                h("th", { scope: "col", class: "num" }, "Actions")
              )),
              h("tbody", {}, history.map((entry, index) => {
                const prev = history[index + 1];
                const diff = prev ? entry.price - prev.price : null;
                return h("tr", {},
                  h("td", {}, formatDay(entry.recordedOn)),
                  h("td", { class: "num" }, formatRupiah(entry.price)),
                  h("td", { class: "num muted" }, diff === null ? "—" : `${diff > 0 ? "▲ +" : diff < 0 ? "▼ −" : "■ "}${formatRupiah(Math.abs(diff))}`),
                  h("td", {}, h("div", { class: "row-actions" },
                    h("button", {
                      type: "button",
                      class: "btn btn-outline btn-sm",
                      onclick: () => {
                        date.value = entry.recordedOn;
                        price.value = entry.price;
                        price.focus();
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    }, "Edit"),
                    h("button", {
                      type: "button",
                      class: "btn btn-danger btn-sm",
                      onclick: async () => {
                        const ok = await confirmDialog({ title: "Delete this price?", message: `${formatDay(entry.recordedOn)} — ${formatRupiah(entry.price)}`, confirmLabel: "Delete", danger: true });
                        if (!ok) return;
                        try {
                          await admin.deleteLockPrice(entry.recordedOn);
                          toast("Price deleted.", "success");
                          renderDashboard();
                        } catch (err) {
                          toast(err.message, "error");
                        }
                      }
                    }, "Delete")
                  ))
                );
              }))
            )
          )
    );
  }

  // ------------------------------------------------
  // DOWNLOADS
  // ------------------------------------------------

  async function renderDownloads(panel) {
    loadingPanel(panel);
    let status;
    try {
      status = await GT.api.getStoreStatus();
    } catch (error) {
      status = null;
    }

    if (!status || !status.downloads) {
      panel.replaceChildren(h("div", { class: "notice notice-warn" }, h("p", {}, "Couldn't read download settings. If you just updated the website, run the latest supabase/schema.sql.")));
      return;
    }

    const platforms = [
      ["windows", "Windows"],
      ["android", "Android"],
      ["ios", "iOS"],
      ["mac", "macOS"]
    ];
    const inputs = {};
    const error = h("p", { class: "error-text", role: "alert" });
    const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Save links");

    panel.replaceChildren(h("form", {
      class: "card",
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        error.textContent = "";
        const links = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
        const bad = Object.values(links).find(value => value && !/^https:\/\//.test(value));
        if (bad) {
          error.textContent = "Every link must start with https://";
          return;
        }
        submit.disabled = true;
        try {
          await admin.setDownloads(links);
          toast("Download links saved.", "success");
          renderDashboard();
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      }
    },
      h("h2", { class: "card-title" }, "Client download links"),
      h("p", { class: "help downloads-help" }, "Shown on the landing page. Leave a link empty to show “Coming soon” for that platform."),
      platforms.map(([key, label]) => {
        inputs[key] = h("input", {
          class: "input",
          id: `dl-${key}`,
          type: "url",
          inputmode: "url",
          placeholder: "https://…",
          value: status.downloads[key] || ""
        });
        return h("div", { class: "field" }, h("label", { class: "label", for: `dl-${key}` }, label), inputs[key]);
      }),
      error,
      h("div", { class: "modal-actions start no-margin" }, submit, h("a", { class: "btn btn-ghost", href: "/#download", target: "_blank", rel: "noopener" }, "View on site"))
    ));
  }

  // ------------------------------------------------
  // SERVER (status GTPS Cloud + Lua opsional)
  // ------------------------------------------------

  function luaScript(token) {
    return [
      "-- ==================================================",
      "-- GTPLAY Website Stats Reporter",
      "-- Mengirim jumlah player online & world aktif ke website",
      "-- setiap ±60 detik (onAutoSaveRequest).",
      "-- ==================================================",
      "",
      `local SUPABASE_URL = "${GT.config.SUPABASE_URL.trim().replace(/\/+$/, "")}"`,
      `local ANON_KEY = "${GT.config.SUPABASE_ANON_KEY.trim()}" -- public key (sama dengan website)`,
      `local STATS_TOKEN = "${token}" -- RAHASIA: jangan dibagikan`,
      "",
      "-- Panggil fungsi engine dengan aman (tidak error jika tidak ada).",
      "local function tryList(fn)",
      "  if type(fn) ~= \"function\" then return nil end",
      "  local ok, result = pcall(fn)",
      "  if ok and type(result) == \"table\" then return result end",
      "  return nil",
      "end",
      "",
      "local function getPlayers()",
      "  return tryList(getServerPlayers) or tryList(getAllPlayers) or {}",
      "end",
      "",
      "local function worldNameOf(player)",
      "  local ok, name = pcall(function() return player:getWorldName() end)",
      "  if ok and type(name) == \"string\" then return name end",
      "  ok, name = pcall(function() local w = player:getWorld(); return w and w:getName() end)",
      "  if ok and type(name) == \"string\" then return name end",
      "  return nil",
      "end",
      "",
      "-- World aktif: daftar world dari engine jika tersedia,",
      "-- jika tidak, hitung world unik yang sedang dimasuki player.",
      "local function countWorlds(players)",
      "  local list = tryList(getWorlds) or tryList(getActiveWorlds) or tryList(getAllWorlds) or tryList(getLoadedWorlds)",
      "  if list then return #list end",
      "",
      "  local seen, count, readable = {}, 0, false",
      "  for _, player in ipairs(players) do",
      "    local name = worldNameOf(player)",
      "    if name ~= nil then readable = true end",
      "    if name and name ~= \"\" and name ~= \"EXIT\" and not seen[name] then",
      "      seen[name] = true",
      "      count = count + 1",
      "    end",
      "  end",
      "  if readable or #players == 0 then return count end",
      "  return nil -- tidak bisa dihitung di engine ini",
      "end",
      "",
      "local function reportStats()",
      "  local players = getPlayers()",
      "  local payload = { p_token = STATS_TOKEN, p_players = #players }",
      "  local worlds = countWorlds(players)",
      "  if worlds ~= nil then payload.p_worlds = worlds end",
      "",
      "  http.request({",
      "    url = SUPABASE_URL .. \"/rest/v1/rpc/report_server_stats\",",
      "    method = \"POST\",",
      "    headers = {",
      "      [\"Content-Type\"] = \"application/json\",",
      "      [\"apikey\"] = ANON_KEY,",
      "      [\"Authorization\"] = \"Bearer \" .. ANON_KEY",
      "    },",
      "    body = json.encode(payload),",
      "    callback = function(res)",
      "      if not res.ok or res.status >= 300 then",
      "        print(\"[GTPLAY stats] gagal kirim, status: \" .. tostring(res.status))",
      "      end",
      "    end",
      "  })",
      "end",
      "",
      "onAutoSaveRequest(function()",
      "  local ok, err = pcall(reportStats)",
      "  if not ok then print(\"[GTPLAY stats] error: \" .. tostring(err)) end",
      "end)",
      "",
      "pcall(reportStats)",
      ""
    ].join("\n");
  }

  async function renderServer(panel) {
    loadingPanel(panel);

    // 1) Status langsung dari API publik GTPS Cloud (via /api/server-status).
    const live = await GT.api.getServerStatus();
    const has = value => value !== null && value !== undefined;
    const usesGtps = Boolean(GT.config.SERVER_STATUS_URL);

    let liveSection;
    if (!usesGtps) {
      liveSection = null;
    } else if (live.error) {
      liveSection = h("div", { class: "notice notice-warn" }, h("p", {},
        "Couldn't reach the GTPS Cloud status API. Check that the api/ folder is deployed on Vercel and GTPS_SERVER_ID is correct (default 6986)."));
    } else {
      liveSection = h("div", { class: "stat-grid" },
        statCard("Server", live.online ? "Online" : "Offline", live.uptime ? `Uptime ${live.uptime}` : "From GTPS Cloud"),
        statCard("Players online", has(live.players) ? String(live.players) : "—", has(live.maxPlayers) ? `Max ${live.maxPlayers}` : ""),
        statCard("Active worlds", has(live.worlds) ? String(live.worlds) : "—", "Worlds currently loaded"),
        h("div", { class: "stat stat-actions" },
          h("button", { type: "button", class: "btn btn-outline btn-sm", onclick: () => renderDashboard() }, "↻ Refresh"),
          h("p", { class: "help" }, live.updatedAt ? `Checked ${formatDateTime(live.updatedAt)}` : "")
        )
      );
    }

    const intro = h("section", { class: "card" },
      h("h2", { class: "card-title" }, "Live server status"),
      h("p", { class: "muted" }, usesGtps
        ? "Status, players online, and active worlds are read automatically from the GTPS Cloud public API every minute. No Lua script is needed."
        : "SERVER_STATUS_URL in js/config.js is empty, so the landing page uses stats sent by the Lua script below.")
    );

    // 2) Advanced: reporter Lua lama (opsional, untuk peak online).
    const advanced = h("details", { class: "card server-advanced" },
      h("summary", { class: "card-title" }, "Advanced — Lua stats reporter (optional)"));
    if (!usesGtps) advanced.open = true;

    panel.replaceChildren(h("div", { class: "stack" }, ...[intro, liveSection, advanced].filter(Boolean)));

    if (GT.api.isDemo) {
      advanced.append(h("p", { class: "muted" }, "The Lua reporter needs the Supabase backend."));
      return;
    }

    let stats;
    try {
      stats = await admin.getServerStats();
    } catch (error) {
      advanced.append(h("div", { class: "notice notice-warn" }, h("p", {}, `${error.message} If you just updated the website, run the latest supabase/schema.sql.`)));
      return;
    }

    const scriptSlot = h("div", { class: "stack" });

    const generate = h("button", {
      type: "button",
      class: stats.configured ? "btn btn-outline" : "btn btn-primary",
      onclick: async () => {
        if (stats.configured) {
          const ok = await confirmDialog({
            title: "Generate a new token?",
            message: "The old token stops working immediately. You'll need to paste the new script into your server.",
            confirmLabel: "Generate new token",
            danger: true
          });
          if (!ok) return;
        }
        generate.disabled = true;
        try {
          const token = await admin.rotateStatsToken();
          const code = luaScript(token);
          const area = h("textarea", { class: "input mono lua-script", readonly: true, rows: "18", spellcheck: "false", "aria-label": "Lua script" });
          area.value = code;
          scriptSlot.replaceChildren(
            h("div", { class: "notice notice-warn" }, h("p", {}, h("strong", {}, "Copy this now. "), "The token is shown only once. Keep it secret — anyone with it can send fake stats.")),
            area,
            h("div", { class: "modal-actions start no-margin" }, GT.utils.copyButton(code, "Lua script", "btn btn-primary"))
          );
          stats.configured = true;
          generate.textContent = "Generate new token";
          generate.className = "btn btn-outline";
          toast("Token created. Copy the script into your server.", "success");
        } catch (error) {
          toast(error.message, "error");
        }
        generate.disabled = false;
      }
    }, stats.configured ? "Generate new token" : "Generate token & script");

    const online = Boolean(stats.online);
    const reported = stats.reportedAt ? formatDateTime(stats.reportedAt) : "never";

    advanced.append(
      h("p", { class: "muted" }, usesGtps
        ? "Only needed if you also want Peak online tracking. You can delete serverwebsite.lua from your server if you don't."
        : "Sends player and world counts from your game server to the website every ~60 seconds."),
      h("div", { class: "stat-grid" },
        statCard("Lua reporter", online ? "Reporting" : "Not reporting", stats.reportedAt ? `Last report: ${reported}` : "No report received yet"),
        statCard("Peak online", String(stats.peak ?? 0), "Highest players seen"),
        h("div", { class: "stat stat-actions" },
          h("button", {
            type: "button",
            class: "btn btn-ghost btn-sm",
            onclick: async () => {
              const ok = await confirmDialog({ title: "Reset peak?", message: "Peak online will be set to the current player count.", confirmLabel: "Reset" });
              if (!ok) return;
              try {
                await admin.resetPeak();
                toast("Peak reset.", "success");
                renderDashboard();
              } catch (error) {
                toast(error.message, "error");
              }
            }
          }, "Reset peak")
        )
      ),
      h("ol", { class: "instructions server-steps" },
        h("li", {}, "Generate a token below. A ready-to-use Lua script appears with your token inside."),
        h("li", {}, "Add the script to your server's Lua scripts in GTPS Cloud, then restart or reload the scripts.")
      ),
      h("div", { class: "modal-actions start no-margin" }, generate),
      scriptSlot
    );
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  if (GT.api.isDemo) {
    $("#modeBanner").replaceChildren(h("div", { class: "mode-banner" },
      "Demo mode — no login required. Data is stored only in this browser and does not reach real customers. Connect Supabase (js/config.js) for real orders and admin login."));
  }

  // Back/forward browser & perubahan hash → pindah tab sesuai URL.
  function applyUrlTab() {
    const tab = tabFromUrl();
    if (state.session && tab && tab !== state.tab) {
      state.tab = tab;
      renderDashboard();
    }
  }
  window.addEventListener("popstate", applyUrlTab);
  window.addEventListener("hashchange", applyUrlTab);

  (async function init() {
    try {
      state.session = await admin.getSession();
    } catch (error) {
      renderLogin(error.message);
      return;
    }

    if (!state.session) renderLogin();
    else showDashboard();
  })();
})();
