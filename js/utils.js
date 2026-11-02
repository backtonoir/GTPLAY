// GTPLAY v3.7 (discount, reviews, ID/EN)
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

  function whatsappURL(message) {
    return `https://wa.me/${GT.config.WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
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
    lockScroll,
    unlockScroll,
    confirmDialog,
    copyText,
    copyButton,
    debounce,
    getParam,
    getHashParam
  };
})();
