// GTPLAY v3.9 (GoPay & BCA)
// ==================================================
// GTPLAY CONFIGURATION
// --------------------------------------------------
// Satu-satunya file yang perlu diubah untuk konfigurasi
// dasar toko. Semua file JS lain membaca nilai dari sini.
// ==================================================

window.GT = window.GT || {};

GT.config = Object.freeze({
  STORE_NAME: "GTPLAY",

  // Nomor WhatsApp admin (format internasional, tanpa "+" atau spasi).
  WHATSAPP_NUMBER: "6283829870348",

  // Lokasi gambar QRIS statis.
  QRIS_IMAGE: "images/qris.png",

  // ------------------------------------------------
  // METODE PEMBAYARAN
  // --------------------------------------------------
  // Pembeli memilih salah satu metode lalu upload bukti.
  // Verifikasi tetap MANUAL oleh admin (tidak otomatis).
  //
  // ISI DENGAN DATA KAMU SENDIRI — jangan pakai contoh.
  // Metode akan tampil HANYA jika datanya diisi:
  //   • qris  tampil jika ada gambar QRIS (QRIS_IMAGE).
  //   • gopay tampil jika "number" diisi.
  //   • bca   tampil jika "number" diisi.
  // Kosongkan "number" untuk menyembunyikan metode itu.
  PAYMENT_METHODS: {
    qris: {
      label: "QRIS",
      note: "Scan dengan aplikasi bank atau e-wallet apa pun (GoPay, OVO, DANA, ShopeePay, m-banking)."
    },
    gopay: {
      label: "GoPay",
      number: "0815-4832-3242",          // nomor GoPay (nomor HP), mis. "0812-3456-7890"
      name: "Jonathan Ariya Soputro",            // nama akun GoPay
      note: "Kirim GoPay ke nomor di atas sesuai nominal, lalu upload bukti transfer."
    },
    bca: {
      label: "Bank BCA",
      bank: "BCA",
      number: "238-158-2762",          // nomor rekening BCA
      name: "Jonathan Ariya Soputro",            // nama pemilik rekening
      note: "Transfer ke rekening BCA di atas sesuai nominal, lalu upload bukti transfer."
    }
  },

  // Durasi sesi pembayaran (menit). Untuk mode Supabase, nilai yang
  // berlaku adalah yang ada di database (lihat supabase/schema.sql).
  PAYMENT_WINDOW_MINUTES: 5,

  // Link sosial media di footer. Kosongkan yang tidak dipakai —
  // link kosong tidak akan ditampilkan.
  SOCIAL_LINKS: {
    instagram: "",
    tiktok: "",
    discord: "",
    youtube: ""
  },

  // ------------------------------------------------
  // CARA LOGIN (halaman /howto → "Cara Login per Platform")
  // ------------------------------------------------
  // Ubah IP server & link di sini saja — semua kartu login
  // di halaman How To ikut berubah otomatis.
  //   • Link kosong ("") → tulisan tetap tampil tapi tidak bisa diklik.
  //   • gtplayApk kosong → otomatis memakai link Android
  //     dari Admin → Downloads.
  LOGIN_GUIDE: {
    // File hosts (Windows & Mac): setiap domain di bawah ditulis
    // satu baris "IP domain". Isi IP saja di serverIp — JANGAN tekan
    // Enter di dalam tanda kutip.
    serverIp: "5.39.13.24",
    hostsDomains: [
      "growtopia1.com",
      "growtopia2.com",
      "www.growtopia1.com",
      "www.growtopia2.com"
    ],
    certificateUrl: "https://dash.gtps.cloud/gtps-root-ca.crt",                           // link sertifikat GTPS Cloud (Windows, Growtopia v5.59+)

    // Link tombol download
    gtplayApk: "https://drive.google.com/file/d/17u4k8NOf2Q4eyh6db4kFFmXx8yrsjYtS/view?usp=sharing",                                // GTPLAY APK (Android)
    powerTunnel: "https://drive.google.com/file/d/1eyPy9ejgiAUHYPJ_eyfrR2noGgzCrvHq/view?usp=sharing",                              // PowerTunnel APK
    hostsGo: "https://drive.google.com/file/d/1T9pc1txadfoE84xqPYpz30UMIsBgjMma/view?usp=sharing",                                  // Hosts Go (No Root)
    virtualHost: "https://drive.google.com/file/d/1eyPy9ejgiAUHYPJ_eyfrR2noGgzCrvHq/view?usp=sharing",                              // Virtual Host APK
    hostsFile: "https://drive.google.com/file/d/1xArn0o_nUU37XYk1CHTKn_U3cpEqTQKo/view?usp=drive_link",                                // file hosts untuk Virtual Host
    surge5: "https://apps.apple.com/us/app/surge-5/id1442620678",                                   // Surge5 (App Store)

    // Teks yang player salin/ketik
    androidHostsUrl: "https://dash.gtps.cloud/android/6986",  // PowerTunnel & Hosts Go
    iosProfileUrl: "https://dash.gtps.cloud/ios/6986",        // profil Surge5
    hostsFileName: "GTPLAY.txt"                  // nama file hosts Virtual Host
  },

  // ------------------------------------------------
  // STATUS SERVER (landing page)
  // ------------------------------------------------
  // "/api/server-status" = Vercel function (folder api/) yang membaca
  // API publik GTPS Cloud. Server ID diatur lewat environment variable
  // GTPS_SERVER_ID di Vercel (default 6986).
  // Kosongkan = memakai data dari script Lua (Admin → Server → Advanced).
  SERVER_STATUS_URL: "/api/server-status",
  SERVER_STATUS_REFRESH_SECONDS: 60,

  // Petunjuk singkat cara memakai redeem code, tampil di bawah code
  // pada halaman pembayaran & Track Order. Sesuaikan dengan cara
  // redeem di server GTPLAY.
  REDEEM_HELP: "Salin code di atas lalu redeem di game GTPLAY. Hubungi admin jika code tidak bisa dipakai.",

  // Batas ukuran bukti pembayaran (MB).
  MAX_PROOF_MB: 5,

  // ------------------------------------------------
  // BACKEND (SUPABASE)
  // ------------------------------------------------
  // Kosongkan = DEMO MODE (data hanya tersimpan di browser ini,
  // tidak ada transaksi nyata). Isi keduanya untuk mode produksi.
  //
  // SUPABASE_ANON_KEY adalah *publishable/anon key* — memang aman
  // untuk frontend karena semua akses dikunci oleh RLS & RPC.
  // JANGAN PERNAH menaruh "service_role" key di sini.
  SUPABASE_URL: "https://nyzpyibmytdjkexiqsku.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55enB5aWJteXRkamtleGlxc2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NDExNDIsImV4cCI6MjEwOTExNzE0Mn0.KXCxaZelsJl_H-WkNV6ghXXuGWGNlBZt9axsfGFGsZY",

  // Versi library Supabase yang dimuat dari CDN (hanya mode produksi).
  SUPABASE_JS_URL: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"
});

GT.isBackendConfigured = function () {
  return Boolean(GT.config.SUPABASE_URL && GT.config.SUPABASE_ANON_KEY);
};
