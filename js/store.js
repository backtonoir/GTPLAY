// GTPLAY v3.9 (GoPay & BCA)
// ==================================================
// GTPLAY STORE PAGE (index.html)
// --------------------------------------------------
// Search, category filter, sorting, product cards.
// ==================================================

(function () {
  const { h, $, formatRupiah, toast, debounce } = GT.utils;

  const LOW_STOCK = 5;

  const state = {
    products: [],
    search: "",
    category: "All",
    sort: "featured",
    justAdded: null
  };

  const grid = $("#productGrid");
  const chips = $("#categoryChips");
  const meta = $("#resultMeta");
  const searchInput = $("#searchInput");
  const sortSelect = $("#sortSelect");

  // ------------------------------------------------
  // FILTER + SORT
  // ------------------------------------------------

  function visibleProducts() {
    const query = state.search.trim().toLowerCase();

    const filtered = state.products.filter(product => {
      const inCategory = state.category === "All" || product.category === state.category;
      const matches = !query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        (product.description || "").toLowerCase().includes(query);
      return inCategory && matches;
    });

    const sorters = {
      featured: (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      "name-asc": (a, b) => a.name.localeCompare(b.name, "id", { numeric: true }),
      "stock-desc": (a, b) => b.stock - a.stock
    };

    // Item habis selalu di akhir daftar.
    return filtered.sort((a, b) => {
      const soldOut = (a.stock <= 0) - (b.stock <= 0);
      return soldOut || (sorters[state.sort] || sorters.featured)(a, b);
    });
  }

  // ------------------------------------------------
  // RENDER
  // ------------------------------------------------

  function renderChips() {
    const categories = ["All", ...new Set(state.products.map(p => p.category))];

    chips.replaceChildren(...categories.map(category =>
      h("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(state.category === category),
        onclick: () => {
          state.category = category;
          renderChips();
          renderGrid();
        }
      }, category)
    ));
  }

  function stockBadge(product) {
    if (product.stock <= 0) return h("span", { class: "stock-badge out" }, "Sold out");
    if (product.stock <= LOW_STOCK) return h("span", { class: "stock-badge low" }, GT.t("Only {n} left", { n: product.stock }));
    return h("span", { class: "stock-badge" }, GT.t("In stock · {n}", { n: product.stock }));
  }

  function cartQuantity(productId) {
    const line = GT.cart.lines().find(item => item.product.id === productId);
    return line ? line.quantity : 0;
  }

  function addButton(product) {
    const inCart = cartQuantity(product.id);
    const soldOut = product.stock <= 0;
    const maxed = !soldOut && inCart >= product.stock;

    let label = "Add to Cart";
    if (soldOut) label = "Sold out";
    else if (state.justAdded === product.id) label = "Added ✓";
    else if (maxed) label = "Max in cart";

    return h("button", {
      type: "button",
      class: "btn btn-primary btn-sm",
      disabled: soldOut || maxed,
      "aria-label": `${GT.t(label)}: ${product.name}`,
      onclick: () => {
        state.justAdded = product.id;
        const result = GT.cart.add(product.id, 1);
        if (!result.ok) {
          state.justAdded = null;
          updateButtons();
        }
        toast(result.message, result.ok ? "success" : "error");
        clearTimeout(addedTimer);
        addedTimer = setTimeout(() => {
          state.justAdded = null;
          updateButtons();
        }, 1100);
      }
    }, label);
  }

  let addedTimer = null;

  // Hanya tombol yang diperbarui saat keranjang berubah —
  // kartu & gambar tidak dirender ulang.
  function updateButtons() {
    grid.querySelectorAll("[data-add-slot]").forEach(slot => {
      const product = state.products.find(p => p.id === slot.dataset.addSlot);
      if (product) slot.replaceChildren(addButton(product));
    });
  }

  // Harga + harga coret bila sedang diskon.
  function priceBlock(product) {
    return h("div", { class: "price-stack" },
      product.originalPrice
        ? h("s", { class: "price-old" }, h("span", { class: "sr-only" }, GT.t("Normal price") + " "), formatRupiah(product.originalPrice))
        : null,
      h("span", { class: `product-price${product.originalPrice ? " is-sale" : ""}` }, formatRupiah(product.price))
    );
  }

  function promoEnds(product) {
    if (!product.originalPrice || !product.discountEndsAt) return null;
    const date = new Date(product.discountEndsAt).toLocaleString(GT.utils.locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return h("p", { class: "promo-ends" }, GT.t("Promo until {date}", { date }));
  }

  function productCard(product) {
    return h("article", { class: `product-card${product.stock <= 0 ? " sold-out" : ""}${product.originalPrice ? " on-sale" : ""}` },
      h("div", { class: "product-media" },
        GT.utils.imageWithFallback({ src: product.image, alt: product.name, fallback: product.fallback }),
        h("span", { class: "product-tag" }, product.category),
        stockBadge(product),
        product.originalPrice ? h("span", { class: "discount-badge" }, `−${product.discountPercent}%`) : null
      ),
      h("div", { class: "product-body" },
        h("h3", {}, product.name),
        product.description ? h("p", { class: "product-desc" }, product.description) : null,
        promoEnds(product),
        h("div", { class: "product-foot" },
          priceBlock(product),
          h("div", { class: "add-slot", dataset: { addSlot: product.id } }, addButton(product))
        )
      )
    );
  }

  function renderGrid() {
    const list = visibleProducts();
    grid.setAttribute("aria-busy", "false");

    if (state.products.length === 0) {
      meta.textContent = "";
      grid.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "No items yet"),
          h("p", { class: "state-text" }, "New items are coming soon. Check the Announcement page for restocks.")
        )
      );
      return;
    }

    meta.textContent = state.category !== "All"
      ? GT.t(list.length === 1 ? "{n} item in {category}" : "{n} items in {category}", { n: list.length, category: state.category })
      : GT.t(list.length === 1 ? "{n} item" : "{n} items", { n: list.length });

    if (list.length === 0) {
      grid.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "No items found"),
          h("p", { class: "state-text" }, "Try a different keyword or category."),
          h("button", {
            type: "button",
            class: "btn btn-outline",
            onclick: () => {
              state.search = "";
              state.category = "All";
              searchInput.value = "";
              renderChips();
              renderGrid();
            }
          }, "Reset filters")
        )
      );
      return;
    }

    grid.replaceChildren(...list.map(productCard));
  }

  function renderSkeletons() {
    grid.setAttribute("aria-busy", "true");
    grid.replaceChildren(...Array.from({ length: 6 }, () =>
      h("div", { class: "product-card skeleton-card", "aria-hidden": "true" },
        h("div", { class: "product-media skeleton" }),
        h("div", { class: "product-body" },
          h("div", { class: "skeleton skeleton-line" }),
          h("div", { class: "skeleton skeleton-line short" }),
          h("div", { class: "skeleton skeleton-line short" })
        )
      )
    ));
  }

  function renderError(error) {
    grid.setAttribute("aria-busy", "false");
    meta.textContent = "";
    if (error) console.error("[GTPLAY] Store load failed:", error);
    grid.replaceChildren(
      h("div", { class: "state-block" },
        h("p", { class: "state-title" }, "Couldn't load the store"),
        h("p", { class: "state-text" }, "Please check your connection and try again."),
        error && error.code === "CONFIG" ? h("p", { class: "help error-detail" }, error.message) : null,
        h("button", { type: "button", class: "btn btn-outline", onclick: load }, "Try again")
      )
    );
  }

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------

  function load(catalogPromise) {
    renderSkeletons();
    const promise = catalogPromise instanceof Promise ? catalogPromise : GT.layout.loadCatalog(true);

    promise
      .then(products => {
        state.products = products;
        renderChips();
        renderGrid();
      })
      .catch(renderError);
  }

  searchInput.addEventListener("input", debounce(() => {
    state.search = searchInput.value;
    renderGrid();
  }, 150));

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    renderGrid();
  });

  // Tombol "Add" ikut diperbarui saat isi keranjang berubah.
  GT.cart.onChange(() => {
    if (state.products.length) updateButtons();
  });

  const catalog = GT.layout.init();
  catalog.catch(() => {});
  load(catalog);

  if (GT.utils.getParam("cart") === "open") {
    catalog.finally(() => GT.layout.openCart());
  }
})();
