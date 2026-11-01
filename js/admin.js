// GTPLAY v3.4 (server status)
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

  const state = {
    tab: "overview",
    orders: [],
    products: [],
    search: "",
    status: "all",
    session: null
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
      if (event.key === "Escape") close();
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

  function promptDialog({ title, label, value, required, confirmLabel, mono }) {
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
    const [orders, products, storeStatus] = await Promise.all([
      admin.listOrders(),
      admin.listProducts(),
      GT.api.getStoreStatus().catch(() => null)
    ]);
    state.orders = orders;
    state.products = products;
    state.storeStatus = storeStatus;
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

    const fromHash = window.location.hash.replace("#", "");
    if (["overview", "orders", "products", "announcements", "prices", "downloads"].includes(fromHash)) state.tab = fromHash;
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
      ["announcements", "Announcements"],
      ["prices", "BGL Price"],
      ["downloads", "Downloads"]
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
          onclick: () => {
            state.tab = key;
            history.replaceState(null, "", `#${key}`);
            renderDashboard();
          }
        }, label))
      ),
      panel
    );

    if (state.tab === "orders") renderOrders(panel);
    else if (state.tab === "products") renderProducts(panel);
    else if (state.tab === "announcements") renderAnnouncements(panel);
    else if (state.tab === "prices") renderPrices(panel);
    else if (state.tab === "downloads") renderDownloads(panel);
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
        href: "maintenance.html",
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
              href: "#orders",
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
          h("td", {}, formatRupiah(item.unitPrice)),
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
              mono: true
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
      h("div", {}, save)
    );
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
                h("td", { class: "num" }, formatRupiah(product.price)),
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

  function openProductForm(product) {
    const p = product || { name: "", category: "", description: "", price: "", stock: "", active: true, image: "", fallback: "", sortOrder: state.products.length + 1 };
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
          active: active.checked
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
      h("div", { class: "modal-actions start no-margin" }, submit, h("a", { class: "btn btn-ghost", href: "index.html#download", target: "_blank", rel: "noopener" }, "View on site"))
    ));
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  if (GT.api.isDemo) {
    $("#modeBanner").replaceChildren(h("div", { class: "mode-banner" },
      "Demo mode — no login required. Data is stored only in this browser and does not reach real customers. Connect Supabase (js/config.js) for real orders and admin login."));
  }

  // Pindah tab lewat link #hash (mis. admin.html#prices).
  const TABS = ["overview", "orders", "products", "announcements", "prices", "downloads"];
  window.addEventListener("hashchange", () => {
    const tab = window.location.hash.replace("#", "");
    if (state.session && TABS.includes(tab) && tab !== state.tab) {
      state.tab = tab;
      renderDashboard();
    }
  });

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
