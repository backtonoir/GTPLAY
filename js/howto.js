// ==================================================
// HOW TO PAGE (howto.html)
// --------------------------------------------------
// Mengisi IP server & link di "Cara Login per Platform"
// dari GT.config.LOGIN_GUIDE (js/config.js).
// ==================================================

(function () {
  const { $all, toast } = GT.utils;
  const guide = GT.config.LOGIN_GUIDE || {};

  const isSafeUrl = url => /^https:\/\//i.test(String(url || "").trim());

  function applyText() {
    if (guide.serverIp) {
      $all("[data-login-ip]").forEach(node => { node.textContent = guide.serverIp; });
    }
    $all("[data-login-text]").forEach(node => {
      const value = guide[node.dataset.loginText];
      if (value) node.textContent = value;
    });
  }

  function applyLinks(fallbacks) {
    $all("[data-login-link]").forEach(link => {
      const key = link.dataset.loginLink;
      const url = String(guide[key] || fallbacks[key] || "").trim();
      if (isSafeUrl(url)) {
        link.href = url;
        link.removeAttribute("aria-disabled");
        link.removeAttribute("title");
        link.classList.remove("is-disabled");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        link.title = "Link belum tersedia";
        link.classList.add("is-disabled");
      }
    });
  }

  function hostsText() {
    const ip = guide.serverIp || "";
    return [`${ip} www.growtopia1.com`, `${ip} www.growtopia2.com`].join("\n");
  }

  async function copy(button, value, label) {
    if (!value) {
      toast(`${label} belum tersedia.`, "error");
      return;
    }
    const ok = await GT.utils.copyText(value);
    if (!ok) {
      toast(`Gagal menyalin ${label}. Salin manual.`, "error");
      return;
    }
    toast(`${label} disalin.`, "success");
    const original = button.textContent;
    button.textContent = "Copied ✓";
    setTimeout(() => { button.textContent = original; }, 1500);
  }

  function bindCopyButtons() {
    $all("[data-copy-hosts]").forEach(button => {
      button.addEventListener("click", () => copy(button, guide.serverIp ? hostsText() : "", "Hosts"));
    });
    $all("[data-copy-login]").forEach(button => {
      const url = String(guide[button.dataset.copyLogin] || "").trim();
      if (!isSafeUrl(url)) {
        button.disabled = true;
        button.title = "Link belum tersedia";
      }
      button.addEventListener("click", () => copy(button, isSafeUrl(url) ? url : "", button.dataset.copyLabel || "Link"));
    });
  }

  applyText();
  applyLinks({});
  bindCopyButtons();

  // GTPLAY APK kosong di config → pakai link Android dari Admin → Downloads.
  GT.api.getStoreStatus()
    .then(status => {
      const downloads = (status && status.downloads) || {};
      applyLinks({ gtplayApk: downloads.android });
    })
    .catch(() => {});

  GT.layout.init({ page: "howto" }).catch(() => {});
})();
