// GTPLAY v3.3 (landing page)
// ==================================================
// MAINTENANCE PAGE (maintenance.html)
// --------------------------------------------------
// Pesan & estimasi waktu diambil dari pengaturan yang
// diisi admin. Halaman memeriksa status tiap 30 detik;
// begitu admin membuka toko lagi, pengunjung otomatis
// kembali ke toko.
// ==================================================

(function () {
  const { $ } = GT.utils;

  const messageEl = $("#maintenanceMessage");
  const etaEl = $("#maintenanceEta");
  const statusEl = $("#maintenanceStatus");
  const backBtn = $("#maintenanceBack");

  let wasOn = false;

  function apply(status) {
    if (status.maintenance) {
      wasOn = true;
      if (status.message) messageEl.textContent = status.message;
      if (status.eta) etaEl.textContent = status.eta;
      statusEl.textContent = "In Progress";
      backBtn.hidden = true;
      return;
    }

    // Toko sudah buka.
    statusEl.textContent = "Online";
    etaEl.textContent = "—";
    backBtn.hidden = false;

    // Hanya pindah otomatis jika tadi kita melihat status maintenance
    // menyala (mencegah loop dengan mode maintenance lewat vercel.json).
    if (wasOn) window.location.replace("index.html");
  }

  async function check() {
    try {
      apply(await GT.api.getStoreStatus());
    } catch (error) {
      /* Server tidak bisa dihubungi → biarkan teks default. */
    }
  }

  check();
  setInterval(check, 30000);
})();
