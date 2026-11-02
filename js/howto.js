// ==================================================
// HOW TO PAGE (howto.html)
// --------------------------------------------------
// Mengisi IP server & link di "Cara Login per Platform"
// dari GT.config.LOGIN_GUIDE (js/config.js).
// ==================================================

(function () {
  const { $all } = GT.utils;
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

  applyText();
  applyLinks({});

  // GTPLAY APK / Installer kosong di config → pakai link dari Admin → Downloads.
  GT.api.getStoreStatus()
    .then(status => {
      const downloads = (status && status.downloads) || {};
      applyLinks({ gtplayApk: downloads.android, gtplayInstaller: downloads.windows });
    })
    .catch(() => {});

  GT.layout.init({ page: "howto" }).catch(() => {});
})();
