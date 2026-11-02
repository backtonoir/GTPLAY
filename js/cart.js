// GTPLAY v3.7 (discount, reviews, ID/EN)
// GTPLAY CART STATE
// --------------------------------------------------
// Keranjang disimpan di localStorage HANYA sebagai daftar
// { id, qty }. Nama, harga, dan stok selalu dibaca ulang
// dari katalog terbaru — harga di browser tidak pernah
// dipercaya. Saat checkout, server menghitung ulang total.
// ==================================================

window.GT = window.GT || {};

GT.cart = (function () {
  const { storage } = GT.utils;
  const KEY = "gtplay:cart:v1";

  let entries = sanitize(storage.get(KEY, []));
  let catalog = null; // Map id -> product
  const listeners = new Set();

  function sanitize(list) {
    if (!Array.isArray(list)) return [];

    return list
      .filter(item => item && typeof item.id === "string")
      .map(item => ({ id: item.id, qty: Math.max(1, Math.floor(Number(item.qty) || 1)) }));
  }

  function save() {
    storage.set(KEY, entries);
  }

  function emit() {
    listeners.forEach(fn => fn());
  }

  // Sesuaikan isi keranjang dengan katalog: buang produk yang
  // sudah tidak aktif / habis, dan batasi qty ke stok.
  // Mengembalikan daftar pesan perubahan untuk ditampilkan.
  function reconcile() {
    if (!catalog) return [];
    const notices = [];

    entries = entries.filter(item => {
      const product = catalog.get(item.id);

      if (!product) {
        notices.push("An item in your cart is no longer available and was removed.");
        return false;
      }

      if (product.stock <= 0) {
        notices.push(GT.t("{name} is out of stock and was removed from your cart.", { name: product.name }));
        return false;
      }

      if (item.qty > product.stock) {
        item.qty = product.stock;
        notices.push(GT.t("{name} quantity was reduced to the available stock ({n}).", { name: product.name, n: product.stock }));
      }

      return true;
    });

    save();
    return notices;
  }

  function setCatalog(products) {
    catalog = new Map(products.map(product => [product.id, product]));
    const notices = reconcile();
    emit();
    return notices;
  }

  function getProduct(id) {
    return catalog ? catalog.get(id) : null;
  }

  function add(id, amount) {
    const product = getProduct(id);
    if (!product) return { ok: false, message: "This item is not available." };
    if (product.stock <= 0) return { ok: false, message: GT.t("{name} is out of stock.", { name: product.name }) };

    const step = amount || 1;
    const existing = entries.find(item => item.id === id);
    const current = existing ? existing.qty : 0;

    if (current + step > product.stock) {
      return { ok: false, message: GT.t("Only {n} {name} available.", { n: product.stock, name: product.name }) };
    }

    if (existing) existing.qty += step;
    else entries.push({ id, qty: step });

    save();
    emit();
    return { ok: true, message: GT.t("{name} added to cart.", { name: product.name }) };
  }

  function setQty(id, qty) {
    const item = entries.find(entry => entry.id === id);
    const product = getProduct(id);
    if (!item || !product) return { ok: false };

    const next = Math.floor(Number(qty));
    if (!Number.isFinite(next) || next < 1) return { ok: false, message: "Minimum quantity is 1." };
    if (next > product.stock) return { ok: false, message: GT.t("Only {n} available.", { n: product.stock }) };

    item.qty = next;
    save();
    emit();
    return { ok: true };
  }

  function remove(id) {
    entries = entries.filter(item => item.id !== id);
    save();
    emit();
  }

  function clear() {
    entries = [];
    save();
    emit();
  }

  // Ganti isi keranjang (dipakai fitur "order again").
  function replace(items) {
    entries = sanitize(items);
    reconcile();
    save();
    emit();
  }

  function lines() {
    if (!catalog) return [];

    return entries
      .map(item => {
        const product = catalog.get(item.id);
        if (!product) return null;
        return { product, quantity: item.qty, subtotal: product.price * item.qty };
      })
      .filter(Boolean);
  }

  function count() {
    return entries.reduce((sum, item) => sum + item.qty, 0);
  }

  function total() {
    return lines().reduce((sum, line) => sum + line.subtotal, 0);
  }

  // Total potongan diskon (harga normal − harga promo).
  function savings() {
    return lines().reduce((sum, line) => sum + (line.product.originalPrice ? (line.product.originalPrice - line.product.price) * line.quantity : 0), 0);
  }

  function isEmpty() {
    return entries.length === 0;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Sinkron antar tab.
  window.addEventListener("storage", event => {
    if (event.key !== KEY) return;
    entries = sanitize(storage.get(KEY, []));
    reconcile();
    emit();
  });

  return {
    setCatalog,
    getProduct,
    add,
    setQty,
    remove,
    clear,
    replace,
    lines,
    count,
    total,
    savings,
    isEmpty,
    onChange,
    hasCatalog: () => Boolean(catalog)
  };
})();
