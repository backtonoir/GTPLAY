// ==================================================
// GTPLAY ACCOUNT PAGE (account.html)
// --------------------------------------------------
// Login pembeli dengan Discord (Supabase Auth). Setelah
// login, pesanan yang tersimpan di perangkat ini otomatis
// ditautkan ke akun, lalu semua pesanan akun ditampilkan
// sehingga bisa dibuka dari perangkat mana pun tanpa
// kode akses.
// ==================================================

(function () {
  const { h, $, formatRupiah, formatDateTime, statusBadge, toast } = GT.utils;
  const auth = GT.api.auth;
  const root = $("#accountRoot");
  const LINKED_KEY = "gtplay:linked-orders";

  const DISCORD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>';

  function icon(svg) {
    const span = h("span", { class: "btn-icon" });
    span.innerHTML = svg; // SVG statis.
    return span;
  }

  // Hanya path di situs ini (cegah open redirect).
  function safeNext() {
    const next = GT.utils.getParam("next") || "";
    return /^\/(?!\/)[\w\-./?=&#%]*$/.test(next) ? next : "";
  }

  function readHashError() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    return hash.get("error_description") || query.get("error_description") || "";
  }

  function cleanUrl() {
    const next = safeNext();
    history.replaceState(null, "", "/account" + (next ? "?next=" + encodeURIComponent(next) : ""));
  }

  function notice(kind, text) {
    return h("div", { class: `notice notice-${kind}` }, h("p", {}, text));
  }

  // ------------------------------------------------
  // BELUM LOGIN
  // ------------------------------------------------

  function renderSignedOut(errorText) {
    const errorEl = h("p", { class: "error-text", role: "alert" }, errorText || "");
    const btn = h("button", { class: "btn btn-primary btn-lg btn-block discord-btn", type: "button" },
      icon(DISCORD_ICON), h("span", {}, "Login with Discord"));

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      errorEl.textContent = "";
      try {
        await auth.signInWithDiscord(safeNext());
        // Browser akan pindah ke halaman Discord.
      } catch (error) {
        btn.disabled = false;
        errorEl.textContent = error.message;
      }
    });

    root.replaceChildren(
      h("div", { class: "account-signin card" },
        h("h2", { class: "card-title" }, "Login to your account"),
        h("ul", { class: "account-perks" },
          h("li", {}, "See every order you made, from any device."),
          h("li", {}, "No need to save the Order ID and access code."),
          h("li", {}, "Orders saved on this device are added to your account automatically.")
        ),
        btn,
        errorEl,
        h("p", { class: "help" }, "We only read your Discord username and avatar. Login is optional — you can still buy without an account.")
      )
    );
  }

  // ------------------------------------------------
  // SUDAH LOGIN
  // ------------------------------------------------

  function linkedSet(userId) {
    const all = GT.utils.storage.get(LINKED_KEY, {});
    return { all, list: Array.isArray(all[userId]) ? all[userId] : [] };
  }

  // Tautkan pesanan di perangkat ini ke akun (sekali per pesanan).
  async function linkDeviceOrders(user) {
    const { all, list } = linkedSet(user.id);
    const pending = GT.api.myOrders.list().filter(ref => !list.includes(ref.id));
    let linked = 0;

    for (const ref of pending) {
      try {
        await GT.api.linkOrder(ref.id, ref.code);
        linked += 1;
        list.push(ref.id);
      } catch (error) {
        if (error.code === "ACCOUNTS_DISABLED") throw error;
        // Pesanan sudah dihapus / milik akun lain → jangan dicoba lagi.
        if (error.code === "ORDER_NOT_FOUND" || error.code === "ORDER_LINKED") list.push(ref.id);
      }
    }

    all[user.id] = list.slice(-100);
    GT.utils.storage.set(LINKED_KEY, all);
    return linked;
  }

  function orderItem(order) {
    const items = (order.items || []).map(item => `${item.name} ×${item.quantity}`).join(", ");
    return h("li", {},
      h("a", { class: "account-order", href: `/payment?order=${encodeURIComponent(order.id)}` },
        h("div", { class: "account-order-head" },
          h("span", { class: "order-id mono" }, order.id),
          statusBadge(order.status)
        ),
        h("p", { class: "account-order-items" }, items || "—"),
        h("div", { class: "account-order-foot" },
          h("span", { class: "muted" }, formatDateTime(order.createdAt)),
          h("strong", {}, formatRupiah(order.total))
        )
      )
    );
  }

  function linkForm(onLinked) {
    const idInput = h("input", { class: "input mono", id: "linkOrderId", placeholder: "GTPLAY-20261101-XXXXXX", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", required: true });
    const codeInput = h("input", { class: "input mono", id: "linkCode", placeholder: "8 characters", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "8", required: true });
    const errorEl = h("p", { class: "error-text", role: "alert" });
    const btn = h("button", { class: "btn btn-outline btn-block", type: "submit" }, "Add to my account");

    const form = h("form", { class: "card", novalidate: true },
      h("h2", { class: "card-title" }, "Add an older order"),
      h("p", { class: "help" }, "Ordered on another device or before logging in? Enter the Order ID and access code once to add it to your account."),
      h("div", { class: "field" }, h("label", { class: "label", for: "linkOrderId" }, "Order ID"), idInput),
      h("div", { class: "field" }, h("label", { class: "label", for: "linkCode" }, "Access code"), codeInput),
      errorEl,
      btn
    );

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const orderId = idInput.value.trim().toUpperCase();
      const code = codeInput.value.trim().toUpperCase();
      errorEl.textContent = "";
      if (!orderId || !code) {
        errorEl.textContent = GT.t("Enter both the Order ID and the access code.");
        return;
      }
      btn.disabled = true;
      try {
        await GT.api.linkOrder(orderId, code);
        GT.api.myOrders.add({ id: orderId, code });
        idInput.value = "";
        codeInput.value = "";
        toast(GT.t("Order added to your account."), "success");
        onLinked();
      } catch (error) {
        errorEl.textContent = error.message;
      } finally {
        btn.disabled = false;
      }
    });

    return form;
  }

  async function renderSignedIn(user) {
    const listEl = h("ul", { class: "account-orders" }, h("li", { class: "help" }, "Loading…"));
    const statusEl = h("div");

    const avatar = user.avatar
      ? h("img", { class: "account-profile-avatar", src: user.avatar, alt: "", width: 64, height: 64, referrerpolicy: "no-referrer" })
      : h("span", { class: "account-profile-avatar is-empty", "aria-hidden": "true" }, (user.name || "?").slice(0, 1).toUpperCase());

    const nameEl = h("p", { class: "account-profile-name" });
    nameEl.textContent = user.name; // Nama Discord: jangan diterjemahkan.
    const handleEl = h("p", { class: "muted account-profile-handle" });
    handleEl.textContent = user.handle && user.handle !== user.name ? "@" + user.handle : (user.provider === "discord" ? "Discord" : user.email);

    const signOutBtn = h("button", { class: "btn btn-outline btn-sm", type: "button" }, "Log out");
    signOutBtn.addEventListener("click", async () => {
      signOutBtn.disabled = true;
      try { await auth.signOut(); } catch (error) { /* tetap lanjut */ }
      window.location.replace("/account");
    });

    async function loadOrders() {
      try {
        const orders = await GT.api.listMyOrders();
        if (!orders.length) {
          listEl.replaceChildren(h("li", { class: "help" }, "No orders yet. Orders you make while logged in will appear here."));
        } else {
          listEl.replaceChildren(...orders.map(orderItem));
        }
      } catch (error) {
        listEl.replaceChildren();
        statusEl.replaceChildren(notice(error.code === "ACCOUNTS_DISABLED" ? "info" : "danger",
          error.code === "ACCOUNTS_DISABLED" ? GT.t("Order history is not available yet. Admin needs to finish the account setup.") : error.message));
      }
    }

    root.replaceChildren(
      h("div", { class: "split account-grid" },
        h("div", { class: "stack" },
          h("div", { class: "card" },
            h("div", { class: "account-orders-head" },
              h("h2", { class: "card-title" }, "My orders"),
              h("a", { class: "btn btn-primary btn-sm", href: "/store" }, "Shop")
            ),
            statusEl,
            listEl
          )
        ),
        h("aside", { class: "stack sticky-col" },
          h("div", { class: "card account-profile" },
            avatar,
            h("div", { class: "account-profile-text" }, nameEl, handleEl),
            signOutBtn
          ),
          linkForm(loadOrders)
        )
      )
    );

    try {
      const linked = await linkDeviceOrders(user);
      if (linked > 0) toast(GT.t("{count} order(s) from this device were added to your account.", { count: linked }), "success");
    } catch (error) {
      /* Ditangani oleh loadOrders (ACCOUNTS_DISABLED). */
    }
    await loadOrders();
  }

  // ------------------------------------------------
  // START
  // ------------------------------------------------

  async function start() {
    if (!auth || !auth.available) {
      root.replaceChildren(notice("info", "Login is not available in demo mode. Connect Supabase first (see js/config.js)."));
      return;
    }

    const hashError = readHashError();
    const fromRedirect = /access_token=|[?&]code=/.test(window.location.hash + window.location.search);

    let user = null;
    try {
      user = await auth.getUser(); // supabase-js juga membaca token dari URL.
    } catch (error) {
      renderSignedOut(error.message);
      return;
    }
    if (fromRedirect || hashError) cleanUrl();

    if (!user) {
      renderSignedOut(hashError);
      return;
    }

    const next = safeNext();
    if (fromRedirect && next) {
      // Tautkan pesanan perangkat dulu supaya halaman tujuan bisa langsung dibuka.
      try { await linkDeviceOrders(user); } catch (error) { /* abaikan */ }
      window.location.replace(next);
      return;
    }

    renderSignedIn(user);
  }

  GT.layout.init().catch(() => {});
  start();
})();
