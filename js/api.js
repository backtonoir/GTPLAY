// GTPLAY v3.9 (GoPay & BCA)
// ==================================================
// GTPLAY DATA LAYER
// --------------------------------------------------
// Semua halaman memanggil GT.api.* — tidak ada halaman
// yang menyentuh localStorage pesanan atau Supabase secara
// langsung. Ada dua adapter dengan perilaku yang sama:
//
//   DEMO      (SUPABASE_URL kosong)
//             Data pesanan & produk disimpan di browser ini.
//             Cocok untuk mencoba alur; BUKAN transaksi nyata.
//
//   SUPABASE  (SUPABASE_URL + SUPABASE_ANON_KEY diisi)
//             Harga, stok, Order ID, kedaluwarsa, status, dan
//             autentikasi admin ditangani server (lihat
//             supabase/schema.sql). Frontend tidak dipercaya.
//
// Aturan bisnis (transisi status, reservasi stok) dibuat
// identik di kedua adapter.
// ==================================================

window.GT = window.GT || {};

GT.api = (function () {
  const { storage, randomCode, validateGrowId } = GT.utils;

  const MAX_LINES = 20;
  const MAX_PENDING_PER_GROWID = 3;
  const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp"];

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const MESSAGES = {
    INVALID_GROWID: "GrowID is not valid.",
    EMPTY_CART: "Your cart is empty.",
    TOO_MANY_ITEMS: "An order can contain up to {max} different items.",
    INVALID_QTY: "One of the quantities is not valid.",
    PRODUCT_UNAVAILABLE: "An item in your cart is no longer available.",
    OUT_OF_STOCK: "Not enough stock for one of the items.",
    TOO_MANY_PENDING: "This GrowID already has several unpaid orders. Finish or cancel them first.",
    ORDER_NOT_FOUND: "Order not found. Check the Order ID and access code.",
    ORDER_EXPIRED: "This payment session has expired.",
    INVALID_STATUS: "This order can no longer be changed from here.",
    PROOF_REQUIRED: "Please attach your payment proof.",
    PROOF_INVALID: "Payment proof must be a PNG, JPG, or WEBP image.",
    PROOF_TOO_LARGE: "Payment proof must be smaller than {mb} MB.",
    NOT_ADMIN: "This account is not an admin.",
    NOT_SIGNED_IN: "Please sign in.",
    INVALID_TRANSITION: "That status change is not allowed.",
    INVALID_PRODUCT: "Product data is not valid.",
    MAINTENANCE: "The store is under maintenance. New orders are paused for now.",
    INVALID_LINK: "Download links must start with https://",
    INVALID_ANNOUNCEMENT: "Announcement needs a title, content, and date.",
    INVALID_PRICE: "Price must be a whole number above 0 with a valid date.",
    REDEEM_REQUIRED: "Enter the redeem code before marking this order as completed.",
    REDEEM_DUPLICATE: "This redeem code is already used in another order.",
    REVIEW_NOT_ALLOWED: "You can review an order after it is completed.",
    REVIEW_EXISTS: "You already reviewed this order.",
    INVALID_REVIEW: "Pick a rating from 1 to 5 stars. Comments can be up to 300 characters.",
    INVALID_DISCOUNT: "Discount must be a whole number from 0 to 90 percent.",
    NETWORK: "Could not reach the server. Check your connection and try again."
  };

  // Pesan error mengikuti bahasa yang dipilih (GT.t dari js/i18n.js).
  function message(code, detail) {
    const tr = (text, vars) => (GT.t ? GT.t(text, vars) : text);
    const template = MESSAGES[code];
    if (!template) return detail || tr("Something went wrong.");
    const text = tr(template, { max: MAX_LINES, mb: GT.config.MAX_PROOF_MB });
    return code === "REDEEM_DUPLICATE" && detail ? `${text} (${detail})` : text;
  }

  function fail(code, detail) {
    throw new ApiError(code, message(code, detail));
  }

  // ------------------------------------------------
  // SHARED BUSINESS RULES
  // ------------------------------------------------

  // Status yang melepas reservasi stok.
  const RELEASED = ["expired", "cancelled", "rejected"];

  // Transisi yang boleh dilakukan admin. (Sama dengan SQL.)
  const ADMIN_TRANSITIONS = {
    pending_payment: ["payment_verified", "rejected", "cancelled"],
    payment_submitted: ["payment_verified", "rejected", "cancelled"],
    payment_verified: ["processing", "completed", "cancelled"],
    processing: ["completed", "cancelled"],
    // Pembayaran QRIS bisa masuk setelah sesi habis —
    // admin boleh tetap memverifikasi (stok direservasi ulang).
    expired: ["payment_verified"],
    completed: [],
    cancelled: [],
    rejected: []
  };

  function validateAnnouncement(item) {
    if (!String(item.title || "").trim() || !String(item.content || "").trim()) fail("INVALID_ANNOUNCEMENT");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.publishedOn || ""))) fail("INVALID_ANNOUNCEMENT");
    if (!["event", "update", "maintenance"].includes(item.category)) fail("INVALID_ANNOUNCEMENT");
  }

  function validateLockPrice(entry) {
    const price = Number(entry.price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.recordedOn || ""))) fail("INVALID_PRICE");
    if (!Number.isInteger(price) || price <= 0) fail("INVALID_PRICE");
  }

  function validateDownloads(links) {
    Object.values(links).forEach(url => {
      const value = String(url || "").trim();
      if (value && !/^https:\/\//.test(value)) fail("INVALID_LINK");
    });
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  // ------------------------------------------------
  // SERVER STATUS (GTPS Cloud)
  // --------------------------------------------------
  // Website membaca JSON ternormalisasi dari SERVER_STATUS_URL:
  //   { "online": true, "players": 12, "worlds": 3, "maxPlayers": 8000, "uptime": "3h 2m" }
  // Default: /api/server-status (Vercel function di folder api/)
  // yang mengambil data dari API publik GTPS Cloud.
  // ------------------------------------------------

  async function getServerStatus(statsFromBackend) {
    const url = GT.config.SERVER_STATUS_URL;
    // Tanpa URL khusus → pakai statistik yang dikirim script Lua ke Supabase.
    if (!url) return statsFromBackend ? statsFromBackend() : { configured: false };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const toNumber = value => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

      // Mendukung JSON dari /api/server-status maupun format asli GTPS Cloud
      // ({ state: { server_status: 1, players_online, active_worlds } }).
      const src = data && typeof data.state === "object" && data.state ? data.state : data;
      const rawStatus = src.server_status !== undefined
        ? (Number(src.server_status) === 1 || String(src.server_status).toLowerCase() === "online")
        : src.online;

      return {
        configured: true,
        online: Boolean(rawStatus),
        players: toNumber(src.players ?? src.players_online),
        peak: toNumber(src.peak ?? src.record_online),
        worlds: toNumber(src.worlds ?? src.active_worlds),
        maxPlayers: toNumber(src.maxPlayers),
        uptime: typeof data.uptime === "string" ? data.uptime : null,
        updatedAt: data.updatedAt || new Date().toISOString()
      };
    } catch (error) {
      return { configured: true, error: true };
    } finally {
      clearTimeout(timer);
    }
  }

  function validateProof(file) {
    if (!file) fail("PROOF_REQUIRED");
    if (!PROOF_TYPES.includes(file.type)) fail("PROOF_INVALID");
    if (file.size > GT.config.MAX_PROOF_MB * 1024 * 1024) fail("PROOF_TOO_LARGE");
  }

  function validateProduct(product) {
    const price = Number(product.price);
    const stock = Number(product.stock);

    if (!String(product.name || "").trim()) fail("INVALID_PRODUCT");
    if (!String(product.category || "").trim()) fail("INVALID_PRODUCT");
    if (!Number.isInteger(price) || price < 0) fail("INVALID_PRODUCT");
    if (!Number.isInteger(stock) || stock < 0) fail("INVALID_PRODUCT");

    const percent = Number(product.discountPercent || 0);
    if (!Number.isInteger(percent) || percent < 0 || percent > 90) fail("INVALID_DISCOUNT");
    if (product.discountEndsAt && Number.isNaN(new Date(product.discountEndsAt).getTime())) fail("INVALID_DISCOUNT");
  }

  // ------------------------------------------------
  // DISKON
  // --------------------------------------------------
  // Sama dengan gt_effective_price() di schema.sql. Di mode
  // Supabase, harga yang ditagih tetap dihitung ulang server.
  // ------------------------------------------------

  function discountActive(product, now) {
    const percent = Number(product.discountPercent || 0);
    if (percent <= 0) return false;
    if (!product.discountEndsAt) return true;
    return new Date(product.discountEndsAt).getTime() > (now || Date.now());
  }

  function effectivePrice(product, now) {
    const base = Number(product.price) || 0;
    return discountActive(product, now) ? Math.round(base * (100 - Number(product.discountPercent)) / 100) : base;
  }

  // Produk untuk pembeli: price = harga akhir, originalPrice = harga normal.
  function toCustomerProduct(product) {
    const active = discountActive(product);
    return {
      ...product,
      price: effectivePrice(product),
      originalPrice: active ? Number(product.price) : null,
      discountPercent: active ? Number(product.discountPercent) : 0,
      discountEndsAt: active ? product.discountEndsAt || null : null
    };
  }

  // Redeem code → daftar code unik (sama dengan gt_redeem_lines di SQL).
  function redeemLines(text) {
    return [...new Set(String(text || "").split(/\r?\n/).map(line => line.trim().toUpperCase()).filter(Boolean))];
  }

  function validateReview(rating, comment) {
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) fail("INVALID_REVIEW");
    if (String(comment || "").trim().length > 300) fail("INVALID_REVIEW");
  }

  function maskName(growId) {
    const name = String(growId || "");
    return name.slice(0, 2) + "*".repeat(Math.max(name.length - 3, 1)) + name.slice(-1);
  }

  // Order ID: GTPLAY-YYYYMMDD-XXXXXX (6 karakter acak dari crypto).
  // Di mode Supabase, ID dibuat server + dijaga UNIQUE constraint.
  function makeOrderId() {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("");

    return `GTPLAY-${date}-${randomCode(6)}`;
  }

  // ------------------------------------------------
  // DEVICE ORDER REFERENCES
  // --------------------------------------------------
  // Daftar Order ID + kode akses milik perangkat ini, agar
  // pembeli bisa kembali ke pesanannya. Tidak menyimpan data
  // pembayaran apa pun.
  // ------------------------------------------------

  const MY_ORDERS_KEY = "gtplay:my-orders";

  const myOrders = {
    list() {
      return storage.get(MY_ORDERS_KEY, []).filter(ref => ref && ref.id && ref.code);
    },
    add(ref) {
      const list = this.list().filter(item => item.id !== ref.id);
      list.unshift({ id: ref.id, code: ref.code, createdAt: ref.createdAt || new Date().toISOString() });
      storage.set(MY_ORDERS_KEY, list.slice(0, 20));
    },
    codeFor(orderId) {
      const ref = this.list().find(item => item.id === orderId);
      return ref ? ref.code : null;
    },
    remove(orderId) {
      storage.set(MY_ORDERS_KEY, this.list().filter(item => item.id !== orderId));
    }
  };

  // ================================================
  // DEMO ADAPTER (localStorage)
  // ================================================

  const demo = (function () {
    const PRODUCTS_KEY = "gtplay:demo:products";
    const SETTINGS_KEY = "gtplay:demo:settings";
    const ANNOUNCEMENTS_KEY = "gtplay:demo:announcements";
    const PRICES_KEY = "gtplay:demo:lock-prices";
    const REVIEWS_KEY = "gtplay:demo:reviews";

    function loadReviews() {
      const saved = storage.get(REVIEWS_KEY, []);
      return Array.isArray(saved) ? saved : [];
    }

    function saveReviews(list) {
      storage.set(REVIEWS_KEY, list);
    }

    function redeemConflicts(orders, orderId, codes) {
      const wanted = redeemLines(codes);
      const used = new Set();
      Object.values(orders).forEach(order => {
        if (order.id !== orderId && order.redeemCode) redeemLines(order.redeemCode).forEach(code => used.add(code));
      });
      return wanted.filter(code => used.has(code));
    }

    function loadSettings() {
      const saved = storage.get(SETTINGS_KEY, null);
      return {
        maintenance: false,
        message: "",
        eta: "",
        ...(saved || {}),
        downloads: { windows: "", android: "", ios: "", mac: "", ...((saved && saved.downloads) || {}) }
      };
    }

    function loadAnnouncements() {
      const saved = storage.get(ANNOUNCEMENTS_KEY, null);
      return Array.isArray(saved) ? saved : (GT.seedAnnouncements || []).map(item => ({ ...item }));
    }

    function sortAnnouncements(list) {
      return list.slice().sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || String(b.createdAt).localeCompare(String(a.createdAt)));
    }

    function loadPrices() {
      const saved = storage.get(PRICES_KEY, []);
      return (Array.isArray(saved) ? saved : []).slice().sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    }
    const ORDERS_KEY = "gtplay:demo:orders";

    function loadProducts() {
      const saved = storage.get(PRODUCTS_KEY, null);
      return Array.isArray(saved) ? saved : GT.seedProducts.map(p => ({ ...p }));
    }

    function saveProducts(list) {
      storage.set(PRODUCTS_KEY, list);
    }

    function loadOrders() {
      return storage.get(ORDERS_KEY, {});
    }

    function saveOrders(orders) {
      storage.set(ORDERS_KEY, orders);
    }

    function adjustStock(products, items, direction) {
      items.forEach(item => {
        const product = products.find(p => p.id === item.productId);
        if (product) product.stock = Math.max(0, product.stock + direction * item.quantity);
      });
    }

    function pushEvent(order, status, note, actor) {
      order.status = status;
      order.updatedAt = new Date().toISOString();
      order.events.push({ status, note: note || "", actor: actor || "system", at: order.updatedAt });
    }

    // Kedaluwarsa "malas": dicek setiap kali data dibaca.
    function sweepExpired() {
      const orders = loadOrders();
      const products = loadProducts();
      const now = Date.now();
      let changed = false;

      Object.values(orders).forEach(order => {
        if (order.status === "pending_payment" && now >= new Date(order.expiresAt).getTime()) {
          pushEvent(order, "expired", "Payment window ended.", "system");
          adjustStock(products, order.items, +1);
          changed = true;
        }
      });

      if (changed) {
        saveOrders(orders);
        saveProducts(products);
      }

      return orders;
    }

    // Pembeli baru melihat redeem code setelah Completed (sama dengan SQL).
    function publicOrder(order, includePrivate) {
      const copy = JSON.parse(JSON.stringify(order));
      delete copy.accessCode;
      if (!copy.redeemCode) copy.redeemCode = null;
      if (!includePrivate && copy.status !== "completed") copy.redeemCode = null;
      const review = loadReviews().find(item => item.orderId === order.id);
      copy.review = review ? { rating: review.rating, comment: review.comment, status: review.status, createdAt: review.createdAt } : null;
      return copy;
    }

    function findOwned(orderId, accessCode) {
      const orders = sweepExpired();
      const order = orders[String(orderId || "").trim().toUpperCase()];

      if (!order || order.accessCode !== String(accessCode || "").trim().toUpperCase()) {
        fail("ORDER_NOT_FOUND");
      }

      return { orders, order };
    }

    return {
      mode: "demo",

      async getStoreStatus() {
        return loadSettings();
      },

      getServerStatus,

      async listAnnouncements(limit) {
        const list = sortAnnouncements(loadAnnouncements().filter(item => item.published));
        return limit ? list.slice(0, limit) : list;
      },

      async listLockPrices() {
        return loadPrices();
      },

      async listProducts() {
        return loadProducts().filter(p => p.active).map(toCustomerProduct);
      },

      async listReviews(limit) {
        const approved = loadReviews().filter(item => item.status === "approved");
        const orders = storage.get(ORDERS_KEY, {});
        const shuffled = approved.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(limit || 6, 12));
        const average = approved.length ? Math.round(approved.reduce((sum, r) => sum + r.rating, 0) / approved.length * 10) / 10 : null;
        return {
          count: approved.length,
          average,
          items: shuffled.map(review => {
            const order = orders[review.orderId];
            return {
              name: maskName(review.growId),
              rating: review.rating,
              comment: review.comment,
              createdAt: review.createdAt,
              items: order ? [...new Set(order.items.map(item => item.name))].join(", ") : ""
            };
          })
        };
      },

      async submitReview(orderId, accessCode, rating, comment) {
        validateReview(rating, comment);
        const { order } = findOwned(orderId, accessCode);
        if (order.status !== "completed") fail("REVIEW_NOT_ALLOWED");
        const list = loadReviews();
        if (list.some(item => item.orderId === order.id)) fail("REVIEW_EXISTS");
        list.push({
          id: `rev-${randomCode(8, "0123456789abcdef")}`,
          orderId: order.id,
          growId: order.growId,
          rating: Number(rating),
          comment: String(comment || "").replace(/[\u0000-\u001f]+/g, " ").trim(),
          status: "pending",
          createdAt: new Date().toISOString()
        });
        saveReviews(list);
        return publicOrder(order);
      },

      async createOrder({ growId, items }) {
        if (loadSettings().maintenance) fail("MAINTENANCE");
        const check = validateGrowId(growId);
        if (!check.ok) fail("INVALID_GROWID");
        if (!Array.isArray(items) || items.length === 0) fail("EMPTY_CART");
        if (items.length > MAX_LINES) fail("TOO_MANY_ITEMS");

        const orders = sweepExpired();
        const products = loadProducts();

        const pending = Object.values(orders).filter(o =>
          o.growId.toLowerCase() === check.value.toLowerCase() && o.status === "pending_payment"
        );
        if (pending.length >= MAX_PENDING_PER_GROWID) fail("TOO_MANY_PENDING");

        // Harga & stok selalu dibaca ulang dari katalog — bukan dari keranjang.
        const lines = items.map(item => {
          const quantity = Number(item.quantity);
          if (!Number.isInteger(quantity) || quantity < 1) fail("INVALID_QTY");

          const product = products.find(p => p.id === item.productId && p.active);
          if (!product) fail("PRODUCT_UNAVAILABLE");
          if (product.stock < quantity) fail("OUT_OF_STOCK");

          const unitPrice = effectivePrice(product);
          return {
            productId: product.id,
            name: product.name,
            unitPrice,
            listPrice: product.price,
            quantity,
            subtotal: unitPrice * quantity
          };
        });

        let orderId = makeOrderId();
        while (orders[orderId]) orderId = makeOrderId();

        const createdAt = new Date();
        const order = {
          id: orderId,
          accessCode: randomCode(8),
          growId: check.value,
          status: "pending_payment",
          items: lines,
          total: lines.reduce((sum, line) => sum + line.subtotal, 0),
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + GT.config.PAYMENT_WINDOW_MINUTES * 60000).toISOString(),
          proofName: null,
          proofSubmittedAt: null,
          adminNote: "",
          events: [{ status: "pending_payment", note: "Order created.", actor: "customer", at: createdAt.toISOString() }]
        };

        adjustStock(products, lines, -1);
        orders[orderId] = order;
        saveProducts(products);
        saveOrders(orders);

        return { orderId, accessCode: order.accessCode, expiresAt: order.expiresAt };
      },

      async getOrder(orderId, accessCode) {
        return publicOrder(findOwned(orderId, accessCode).order);
      },

      async submitPayment(orderId, accessCode, file, method) {
        validateProof(file);
        const { orders, order } = findOwned(orderId, accessCode);

        if (order.status === "expired") fail("ORDER_EXPIRED");
        if (order.status !== "pending_payment") fail("INVALID_STATUS");

        // Demo: gambar TIDAK disimpan (localStorage bukan tempat file
        // pembayaran). Hanya nama file sebagai catatan.
        order.proofName = file.name;
        const m = String(method || "").toLowerCase();
        if (/^[a-z0-9_-]{1,20}$/.test(m)) order.paymentMethod = m;
        order.proofSubmittedAt = new Date().toISOString();
        pushEvent(order, "payment_submitted", "Payment proof submitted.", "customer");
        saveOrders(orders);

        return publicOrder(order);
      },

      async cancelOrder(orderId, accessCode) {
        const { orders, order } = findOwned(orderId, accessCode);
        if (order.status !== "pending_payment") fail("INVALID_STATUS");

        const products = loadProducts();
        adjustStock(products, order.items, +1);
        pushEvent(order, "cancelled", "Cancelled by customer.", "customer");
        saveProducts(products);
        saveOrders(orders);

        return publicOrder(order);
      },

      admin: {
        requiresAuth: false,

        async getSession() {
          return { email: "demo@local", demo: true };
        },
        async signIn() {
          return { email: "demo@local", demo: true };
        },
        async signOut() {},

        async listOrders() {
          return Object.values(sweepExpired())
            .map(order => publicOrder(order, true))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },

        async getOrder(orderId) {
          const order = sweepExpired()[orderId];
          if (!order) fail("ORDER_NOT_FOUND");
          return { ...publicOrder(order, true), proofUrl: null };
        },

        async updateStatus(orderId, nextStatus, note, redeemCode) {
          const orders = sweepExpired();
          const order = orders[orderId];
          if (!order) fail("ORDER_NOT_FOUND");

          const allowed = ADMIN_TRANSITIONS[order.status] || [];
          if (!allowed.includes(nextStatus)) fail("INVALID_TRANSITION");

          const products = loadProducts();
          const wasReleased = RELEASED.includes(order.status);
          const willRelease = RELEASED.includes(nextStatus);

          if (wasReleased && !willRelease) {
            // Reservasi ulang (mis. expired → payment_verified).
            order.items.forEach(item => {
              const product = products.find(p => p.id === item.productId);
              if (!product || product.stock < item.quantity) fail("OUT_OF_STOCK");
            });
            adjustStock(products, order.items, -1);
          } else if (!wasReleased && willRelease) {
            adjustStock(products, order.items, +1);
          }

          const redeem = String(redeemCode || "").trim();
          if (nextStatus === "completed" && !redeem && !order.redeemCode) fail("REDEEM_REQUIRED");
          const duplicates = redeem ? redeemConflicts(orders, order.id, redeem) : [];
          if (duplicates.length) fail("REDEEM_DUPLICATE", duplicates.join(", "));

          if (note) order.adminNote = note;
          if (redeem) order.redeemCode = redeem;
          pushEvent(order, nextStatus, note, "admin");
          saveProducts(products);
          saveOrders(orders);

          return publicOrder(order, true);
        },

        async setRedeemCode(orderId, redeemCode) {
          const orders = sweepExpired();
          const order = orders[orderId];
          if (!order) fail("ORDER_NOT_FOUND");
          if (!["payment_verified", "processing", "completed"].includes(order.status)) fail("INVALID_STATUS");

          const redeem = String(redeemCode || "").trim();
          if (!redeem && order.status === "completed") fail("REDEEM_REQUIRED");
          const duplicates = redeem ? redeemConflicts(orders, order.id, redeem) : [];
          if (duplicates.length) fail("REDEEM_DUPLICATE", duplicates.join(", "));

          order.redeemCode = redeem || null;
          order.updatedAt = new Date().toISOString();
          saveOrders(orders);
          return publicOrder(order, true);
        },

        async checkRedeemCodes(orderId, codes) {
          return { codes: redeemLines(codes), duplicates: redeemConflicts(sweepExpired(), orderId, codes) };
        },

        async listReviews() {
          return loadReviews().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },

        async setReviewStatus(id, status) {
          if (!["pending", "approved", "hidden"].includes(status)) fail("INVALID_REVIEW");
          saveReviews(loadReviews().map(item => (item.id === id ? { ...item, status } : item)));
        },

        async deleteReview(id) {
          saveReviews(loadReviews().filter(item => item.id !== id));
        },

        async listProducts() {
          return loadProducts();
        },

        async saveProduct(input) {
          validateProduct(input);
          const products = loadProducts();
          const index = products.findIndex(p => p.id === input.id);

          const product = {
            id: input.id || `item-${randomCode(6, "0123456789abcdefghijklmnopqrstuvwxyz")}`,
            name: input.name.trim(),
            category: input.category.trim(),
            description: (input.description || "").trim(),
            price: Number(input.price),
            stock: Number(input.stock),
            active: Boolean(input.active),
            image: (input.image || "").trim(),
            fallback: (input.fallback || input.name).trim().slice(0, 10).toUpperCase(),
            sortOrder: Number(input.sortOrder) || products.length + 1,
            discountPercent: Number(input.discountPercent || 0),
            discountEndsAt: input.discountEndsAt || null
          };

          if (index >= 0) products[index] = product;
          else products.push(product);

          saveProducts(products);
          return product;
        },

        async deleteProduct(productId) {
          saveProducts(loadProducts().filter(p => p.id !== productId));
        },

        async uploadProductImage() {
          // Demo tidak bisa menyimpan file. Pakai path gambar di folder images/.
          throw new ApiError("DEMO", "Image upload needs the Supabase backend. In demo mode, type an image path such as images/items/magplant.png.");
        },

        async renameCategory(from, to) {
          const target = String(to || "").trim();
          if (!target) fail("INVALID_PRODUCT");
          const products = loadProducts();
          products.forEach(p => { if (p.category === from) p.category = target; });
          saveProducts(products);
        },

        async setMaintenance(on, message, eta) {
          const settings = {
            maintenance: Boolean(on),
            message: String(message || "").trim(),
            eta: String(eta || "").trim(),
            updatedAt: new Date().toISOString()
          };
          storage.set(SETTINGS_KEY, settings);
          return settings;
        },

        async setDownloads(links) {
          validateDownloads(links);
          const settings = loadSettings();
          settings.downloads = {
            windows: String(links.windows || "").trim(),
            android: String(links.android || "").trim(),
            ios: String(links.ios || "").trim(),
            mac: String(links.mac || "").trim()
          };
          storage.set(SETTINGS_KEY, settings);
          return settings;
        },

        async listAnnouncements() {
          return sortAnnouncements(loadAnnouncements());
        },

        async saveAnnouncement(input) {
          validateAnnouncement(input);
          const list = loadAnnouncements();
          const now = new Date().toISOString();
          const item = {
            id: input.id || `ann-${randomCode(8, "0123456789abcdef")}`,
            category: input.category,
            title: input.title.trim(),
            content: input.content.trim(),
            publishedOn: input.publishedOn,
            published: Boolean(input.published),
            createdAt: input.createdAt || now
          };
          const index = list.findIndex(entry => entry.id === item.id);
          if (index >= 0) list[index] = item;
          else list.push(item);
          storage.set(ANNOUNCEMENTS_KEY, list);
          return item;
        },

        async deleteAnnouncement(id) {
          storage.set(ANNOUNCEMENTS_KEY, loadAnnouncements().filter(item => item.id !== id));
        },

        async saveLockPrice(entry) {
          validateLockPrice(entry);
          const list = loadPrices().filter(item => item.recordedOn !== entry.recordedOn);
          list.push({ recordedOn: entry.recordedOn, price: Number(entry.price) });
          storage.set(PRICES_KEY, list);
        },

        async deleteLockPrice(recordedOn) {
          storage.set(PRICES_KEY, loadPrices().filter(item => item.recordedOn !== recordedOn));
        },

        async resetDemo() {
          storage.remove(PRODUCTS_KEY);
          storage.remove(ORDERS_KEY);
          storage.remove(ANNOUNCEMENTS_KEY);
          storage.remove(PRICES_KEY);
          storage.remove(REVIEWS_KEY);
        }
      }
    };
  })();

  // ================================================
  // SUPABASE ADAPTER
  // ================================================

  const supabaseAdapter = (function () {
    let clientPromise = null;

    function loadLibrary() {
      if (window.supabase && window.supabase.createClient) return Promise.resolve();

      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = GT.config.SUPABASE_JS_URL;
        script.crossOrigin = "anonymous";
        script.onload = resolve;
        script.onerror = () => reject(new ApiError("NETWORK", MESSAGES.NETWORK));
        document.head.append(script);
      });
    }

    // Kesalahan konfigurasi yang paling sering terjadi, dicek sebelum
    // menghubungi Supabase agar pesannya jelas.
    function checkConfig() {
      const url = GT.config.SUPABASE_URL.trim();
      const key = GT.config.SUPABASE_ANON_KEY.trim();

      if (!/^https:\/\/[^/]+\/?$/.test(url) || /supabase\.com/.test(url)) {
        return Promise.reject(new ApiError("CONFIG",
          "SUPABASE_URL di js/config.js salah. Gunakan Project URL, contoh: https://abcdxyz.supabase.co (bukan link dashboard)."));
      }
      if (/^sb_secret_/.test(key) || /service_role/.test(decodeJwtRole(key))) {
        return Promise.reject(new ApiError("CONFIG",
          "Key di js/config.js adalah SECRET/service_role key. Ganti dengan anon / publishable key — dan segera rotate secret key itu di Supabase."));
      }
      return Promise.resolve();
    }

    function decodeJwtRole(key) {
      try {
        return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role || "";
      } catch (error) {
        return "";
      }
    }

    function client() {
      if (!clientPromise) {
        clientPromise = checkConfig().then(loadLibrary).then(() =>
          window.supabase.createClient(GT.config.SUPABASE_URL.trim().replace(/\/+$/, ""), GT.config.SUPABASE_ANON_KEY.trim(), {
            auth: { persistSession: true, autoRefreshToken: true }
          })
        );
        // Jangan simpan kegagalan konfigurasi selamanya.
        clientPromise.catch(() => { clientPromise = null; });
      }
      return clientPromise;
    }

    // Exception SQL berformat "GT:<CODE>" → pesan ramah pengguna.
    function mapError(error) {
      if (error instanceof ApiError) return error;
      const text = String((error && (error.message || error.error_description)) || "");
      const match = text.match(/GT:([A-Z_]+)/);

      if (match) {
        const detail = text.slice(text.indexOf(match[0]) + match[0].length).trim();
        return new ApiError(match[1], MESSAGES[match[1]] ? message(match[1], detail) : text);
      }
      if (/invalid api key|no api key|apikey/i.test(text)) {
        return new ApiError("CONFIG", "Supabase menolak API key. Cek SUPABASE_ANON_KEY di js/config.js (pakai anon / publishable key dari project yang sama dengan URL-nya).");
      }
      if (/secret api key/i.test(text)) {
        return new ApiError("CONFIG", "Secret key tidak boleh dipakai di browser. Ganti SUPABASE_ANON_KEY dengan anon / publishable key.");
      }
      if (/does not exist|could not find the (table|function)|schema cache/i.test(text)) {
        return new ApiError("CONFIG", "Database belum disiapkan: jalankan supabase/schema.sql lalu seed.sql di SQL Editor Supabase. (" + text + ")");
      }
      if (/failed to fetch|network|load failed/i.test(text)) {
        return new ApiError("NETWORK", "Tidak bisa menghubungi Supabase. Cek SUPABASE_URL di js/config.js dan pastikan project Supabase aktif (tidak paused).");
      }
      if (/JWT|not authenticated|permission denied/i.test(text)) return new ApiError("NOT_SIGNED_IN", MESSAGES.NOT_SIGNED_IN);
      return new ApiError("UNKNOWN", text || "Something went wrong.");
    }

    async function rpc(name, params) {
      try {
        const sb = await client();
        const { data, error } = await sb.rpc(name, params || {});
        if (error) throw error;
        return data;
      } catch (error) {
        throw mapError(error);
      }
    }

    function mapProduct(row) {
      return {
        id: row.id,
        name: row.name,
        category: row.category,
        description: row.description || "",
        price: row.price,
        stock: row.stock,
        active: row.active,
        image: row.image_url || "",
        fallback: row.fallback || row.name.slice(0, 6).toUpperCase(),
        sortOrder: row.sort_order,
        discountPercent: row.discount_percent || 0,
        discountEndsAt: row.discount_ends_at || null
      };
    }

    // Bentuk order dari RPC sudah camelCase (lihat order_to_json di SQL).
    function mapOrder(json) {
      return json;
    }

    function mapAnnouncement(row) {
      return {
        id: row.id,
        category: row.category,
        title: row.title,
        content: row.content,
        publishedOn: row.published_on,
        published: row.published,
        createdAt: row.created_at
      };
    }

    async function selectAnnouncements(limit, publishedOnly) {
      try {
        const sb = await client();
        let query = sb.from("announcements")
          .select("id,category,title,content,published_on,published,created_at")
          .order("published_on", { ascending: false })
          .order("created_at", { ascending: false });
        if (publishedOnly) query = query.eq("published", true);
        if (limit) query = query.limit(limit);
        const { data, error } = await query;
        if (error) throw error;
        return data.map(mapAnnouncement);
      } catch (error) {
        throw mapError(error);
      }
    }

    async function tableWrite(run) {
      try {
        const sb = await client();
        const { data, error } = await run(sb);
        if (error) throw error;
        return data;
      } catch (error) {
        throw mapError(error);
      }
    }

    function fileExtension(file) {
      return { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type] || "bin";
    }

    return {
      mode: "supabase",

      async getStoreStatus() {
        return rpc("get_store_status");
      },

      async getServerStatus() {
        return getServerStatus(async () => {
          try {
            const stats = await rpc("get_server_stats");
            if (!stats || !stats.configured) return { configured: false };
            return {
              configured: true,
              online: Boolean(stats.online),
              players: stats.online ? stats.players : 0,
              worlds: stats.worlds === null || stats.worlds === undefined ? null : (stats.online ? stats.worlds : 0),
              peak: stats.peak,
              uptime: null,
              updatedAt: stats.reportedAt
            };
          } catch (error) {
            return { configured: true, error: true };
          }
        });
      },

      async listAnnouncements(limit) {
        return selectAnnouncements(limit, true);
      },

      async listLockPrices() {
        try {
          const sb = await client();
          const { data, error } = await sb.from("lock_prices").select("recorded_on,price").order("recorded_on", { ascending: true });
          if (error) throw error;
          return data.map(row => ({ recordedOn: row.recorded_on, price: row.price }));
        } catch (error) {
          throw mapError(error);
        }
      },

      async listProducts() {
        try {
          const sb = await client();
          const { data, error } = await sb
            .from("products")
            .select("id,name,category,description,price,stock,active,image_url,fallback,sort_order,discount_percent,discount_ends_at")
            .eq("active", true)
            .order("sort_order", { ascending: true });
          if (error) throw error;
          return data.map(mapProduct).map(toCustomerProduct);
        } catch (error) {
          throw mapError(error);
        }
      },

      async createOrder({ growId, items }) {
        const check = validateGrowId(growId);
        if (!check.ok) fail("INVALID_GROWID");

        const result = await rpc("create_order", {
          p_grow_id: check.value,
          p_items: items.map(item => ({ product_id: item.productId, quantity: item.quantity }))
        });

        return { orderId: result.orderId, accessCode: result.accessCode, expiresAt: result.expiresAt };
      },

      async getOrder(orderId, accessCode) {
        return mapOrder(await rpc("get_order", { p_order_id: orderId, p_access_code: accessCode }));
      },

      async listReviews(limit) {
        return rpc("list_reviews", { p_limit: limit || 6 });
      },

      async submitReview(orderId, accessCode, rating, comment) {
        validateReview(rating, comment);
        return mapOrder(await rpc("submit_review", {
          p_order_id: orderId,
          p_access_code: accessCode,
          p_rating: Number(rating),
          p_comment: String(comment || "").trim()
        }));
      },

      async submitPayment(orderId, accessCode, file, method) {
        validateProof(file);

        // Policy storage hanya mengizinkan upload ke folder milik
        // order yang masih pending & belum kedaluwarsa.
        const path = `${orderId}/${Date.now()}-${randomCode(6)}.${fileExtension(file)}`;

        try {
          const sb = await client();
          const { error } = await sb.storage
            .from("payment-proofs")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (error) throw error;
        } catch (error) {
          const mapped = mapError(error);
          // Upload ditolak policy → kemungkinan besar sesi sudah habis.
          if (mapped.code === "UNKNOWN" || mapped.code === "NOT_SIGNED_IN") {
            throw new ApiError("ORDER_EXPIRED", "Upload was refused. The payment session may have expired — refresh to check.");
          }
          throw mapped;
        }

        return mapOrder(await rpc("submit_payment", {
          p_order_id: orderId,
          p_access_code: accessCode,
          p_proof_path: path,
          p_method: method || null
        }));
      },

      async cancelOrder(orderId, accessCode) {
        return mapOrder(await rpc("cancel_order", { p_order_id: orderId, p_access_code: accessCode }));
      },

      admin: {
        requiresAuth: true,

        async getSession() {
          const sb = await client();
          const { data } = await sb.auth.getSession();
          if (!data.session) return null;

          const isAdmin = await rpc("is_admin");
          if (!isAdmin) {
            await sb.auth.signOut();
            fail("NOT_ADMIN");
          }
          return { email: data.session.user.email, demo: false };
        },

        async signIn(email, password) {
          try {
            const sb = await client();
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) {
              const text = String(error.message || "");
              if (/invalid login credentials/i.test(text)) throw new ApiError("AUTH", "Email or password is incorrect.");
              if (/email not confirmed/i.test(text)) {
                throw new ApiError("AUTH", "Email belum dikonfirmasi. Di Supabase: Authentication → Users → klik user → Confirm email (atau buat ulang dengan Auto Confirm).");
              }
              throw error;
            }
          } catch (error) {
            throw mapError(error);
          }
          return this.getSession();
        },

        async signOut() {
          const sb = await client();
          await sb.auth.signOut();
        },

        async listOrders() {
          return rpc("admin_list_orders", { p_limit: 500 });
        },

        async getOrder(orderId) {
          const order = await rpc("admin_get_order", { p_order_id: orderId });
          let proofUrl = null;

          if (order.proofPath) {
            const sb = await client();
            const { data } = await sb.storage.from("payment-proofs").createSignedUrl(order.proofPath, 600);
            proofUrl = data ? data.signedUrl : null;
          }

          return { ...order, proofUrl };
        },

        async updateStatus(orderId, nextStatus, note, redeemCode) {
          return rpc("admin_update_order_status", {
            p_order_id: orderId,
            p_status: nextStatus,
            p_note: note || null,
            p_redeem_code: redeemCode || null
          });
        },

        async setMaintenance(on, message, eta) {
          return rpc("admin_set_maintenance", {
            p_on: Boolean(on),
            p_message: message || null,
            p_eta: eta || null
          });
        },

        async getServerStats() {
          return rpc("get_server_stats");
        },

        async rotateStatsToken() {
          return rpc("admin_rotate_stats_token");
        },

        async resetPeak() {
          return rpc("admin_reset_peak");
        },

        async setDownloads(links) {
          validateDownloads(links);
          return rpc("admin_set_downloads", {
            p_windows: links.windows || null,
            p_android: links.android || null,
            p_ios: links.ios || null,
            p_mac: links.mac || null
          });
        },

        async listAnnouncements() {
          return selectAnnouncements(null, false);
        },

        async saveAnnouncement(input) {
          validateAnnouncement(input);
          const row = {
            category: input.category,
            title: input.title.trim(),
            content: input.content.trim(),
            published_on: input.publishedOn,
            published: Boolean(input.published)
          };
          if (input.id) row.id = input.id;
          const data = await tableWrite(sb => sb.from("announcements").upsert(row).select().single());
          return mapAnnouncement(data);
        },

        async deleteAnnouncement(id) {
          await tableWrite(sb => sb.from("announcements").delete().eq("id", id));
        },

        async saveLockPrice(entry) {
          validateLockPrice(entry);
          await tableWrite(sb => sb.from("lock_prices").upsert({ recorded_on: entry.recordedOn, price: Number(entry.price) }));
        },

        async deleteLockPrice(recordedOn) {
          await tableWrite(sb => sb.from("lock_prices").delete().eq("recorded_on", recordedOn));
        },

        async checkRedeemCodes(orderId, codes) {
          return rpc("admin_check_redeem_codes", { p_order_id: orderId || null, p_codes: codes || "" });
        },

        async listReviews() {
          return rpc("admin_list_reviews");
        },

        async setReviewStatus(id, status) {
          return rpc("admin_set_review_status", { p_id: id, p_status: status });
        },

        async deleteReview(id) {
          return rpc("admin_delete_review", { p_id: id });
        },

        async setRedeemCode(orderId, redeemCode) {
          return rpc("admin_set_redeem_code", {
            p_order_id: orderId,
            p_redeem_code: redeemCode || null
          });
        },

        async listProducts() {
          try {
            const sb = await client();
            const { data, error } = await sb
              .from("products")
              .select("id,name,category,description,price,stock,active,image_url,fallback,sort_order,discount_percent,discount_ends_at")
              .order("sort_order", { ascending: true });
            if (error) throw error;
            return data.map(mapProduct);
          } catch (error) {
            throw mapError(error);
          }
        },

        async saveProduct(input) {
          validateProduct(input);
          const row = {
            name: input.name.trim(),
            category: input.category.trim(),
            description: (input.description || "").trim(),
            price: Number(input.price),
            stock: Number(input.stock),
            active: Boolean(input.active),
            image_url: (input.image || "").trim() || null,
            fallback: (input.fallback || input.name).trim().slice(0, 10).toUpperCase(),
            sort_order: Number(input.sortOrder) || 0,
            discount_percent: Number(input.discountPercent || 0),
            discount_ends_at: input.discountEndsAt || null
          };
          if (input.id) row.id = input.id;

          try {
            const sb = await client();
            const { data, error } = await sb.from("products").upsert(row).select().single();
            if (error) throw error;
            return mapProduct(data);
          } catch (error) {
            throw mapError(error);
          }
        },

        async deleteProduct(productId) {
          try {
            const sb = await client();
            const { error } = await sb.from("products").delete().eq("id", productId);
            if (error) throw error;
          } catch (error) {
            throw mapError(error);
          }
        },

        async uploadProductImage(file) {
          if (!file || !PROOF_TYPES.includes(file.type)) fail("PROOF_INVALID");
          const path = `${Date.now()}-${randomCode(6)}.${fileExtension(file)}`;

          try {
            const sb = await client();
            const { error } = await sb.storage.from("product-images").upload(path, file, { contentType: file.type });
            if (error) throw error;
            return sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
          } catch (error) {
            throw mapError(error);
          }
        },

        async renameCategory(from, to) {
          const target = String(to || "").trim();
          if (!target) fail("INVALID_PRODUCT");

          try {
            const sb = await client();
            const { error } = await sb.from("products").update({ category: target }).eq("category", from);
            if (error) throw error;
          } catch (error) {
            throw mapError(error);
          }
        }
      }
    };
  })();

  const adapter = GT.isBackendConfigured() ? supabaseAdapter : demo;

  return {
    ...adapter,
    ApiError,
    myOrders,
    ADMIN_TRANSITIONS,
    todayISO,
    effectivePrice,
    discountActive,
    isDemo: adapter.mode === "demo"
  };
})();
