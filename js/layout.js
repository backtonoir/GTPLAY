// ==================================================
// GTPLAY SHARED LAYOUT
// --------------------------------------------------
// Dipakai semua halaman toko:
//   • menu navigasi mobile
//   • SATU komponen cart drawer (dibuat dari JS, jadi tidak
//     ada duplikasi markup keranjang di tiap halaman)
//   • badge jumlah item di navbar
//   • memuat katalog produk sekali per halaman
// ==================================================

window.GT = window.GT || {};

GT.layout = (function () {
  const { h, $, formatRupiah, toast, lockScroll, unlockScroll } = GT.utils;

  // ------------------------------------------------
  // CATALOG (dimuat sekali, dipakai store + cart)
  // ------------------------------------------------

  let catalogPromise = null;
  let catalogFailed = false;

  function loadCatalog(force) {
    if (!catalogPromise || force) {
      catalogFailed = false;
      catalogPromise = GT.api.listProducts().then(products => {
        const notices = GT.cart.setCatalog(products);
        notices.forEach(message => toast(message, "info"));
        return products;
      });
    }
    return catalogPromise;
  }

  // ------------------------------------------------
  // MOBILE NAV
  // ------------------------------------------------

  function initNav() {
    const toggle = $("#navToggle");
    const nav = $("#siteNav");
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("open")));
    nav.addEventListener("click", event => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && nav.classList.contains("open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) setOpen(false);
    });

    // Tandai link halaman aktif.
    const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
    nav.querySelectorAll("a[data-page]").forEach(link => {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    });
  }

  // ------------------------------------------------
  // CART DRAWER
  // ------------------------------------------------

  let drawer = null;
  let overlay = null;
  let lastFocus = null;

  function buildDrawer() {
    overlay = h("div", { class: "drawer-overlay", onclick: closeCart });

    drawer = h("aside", {
      class: "cart-drawer",
      id: "cartDrawer",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "cartTitle",
      "aria-hidden": "true"
    },
      h("div", { class: "drawer-header" },
        h("div", {},
          h("p", { class: "eyebrow" }, "Your selection"),
          h("h2", { id: "cartTitle" }, "Shopping Cart")
        ),
        h("button", { class: "icon-button", type: "button", "aria-label": "Close cart", onclick: closeCart }, "×")
      ),
      h("div", { class: "drawer-body", id: "cartLines" }),
      h("div", { class: "drawer-footer", id: "cartFooter" })
    );

    drawer.addEventListener("keydown", trapFocus);
    document.body.append(overlay, drawer);
  }

  function onDocumentKey(event) {
    if (event.key === "Escape") closeCart();
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;

    const focusable = drawer.querySelectorAll("button:not([disabled]), a[href], input:not([disabled])");
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openCart() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    drawer.classList.add("open");
    overlay.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    lockScroll();
    document.addEventListener("keydown", onDocumentKey);
    renderCart();
    requestAnimationFrame(() => drawer.querySelector(".icon-button").focus());
  }

  function closeCart() {
    if (!drawer || !drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    overlay.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onDocumentKey);
    unlockScroll();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function quantityControl(line) {
    const { product, quantity } = line;

    return h("div", { class: "qty", role: "group", "aria-label": `Quantity for ${product.name}` },
      h("button", {
        type: "button",
        class: "qty-btn",
        "aria-label": "Decrease quantity",
        disabled: quantity <= 1,
        onclick: () => GT.cart.setQty(product.id, quantity - 1)
      }, "−"),
      h("span", { class: "qty-value", "aria-live": "polite" }, quantity),
      h("button", {
        type: "button",
        class: "qty-btn",
        "aria-label": "Increase quantity",
        disabled: quantity >= product.stock,
        onclick: () => {
          const result = GT.cart.setQty(product.id, quantity + 1);
          if (!result.ok && result.message) toast(result.message, "error");
        }
      }, "+")
    );
  }

  function renderCart() {
    const count = GT.cart.count();
    document.querySelectorAll("[data-cart-count]").forEach(el => {
      el.textContent = count;
      el.classList.toggle("is-empty", count === 0);
    });

    if (!drawer) return;

    const linesEl = $("#cartLines", drawer);
    const footerEl = $("#cartFooter", drawer);
    linesEl.replaceChildren();
    footerEl.replaceChildren();

    if (!GT.cart.hasCatalog()) {
      linesEl.append(catalogFailed
        ? h("div", { class: "state-block" },
            h("p", { class: "state-title" }, "Couldn't load your cart"),
            h("p", { class: "state-text" }, "Item prices could not be loaded. Check your connection."),
            h("button", { type: "button", class: "btn btn-outline", onclick: () => loadCatalog(true).catch(onCatalogError).finally(renderCart) }, "Try again"))
        : h("div", { class: "state-block" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading cart…"));
      return;
    }

    const lines = GT.cart.lines();

    if (lines.length === 0) {
      linesEl.append(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "Your cart is empty"),
          h("p", { class: "state-text" }, "Browse the store and add the items you need."),
          h("a", { class: "btn btn-outline", href: "index.html#store", onclick: closeCart }, "Browse items")
        )
      );
      return;
    }

    lines.forEach(line => {
      linesEl.append(
        h("div", { class: "cart-line" },
          GT.utils.imageWithFallback({
            src: line.product.image,
            alt: "",
            fallback: line.product.fallback,
            className: "cart-thumb"
          }),
          h("div", { class: "cart-line-body" },
            h("div", { class: "cart-line-top" },
              h("h4", {}, line.product.name),
              h("button", {
                type: "button",
                class: "link-button danger",
                onclick: () => GT.cart.remove(line.product.id)
              }, "Remove")
            ),
            h("p", { class: "cart-line-price" }, `${formatRupiah(line.product.price)} each`),
            h("div", { class: "cart-line-bottom" },
              quantityControl(line),
              h("strong", {}, formatRupiah(line.subtotal))
            )
          )
        )
      );
    });

    footerEl.append(
      h("div", { class: "cart-summary" },
        h("div", { class: "summary-row" }, h("span", {}, "Items"), h("span", {}, String(GT.cart.count()))),
        h("div", { class: "summary-row summary-total" }, h("span", {}, "Total"), h("strong", {}, formatRupiah(GT.cart.total())))
      ),
      h("a", { class: "btn btn-primary btn-block btn-lg", href: "checkout.html" }, "Checkout"),
      h("button", {
        type: "button",
        class: "link-button muted center",
        onclick: async () => {
          const ok = await GT.utils.confirmDialog({
            title: "Clear cart?",
            message: "All items will be removed from your cart.",
            confirmLabel: "Clear cart",
            danger: true
          });
          if (ok) GT.cart.clear();
        }
      }, "Clear cart")
    );
  }

  function initCart(options) {
    const withDrawer = !(options && options.drawer === false);

    if (withDrawer) buildDrawer();

    document.querySelectorAll("[data-open-cart]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        if (withDrawer) openCart();
        else window.location.href = "index.html#store";
      });
    });

    GT.cart.onChange(renderCart);
    renderCart();

    return loadCatalog().catch(error => {
      onCatalogError();
      throw error;
    });
  }

  function onCatalogError() {
    catalogFailed = true;
    renderCart();
  }

  // Link sosial dari config — yang kosong tidak ditampilkan.
  function renderSocial() {
    const list = $("#footerSocial");
    if (!list) return;

    const labels = { instagram: "Instagram", tiktok: "TikTok", discord: "Discord", youtube: "YouTube" };

    Object.entries(GT.config.SOCIAL_LINKS || {}).forEach(([key, url]) => {
      if (!url || !/^https:\/\//.test(url)) return;
      list.append(h("li", {}, h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, labels[key] || key)));
    });
  }

  function init(options) {
    initNav();
    renderSocial();
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();
    return initCart(options);
  }

  return { init, openCart, closeCart, loadCatalog, renderCart };
})();
