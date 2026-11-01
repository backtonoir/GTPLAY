// GTPLAY v3.5 (server stats via Lua)
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
  // STATUS SERVER (landing page)
  // ------------------------------------------------
  // Kosong (disarankan) = memakai data yang dikirim script Lua
  // server ke Supabase (Admin → Server). Isi dengan URL JSON
  // lain hanya jika punya sumber status sendiri.
  SERVER_STATUS_URL: "",
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
