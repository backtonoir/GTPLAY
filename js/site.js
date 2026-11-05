// ================================================== 	   			
// PENGATURAN WEBSITE (Admin → Server → Pengaturan Website) 	 	 	  
// --------------------------------------------------  		   	
// Menerapkan pengaturan dari database ke setiap halaman: 					  
// nama server, warna tema, logo/favicon/hero, WhatsApp, 		   	 
// link sosial media, dan data pembayaran (QRIS, GoPay, bank). 		    	
// 		   		
// Nilai kosong → memakai js/config.js. Pengaturan terakhir 		 	 		
// disimpan di browser supaya kunjungan berikutnya langsung 			 	  
// tampil benar tanpa menunggu server. 		 				
// ================================================== 		 			 

window.GT = window.GT || {};

GT.site = (function () {
  const CACHE_KEY = "gtplay:site";
  const DEFAULT_THEME = "#e5172f";
  const BASE_NAME = (GT.config && GT.config.STORE_NAME) || "GTPLAY";
  const IS_ADMIN = /^\/admin(\/|$|\.html)/.test(window.location.pathname);
  const SOCIAL_LABELS = { instagram: "Instagram", tiktok: "TikTok", discord: "Discord", youtube: "YouTube", facebook: "Facebook" };

  let site = readCache();
  let readyPromise = null;

  function readCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeCache(value) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(value || {}));
    } catch (error) {
      /* storage penuh/diblokir — tidak masalah */ 		 				
    }
  }

  const isUrl = value => /^(https:\/\/|data:image\/)/.test(String(value || ""));

  // ------------------------------------------------ 		 	  	
  // NILAI EFEKTIF (database → config.js) 			  	 
  // ------------------------------------------------ 					  

  function name() {
    return String(site.serverName || BASE_NAME).trim() || BASE_NAME;
  }

  function whatsapp() {
    return String(site.whatsapp || (GT.config && GT.config.WHATSAPP_NUMBER) || "").replace(/\D/g, "");
  }

  function socialLinks() {
    const fromConfig = (GT.config && GT.config.SOCIAL_LINKS) || {};
    const fromSite = site.social || {};
    const out = {};
    Object.keys(SOCIAL_LABELS).forEach(key => {
      const url = String(fromSite[key] || fromConfig[key] || "").trim();
      if (/^https:\/\//.test(url)) out[key] = url;
    });
    return out;
  }

  function payment() {
    return site.payment || {};
  }

  function current() {
    return site;
  }

  // ------------------------------------------------ 	  				
  // TEMA 	 	  	 
  // ------------------------------------------------ 	  	  	

  function hexToRgb(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!match) return null;
    const n = parseInt(match[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function applyTheme(override) {
    const rgb = hexToRgb(override) || hexToRgb(site.theme) || hexToRgb(DEFAULT_THEME);
    const root = document.documentElement.style;
    const [r, g, b] = rgb;
    const lighten = c => Math.round(c + (255 - c) * 0.18);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    root.setProperty("--red", `rgb(${r}, ${g}, ${b})`);
    root.setProperty("--red-hover", `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`);
    root.setProperty("--red-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
    // Warna terang (kuning, cyan muda) butuh teks gelap di tombol. 	   			
    root.setProperty("--on-red", luminance > 0.62 ? "#111114" : "#ffffff");
  }

  // ------------------------------------------------ 	  	  	
  // GAMBAR 	  			 
  // ------------------------------------------------ 	     	

  function applyImages() {
    const images = site.images || {};

    if (isUrl(images.logo)) {
      document.querySelectorAll("img.brand-logo").forEach(img => {
        if (img.getAttribute("src") !== images.logo) img.src = images.logo;
      });
    }
    document.querySelectorAll("img.brand-logo").forEach(img => { img.alt = name(); });

    if (isUrl(images.favicon)) {
      document.querySelectorAll('link[rel~="icon"]').forEach(link => {
        link.removeAttribute("type");
        link.href = images.favicon;
      });
      document.querySelectorAll('img.login-icon[src$="favicon.svg"], img.login-icon[data-site-icon]').forEach(img => {
        img.dataset.siteIcon = "1";
        img.src = images.favicon;
      });
    }

    if (isUrl(images.appleTouch)) {
      document.querySelectorAll('link[rel="apple-touch-icon"]').forEach(link => { link.href = images.appleTouch; });
    }

    if (isUrl(images.hero)) {
      document.querySelectorAll('img[srcset*="hero-"], img[data-site-hero]').forEach(img => {
        img.dataset.siteHero = "1";
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.src = images.hero;
      });
    }
  }

  // ------------------------------------------------ 	  		  
  // KONTAK & SOSIAL MEDIA 					  
  // ------------------------------------------------  		  	 

  function applyWhatsApp() {
    const number = whatsapp();
    if (!number) return;
    document.querySelectorAll('a[href^="https://wa.me/"]').forEach(link => {
      link.href = link.href.replace(/^https:\/\/wa\.me\/\d*/, `https://wa.me/${number}`);
    });
  }

  function renderSocial() {
    const list = document.getElementById("footerSocial");
    if (!list) return;
    const { h } = GT.utils;
    const items = [];
    const number = whatsapp();
    if (number) items.push(h("li", {}, h("a", { href: `https://wa.me/${number}`, target: "_blank", rel: "noopener noreferrer" }, "WhatsApp")));
    Object.entries(socialLinks()).forEach(([key, url]) => {
      items.push(h("li", {}, h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, SOCIAL_LABELS[key])));
    });
    list.replaceChildren(...items);
  }

  // Tombol sosial melayang (Discord, TikTok, YouTube) di sisi
  // kanan layar — selalu terlihat. Link diambil dari Admin →
  // Server → Link Social Media (atau SOCIAL_LINKS di config.js).
  const FLOAT_KEYS = ["discord", "tiktok", "youtube"];
  const FLOAT_ICONS = {
    discord: '<path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><circle cx="9.5" cy="10.75" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="10.75" r="1.1" fill="currentColor" stroke="none"/>',
    tiktok: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    youtube: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>'
  };

  // Hanya tampil di halaman Home, Store, dan How To.
  const FLOAT_PAGES = ["index", "store", "howto"];
  // Ikon custom (opsional): upload ke images/social/discord.png,
  // tiktok.png, youtube.png. Kalau file tidak ada → ikon bawaan.
  const FLOAT_IMAGE_EXT = ["png"];

  function floatPage() {
    const p = window.location.pathname.toLowerCase().replace(/\/+$/, "").split("/").pop().replace(/\.html$/, "");
    return p || "index";
  }

  function floatIcon(link, key) {
    const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FLOAT_ICONS[key]}</svg>`;
    let i = 0;
    const img = document.createElement("img");
    img.alt = "";
    img.width = 46;
    img.height = 46;
    img.decoding = "async";
    img.addEventListener("load", () => { link.classList.add("has-image"); });
    img.addEventListener("error", () => {
      i += 1;
      if (i < FLOAT_IMAGE_EXT.length) {
        img.src = `/images/social/${key}.${FLOAT_IMAGE_EXT[i]}`;
      } else {
        img.remove();
        link.insertAdjacentHTML("afterbegin", svg); // Ikon statis bawaan.
      }
    });
    img.src = `/images/social/${key}.${FLOAT_IMAGE_EXT[0]}`;
    return img;
  }

  function renderFloatingSocial() {
    if (!document.body || !FLOAT_PAGES.includes(floatPage())) return;
    const links = socialLinks();
    const keys = FLOAT_KEYS.filter(key => links[key]);
    let dock = document.getElementById("socialDock");

    if (!keys.length) {
      if (dock) dock.remove();
      return;
    }
    if (!dock) {
      dock = document.createElement("nav");
      dock.id = "socialDock";
      dock.className = "social-dock";
      dock.setAttribute("aria-label", "Social media");
      document.body.append(dock);
    }

    const signature = keys.map(key => key + "=" + links[key]).join("|");
    if (dock.dataset.sig === signature) return;
    dock.dataset.sig = signature;

    dock.replaceChildren(...keys.map(key => {
      const link = document.createElement("a");
      link.className = `social-dock-btn is-${key}`;
      link.href = links[key];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", SOCIAL_LABELS[key]);
      link.append(floatIcon(link, key));
      const label = document.createElement("span");
      label.className = "social-dock-label";
      label.textContent = SOCIAL_LABELS[key];
      link.append(label);
      return link;
    }));
  }

  // ------------------------------------------------  		 		 
  // NAMA SERVER  		   	
  // --------------------------------------------------  		   	
  // Mengganti teks "GTPLAY" di halaman dengan nama baru.        
  // Tidak menyentuh Order ID (GTPLAY-2026…), kode, isian
  // form, dan halaman admin (data pesanan/GrowID).
  // ------------------------------------------------

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "KBD", "TEXTAREA", "INPUT", "SELECT", "OPTION", "NOSCRIPT"]);
  const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const brandRe = new RegExp(`${escapeRe(BASE_NAME)}(?![-_]?\\d)`, "g");
  let observer = null;

  function skipNode(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (SKIP_TAGS.has(node.tagName) || node.hasAttribute("data-brand-skip") ||
          node.classList.contains("mono") || node.classList.contains("order-id")) return true;
    }
    return false;
  }

  function renameIn(root) {
    const target = name();
    if (target === BASE_NAME || !root) return;
    const swap = value => value.replace(brandRe, target);

    if (root.nodeType === Node.TEXT_NODE) {
      if (brandRe.test(root.nodeValue) && !skipNode(root.parentElement)) root.nodeValue = swap(root.nodeValue);
      brandRe.lastIndex = 0;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || skipNode(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(node => {
      if (node.nodeValue.includes(BASE_NAME) && !skipNode(node.parentElement)) node.nodeValue = swap(node.nodeValue);
    });
    [root, ...root.querySelectorAll("[alt], [title], [aria-label]")].forEach(el => {
      ["alt", "title", "aria-label"].forEach(attr => {
        const value = el.getAttribute(attr);
        if (value && value.includes(BASE_NAME)) el.setAttribute(attr, swap(value));
      });
    });
  }

  function applyName() {
    const target = name();
    if (target === BASE_NAME) return;
    document.title = document.title.replace(brandRe, target);
    if (IS_ADMIN || !document.body) return;
    renameIn(document.body);
    // Bagian yang dibuat JavaScript belakangan (produk, pesan, dll.).
    if (!observer && "MutationObserver" in window) {
      observer = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(renameIn));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ------------------------------------------------
  // TERAPKAN
  // ------------------------------------------------

  function applyAll() {
    applyTheme();
    if (!document.body) return;
    applyImages();
    applyWhatsApp();
    renderSocial();
    renderFloatingSocial();
    applyName();
  }

  // Dipanggil admin setelah menyimpan, atau saat data server tiba.
  function apply(next) {
    site = next && typeof next === "object" ? next : {};
    writeCache(site);
    applyAll();
  }

  // Selesai setelah data terbaru dari server diterapkan (maks 5 detik).
  function ready() {
    if (readyPromise) return readyPromise;
    const fetchSite = GT.api && GT.api.getStoreStatus
      ? GT.api.getStoreStatus().then(status => { if (status) apply(status.site || {}); })
      : Promise.resolve();
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    readyPromise = Promise.race([fetchSite.catch(() => {}), timeout]);
    return readyPromise;
  }

  applyTheme();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAll, { once: true });
  } else {
    applyAll();
  }
  ready();

  // Pratinjau warna di admin tanpa menyimpan.
  function previewTheme(hex) {
    applyTheme(hex);
  }

  return { current, name, whatsapp, socialLinks, payment, apply, ready, renderSocial, previewTheme, DEFAULT_THEME };
})();
