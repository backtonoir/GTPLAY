// GTPLAY v3.9 (GoPay & BCA)
// ==================================================
// GTPLAY UTILITIES
// --------------------------------------------------
// Helper umum yang dipakai semua halaman: format Rupiah,
// pembuatan elemen DOM yang aman (tanpa innerHTML untuk
// data pengguna), notifikasi, penyimpanan lokal, status
// pesanan, dan validasi.
// ==================================================

window.GT = window.GT || {};

// Fallback bila js/i18n.js tidak dimuat (mis. admin.html):
// hanya mengisi {variabel}, tanpa terjemahan.
if (!GT.t) {
  GT.t = function (text, vars) {
    const value = String(text);
    return vars ? value.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : value;
  };
}

GT.utils = (function () {
  // ------------------------------------------------
  // FORMATTING
  // ------------------------------------------------

  const rupiahFormatter = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  });

  function formatRupiah(amount) {
    return rupiahFormatter.format(Number(amount) || 0);
  }

  // Locale tanggal mengikuti bahasa yang dipilih (js/i18n.js).
  function locale() {
    return (GT.i18n && GT.i18n.locale) || "id-ID";
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString(locale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  // ------------------------------------------------
  // SAFE DOM BUILDER
  // --------------------------------------------------
  // h("button", { class: "x", onclick: fn }, "Label")
  // Teks selalu dimasukkan lewat textContent, jadi data
  // dari pengguna / database tidak bisa menyisipkan HTML.
  // ------------------------------------------------

  // Teks UI diterjemahkan otomatis lewat kamus di js/i18n.js
  // (hanya bila teksnya persis ada di kamus).
  const TRANSLATED_ATTRS = ["aria-label", "placeholder", "title", "alt"];
  const tr = value => GT.t(value);

  function h(tag, props, ...children) {
    const element = document.createElement(tag);

    Object.entries(props || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;

      if (key === "class") {
        element.className = value;
      } else if (key === "dataset") {
        Object.assign(element.dataset, value);
      } else if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.slice(2), value);
      } else if (key === "text") {
        element.textContent = tr(value);
      } else if (TRANSLATED_ATTRS.includes(key) && typeof value === "string") {
        element.setAttribute(key, tr(value));
      } else if (value === true) {
        element.setAttribute(key, "");
      } else {
        element.setAttribute(key, String(value));
      }
    });

    children.flat(Infinity).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      element.append(child instanceof Node ? child : document.createTextNode(typeof child === "string" ? tr(child) : String(child)));
    });

    return element;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  // Gambar dengan lazy loading + fallback teks bila gambar gagal dimuat.
  function imageWithFallback({ src, alt, fallback, className, eager }) {
    const wrapper = h("div", { class: className || "media" });
    const fallbackEl = h("span", { class: "media-fallback", "aria-hidden": "true" }, fallback || alt || "?");

    if (!src) {
      wrapper.classList.add("is-fallback");
      wrapper.append(fallbackEl);
      return wrapper;
    }

    const img = h("img", {
      src,
      alt: alt || "",
      loading: eager ? "eager" : "lazy",
      decoding: "async",
      width: "320",
      height: "320"
    });

    img.addEventListener("error", () => {
      wrapper.classList.add("is-fallback");
      img.remove();
    }, { once: true });

    wrapper.append(img, fallbackEl);
    return wrapper;
  }

  // ------------------------------------------------
  // STORAGE (aman bila localStorage diblokir)
  // ------------------------------------------------

  const storage = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        /* ignore */
      }
    }
  };

  // ------------------------------------------------
  // TOAST NOTIFICATIONS
  // ------------------------------------------------

  function toast(message, type) {
    let region = document.getElementById("toastRegion");

    if (!region) {
      region = h("div", {
        id: "toastRegion",
        class: "toast-region",
        role: "status",
        "aria-live": "polite"
      });
      document.body.append(region);
    }

    const item = h("div", { class: `toast toast-${type || "info"}` }, message);
    region.append(item);

    requestAnimationFrame(() => item.classList.add("show"));

    setTimeout(() => {
      item.classList.remove("show");
      setTimeout(() => item.remove(), 300);
    }, type === "error" ? 5200 : 3200);
  }

  // ------------------------------------------------
  // ORDER STATUS
  // ------------------------------------------------

  const STATUS = {
    pending_payment: { label: "Pending Payment", tone: "warn" },
    payment_submitted: { label: "Payment Submitted", tone: "info" },
    payment_verified: { label: "Payment Verified", tone: "info" },
    processing: { label: "Processing", tone: "info" },
    completed: { label: "Completed", tone: "ok" },
    expired: { label: "Expired", tone: "muted" },
    cancelled: { label: "Cancelled", tone: "muted" },
    rejected: { label: "Rejected", tone: "danger" }
  };

  // Urutan "jalur sukses" untuk timeline.
  const STATUS_FLOW = [
    "pending_payment",
    "payment_submitted",
    "payment_verified",
    "processing",
    "completed"
  ];

  const TERMINAL_FAIL = ["expired", "cancelled", "rejected"];

  function statusBadge(status) {
    const meta = STATUS[status] || { label: status, tone: "muted" };
    return h("span", { class: `status-badge tone-${meta.tone}` }, meta.label);
  }

  // ------------------------------------------------
  // VALIDATION
  // ------------------------------------------------

  // Sesuaikan jika aturan GrowID di server GTPLAY berbeda.
  // Pola yang sama juga ada di supabase/schema.sql.
  const GROWID_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

  function validateGrowId(value) {
    const growId = String(value || "").trim();

    if (!growId) return { ok: false, message: GT.t("GrowID is required.") };

    if (!GROWID_PATTERN.test(growId)) {
      return {
        ok: false,
        message: GT.t("GrowID must be 3–24 characters: letters, numbers, or underscore.")
      };
    }

    return { ok: true, value: growId };
  }

  // Kode acak berbasis crypto (bukan Math.random).
  function randomCode(length, alphabet) {
    const chars = alphabet || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(length);
    window.crypto.getRandomValues(bytes);

    return Array.from(bytes, value => chars[value % chars.length]).join("");
  }

  // ------------------------------------------------
  // EXTERNAL LINKS
  // --------------------------------------------------
  // BUG FIX: window.open(url, "_blank", "noopener") selalu
  // mengembalikan null, sehingga kode lama SELALU menjalankan
  // fallback location.href → WhatsApp terbuka dua kali dan
  // halaman toko ikut berpindah. Klik anchor sintetis aman
  // dari tabnabbing dan tidak memicu fallback ganda.
  // ------------------------------------------------

  function openExternal(url) {
    const link = h("a", { href: url, target: "_blank", rel: "noopener noreferrer" });
    document.body.append(link);
    link.click();
    link.remove();
  }

  // ------------------------------------------------
  // METODE PEMBAYARAN (dibaca dari GT.config.PAYMENT_METHODS)
  // ------------------------------------------------

  // Data dari Admin → Server (GT.site) diutamakan, lalu js/config.js.
  function paymentMethods() {
    const cfg = (GT.config && GT.config.PAYMENT_METHODS) || {};
    const pay = (GT.site && GT.site.payment()) || {};
    const pick = (...values) => values.map(v => String(v || "").trim()).find(Boolean) || "";
    const out = [];
    const qris = cfg.qris || {};
    const qrisImage = pick(pay.qrisImage, GT.config.QRIS_IMAGE);
    if (qrisImage) {
      out.push({ id: "qris", kind: "qris", label: qris.label || "QRIS", image: qrisImage, note: qris.note || "" });
    }
    const gopay = cfg.gopay || {};
    const gopayNumber = pick(pay.gopayNumber, gopay.number);
    if (gopayNumber) {
      out.push({ id: "gopay", kind: "ewallet", label: gopay.label || "GoPay", number: gopayNumber, name: pick(pay.gopayName, gopay.name), note: gopay.note || "" });
    }
    const bca = cfg.bca || {};
    const bankNumber = pick(pay.bankNumber, bca.number);
    if (bankNumber) {
      const bankName = pick(pay.bankName, bca.bank, "BCA");
      out.push({
        id: "bca",
        kind: "bank",
        label: pick(pay.bankLabel, pay.bankName ? `Bank ${pay.bankName}` : "", bca.label, "Bank BCA"),
        bank: bankName,
        number: bankNumber,
        name: pick(pay.bankHolder, bca.name),
        note: pay.bankName ? `Transfer ke rekening ${bankName} di atas sesuai nominal, lalu upload bukti transfer.` : (bca.note || "")
      });
    }
    return out;
  }

  // Baris Subtotal → Kupon → Total (pesanan dengan kupon).
  function orderTotalRows(order, totalLabel) {
    const rows = [];
    if (order && Number(order.discount) > 0) {
      rows.push(h("div", { class: "summary-row" }, h("span", {}, "Subtotal"), h("span", { class: "value" }, formatRupiah(order.subtotal))));
      rows.push(h("div", { class: "summary-row coupon-row" },
        h("span", {}, GT.t("Coupon"), " ", h("code", { class: "coupon-code" }, order.couponCode || "")),
        h("span", { class: "value" }, `−${formatRupiah(order.discount)}`)));
    }
    rows.push(h("div", { class: "summary-row summary-total" }, h("span", {}, totalLabel || "Total Payment"), h("strong", {}, formatRupiah(order.total))));
    return rows;
  }

  // Nama server/toko (Admin → Server → Nama server).
  function storeName() {
    return (GT.site && GT.site.name()) || GT.config.STORE_NAME;
  }

  function paymentMethodLabel(id) {
    const found = paymentMethods().find(m => m.id === id);
    if (found) return found.label;
    const labels = { qris: "QRIS", gopay: "GoPay", bca: "Bank BCA" };
    return labels[id] || id || "";
  }

  function whatsappURL(message) {
    const number = (GT.site && GT.site.whatsapp()) || GT.config.WHATSAPP_NUMBER;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  // ------------------------------------------------
  // DIALOG HELPERS (Escape untuk menutup, kunci scroll)
  // ------------------------------------------------

  let scrollLocks = 0;

  function lockScroll() {
    scrollLocks += 1;
    document.documentElement.classList.add("scroll-locked");
  }

  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.documentElement.classList.remove("scroll-locked");
  }

  function confirmDialog({ title, message, confirmLabel, danger }) {
    return new Promise(resolve => {
      const previous = document.activeElement;

      function close(result) {
        overlay.classList.remove("show");
        document.removeEventListener("keydown", onKey);
        unlockScroll();
        setTimeout(() => overlay.remove(), 200);
        if (previous && previous.focus) previous.focus();
        resolve(result);
      }

      function onKey(event) {
        if (event.key === "Escape") close(false);
      }

      const confirmBtn = h("button", {
        class: danger ? "btn btn-danger" : "btn btn-primary",
        type: "button",
        onclick: () => close(true)
      }, confirmLabel || "Confirm");

      const overlay = h("div", { class: "modal-overlay", onclick: e => { if (e.target === overlay) close(false); } },
        h("div", { class: "modal modal-sm", role: "dialog", "aria-modal": "true", "aria-labelledby": "confirmTitle" },
          h("h3", { id: "confirmTitle", class: "modal-title" }, title),
          h("p", { class: "modal-text" }, message),
          h("div", { class: "modal-actions" },
            h("button", { class: "btn btn-ghost", type: "button", onclick: () => close(false) }, "Back"),
            confirmBtn
          )
        )
      );

      document.body.append(overlay);
      lockScroll();
      document.addEventListener("keydown", onKey);
      confirmBtn.focus();
      requestAnimationFrame(() => overlay.classList.add("show"));
    });
  }

  // ------------------------------------------------
  // DESKRIPSI PRODUK (format sederhana, tanpa HTML)
  // ------------------------------------------------
  // Admin cukup menulis teks biasa. Aturan tampilan:
  //   • baris HURUF BESAR            → judul kecil
  //   • baris ━━━ / ─── / ---        → garis pemisah
  //   • baris diawali ・ • - * ✓     → daftar
  //   • "Judul — penjelasan"         → daftar, judul ditebalkan
  //   • baris kosong                 → jarak antar paragraf
  // Semua dibuat lewat h() (textContent), jadi aman dari HTML.

  const DESC_RULE = /^[━─═_~=\-–—·•.\s]{3,}$/;
  const DESC_BULLET = /^[・•\-*·▪►➤✓✔]\s*(.+)$/;
  const DESC_DECOR = /^[✦★☆◆◇❖✧•·\s]+/;

  function descLines(text) {
    return String(text || "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim());
  }

  function isDescHeading(line) {
    const letters = line.replace(/[^A-Za-z]/g, "");
    return letters.length >= 3 && line.length <= 60 && line === line.toUpperCase() && !DESC_BULLET.test(line);
  }

  function featureParts(line) {
    const match = line.match(/^(.{2,48}?)\s[—–]\s(.+)$/);
    return match ? [match[1], match[2]] : null;
  }

  function formatDescription(text) {
    const root = h("div", { class: "desc-rich" });
    let list = null;

    const closeList = () => { list = null; };
    const listItem = (...children) => {
      if (!list) { list = h("ul", { class: "desc-list" }); root.append(list); }
      list.append(h("li", {}, ...children));
    };

    descLines(text).forEach(line => {
      if (!line) { closeList(); return; }
      if (DESC_RULE.test(line)) { closeList(); root.append(h("hr", { class: "desc-rule" })); return; }

      const bullet = line.match(DESC_BULLET);
      if (bullet) {
        const parts = featureParts(bullet[1]);
        listItem(...(parts ? [h("strong", {}, parts[0]), ` — ${parts[1]}`] : [bullet[1]]));
        return;
      }
      if (isDescHeading(line)) {
        closeList();
        root.append(h("h4", { class: "desc-heading" }, line.replace(DESC_DECOR, "")));
        return;
      }
      const parts = featureParts(line);
      if (parts) { listItem(h("strong", {}, parts[0]), ` — ${parts[1]}`); return; }

      closeList();
      root.append(h("p", {}, line));
    });

    return root;
  }

  // ------------------------------------------------
  // PENGUMUMAN BERWARNA (gaya blok "diff" Discord)
  // ------------------------------------------------
  //   + teks  → hijau  (fitur baru / ditambahkan)
  //   - teks  → merah  (dihapus / diperbaiki)
  //   ! teks  → kuning (penting / peringatan)
  // Baris lain mengikuti aturan formatDescription.
  // Pembuka/penutup ```diff dari Discord diabaikan.

  const ANN_DIFF = /^([+\-!])\s?(.*)$/;
  const ANN_TONES = { "+": "add", "-": "remove", "!": "warn" };

  function formatAnnouncement(text) {
    const lines = descLines(text).filter(line => !/^```/.test(line));
    const root = h("div", { class: "desc-rich ann-rich" });
    let plain = [];
    let diff = null;

    const flushPlain = () => {
      if (!plain.length) return;
      const block = formatDescription(plain.join("\n"));
      root.append(...block.childNodes);
      plain = [];
    };

    lines.forEach(line => {
      const match = line.match(ANN_DIFF);
      // "- " di awal = merah; "-" tanpa spasi atau "---" tetap teks/garis biasa.
      const isDiff = match && !DESC_RULE.test(line) && (match[1] !== "-" || /^-\s/.test(line));
      if (isDiff) {
        flushPlain();
        if (!diff) { diff = h("ul", { class: "ann-diff" }); root.append(diff); }
        if (match[2].trim()) {
          diff.append(h("li", { class: `ann-${ANN_TONES[match[1]]}` },
            h("span", { class: "ann-mark", "aria-hidden": "true" }, match[1]),
            h("span", {}, match[2].trim())
          ));
        }
        return;
      }
      diff = null;
      plain.push(line);
    });
    flushPlain();
    return root;
  }

  // Ringkasan 1–2 kalimat untuk kartu produk.
  function descriptionPreview(text) {
    const lines = descLines(text).filter(line => line && !DESC_RULE.test(line));
    const sentence = lines.find(line => !isDescHeading(line) && !DESC_BULLET.test(line) && !featureParts(line));
    return (sentence || lines[0] || "").replace(DESC_BULLET, "$1").replace(DESC_DECOR, "");
  }

  // Ada isi lain selain ringkasan → tampilkan tombol Detail.
  function descriptionHasMore(text) {
    const lines = descLines(text).filter(line => line && !DESC_RULE.test(line));
    return lines.length > 1 || (lines[0] || "").length > 110;
  }

  // ------------------------------------------------
  // KOMPRES GAMBAR (bukti bayar) sebelum upload
  // --------------------------------------------------
  // Sisi terpanjang maks 1600 px, disimpan sebagai WEBP
  // (atau JPEG bila browser tidak mendukung). Screenshot
  // 1 MB biasanya jadi ±100–200 KB dan tetap jelas dibaca.
  // Bila gagal atau hasilnya lebih besar, file asli dipakai.
  // ------------------------------------------------

  async function compressImage(file, options) {
    const { maxSide = 1600, quality = 0.82, skipBelow = 350 * 1024 } = options || {};
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return file;

    let bitmap = null;
    let source = null;
    try {
      if ("createImageBitmap" in window) {
        bitmap = await createImageBitmap(file);
        source = bitmap;
      } else {
        source = await new Promise((resolve, reject) => {
          const img = new Image();
          const url = URL.createObjectURL(file);
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
          img.src = url;
        });
      }
      const width = source.width;
      const height = source.height;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      if (scale === 1 && file.size <= skipBelow) return file;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

      const toBlob = type => new Promise(resolve => canvas.toBlob(resolve, type, quality));
      let blob = await toBlob("image/webp");
      if (!blob || blob.type !== "image/webp") blob = await toBlob("image/jpeg");
      if (!blob || blob.size >= file.size) return file;

      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const name = String(file.name || "proof").replace(/\.[^.]+$/, "") + "." + ext;
      return new File([blob], name, { type: blob.type, lastModified: Date.now() });
    } catch (error) {
      return file;
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  }

  // Salin teks ke clipboard (dengan fallback untuk browser lama).
  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = h("textarea", { readonly: true, class: "sr-only" });
      area.value = value;
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      area.remove();
      return ok;
    }
  }

  function copyButton(value, label, className) {
    return h("button", {
      type: "button",
      class: className || "copy-button",
      "aria-label": `${tr("Copy")} ${tr(label)}`,
      onclick: async event => {
        const button = event.currentTarget;
        const ok = await copyText(value);
        if (ok) {
          toast(GT.t("{label} copied.", { label: tr(label) }), "success");
          const original = button.textContent;
          button.textContent = tr("Copied ✓");
          setTimeout(() => { button.textContent = original; }, 1500);
        } else {
          toast(GT.t("Couldn't copy — select the {label} manually.", { label: tr(label).toLowerCase() }), "error");
        }
      }
    }, "Copy");
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // Kode akses ditaruh di hash (#k=...) agar tidak ikut terkirim
  // ke server / log hosting.
  function getHashParam(name) {
    return new URLSearchParams(window.location.hash.slice(1)).get(name);
  }

  return {
    formatRupiah,
    formatDateTime,
    locale,
    formatCountdown,
    escapeHTML,
    h,
    $,
    $all,
    imageWithFallback,
    storage,
    toast,
    STATUS,
    STATUS_FLOW,
    TERMINAL_FAIL,
    statusBadge,
    validateGrowId,
    randomCode,
    openExternal,
    whatsappURL,
    storeName,
    orderTotalRows,
    compressImage,
    paymentMethods,
    paymentMethodLabel,
    lockScroll,
    unlockScroll,
    confirmDialog,
    formatDescription,
    formatAnnouncement,
    descriptionPreview,
    descriptionHasMore,
    copyText,
    copyButton,
    debounce,
    getParam,
    getHashParam
  };
})();
