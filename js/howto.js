// ==================================================
// HOW TO PAGE (howto.html)
// --------------------------------------------------
// Mengisi IP server & link di "Cara Login per Platform".
//
// Urutan sumber data (yang pertama terisi dipakai):
//   1. Admin → Downloads → How To Login (database)
//   2. GT.config.LOGIN_GUIDE (js/config.js)
//   3. Untuk GTPLAY APK: link Android di Admin → Downloads
// ==================================================

(function () {
  const { $all, toast, h } = GT.utils;
  const fromConfig = GT.config.LOGIN_GUIDE || {};
  const DEFAULT_DOMAINS = ["www.growtopia1.com", "www.growtopia2.com"];

  let guide = { ...fromConfig };
  let fallbacks = {};

  const isSafeUrl = url => /^https:\/\/\S+$/i.test(String(url || "").trim());

  // Field kosong dari admin tidak menimpa nilai config.
  function merge(base, override) {
    const out = { ...base };
    Object.entries(override || {}).forEach(([key, value]) => {
      if (Array.isArray(value) ? value.length : String(value || "").trim()) out[key] = value;
    });
    return out;
  }

  function hostsLines() {
    const ip = String(guide.serverIp || "").trim();
    const domains = Array.isArray(guide.hostsDomains) && guide.hostsDomains.length ? guide.hostsDomains : DEFAULT_DOMAINS;
    return ip ? domains.map(domain => `${ip} ${String(domain).trim()}`) : [];
  }

  function linkFor(key) {
    const url = String(guide[key] || fallbacks[key] || "").trim();
    return isSafeUrl(url) ? url : "";
  }

  function render() {
    const lines = hostsLines();
    if (lines.length) {
      $all("[data-hosts-lines]").forEach(node => {
        node.replaceChildren(...lines.flatMap((line, i) => (i ? [h("br"), h("code", {}, line)] : [h("code", {}, line)])));
      });
    }

    $all("[data-login-text]").forEach(node => {
      const value = guide[node.dataset.loginText];
      if (value) node.textContent = value;
    });

    $all("[data-login-link]").forEach(link => {
      const url = linkFor(link.dataset.loginLink);
      if (url) {
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

    $all("[data-copy-login]").forEach(button => {
      const available = Boolean(linkFor(button.dataset.copyLogin));
      button.disabled = !available;
      button.title = available ? "" : "Link belum tersedia";
    });
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

  $all("[data-copy-hosts]").forEach(button => {
    button.addEventListener("click", () => copy(button, hostsLines().join("\n"), "Hosts"));
  });
  $all("[data-copy-login]").forEach(button => {
    button.addEventListener("click", () => copy(button, linkFor(button.dataset.copyLogin), button.dataset.copyLabel || "Link"));
  });

  render();

  GT.api.getStoreStatus()
    .then(status => {
      if (!status) return;
      guide = merge(fromConfig, status.loginGuide);
      fallbacks = { gtplayApk: status.downloads && status.downloads.android };
      render();
    })
    .catch(() => {});

  GT.layout.init({ page: "howto" }).catch(() => {});
})();
