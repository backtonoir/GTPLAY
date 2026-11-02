// GTPLAY v3.8 (clean URLs)
// ==================================================
// GTPLAY PRODUCT CATALOG (SEED / DEMO DATA)
// --------------------------------------------------
// • DEMO MODE  : katalog ini dipakai langsung oleh website.
//                Perubahan dari Admin Dashboard (demo) disimpan
//                di browser admin saja.
// • PRODUCTION : katalog dibaca dari tabel `products` di Supabase.
//                File ini hanya sebagai data awal — salin ke
//                database lewat supabase/seed.sql.
//
// Harga diambil dari script.js lama tanpa perubahan.
// `stock` di bawah adalah PLACEHOLDER — ganti dengan stok asli.
//
// Field:
//   id          string unik, jangan diubah setelah ada pesanan
//   name        nama item
//   category    kategori (dipakai filter)
//   description deskripsi singkat
//   price       harga dalam Rupiah (angka bulat)
//   stock       jumlah tersedia
//   active      false = disembunyikan dari toko
//   image       path gambar (kosong = pakai teks fallback)
//   fallback    teks pengganti bila gambar tidak tersedia
//   sortOrder   urutan tampilan default
// ==================================================

window.GT = window.GT || {};

GT.seedProducts = [
  {
    id: "item-001",
    name: "Magplant 5K",
    category: "Magplant",
    description: "Magplant 5K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 5000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG5K",
    sortOrder: 1
  },
  {
    id: "item-002",
    name: "Magplant 7K",
    category: "Magplant",
    description: "Magplant 7K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 7000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG7K",
    sortOrder: 2
  },
  {
    id: "item-003",
    name: "Magplant 15K",
    category: "Magplant",
    description: "Magplant 15K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 13000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG15K",
    sortOrder: 3
  },
  {
    id: "item-004",
    name: "Magplant 30K",
    category: "Magplant",
    description: "Magplant 30K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 25000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG30K",
    sortOrder: 4
  },
  {
    id: "item-005",
    name: "Magplant 50K",
    category: "Magplant",
    description: "Magplant 50K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 40000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG50K",
    sortOrder: 5
  },
  {
    id: "item-006",
    name: "Magplant 100K",
    category: "Magplant",
    description: "Magplant 100K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.",
    price: 75000,
    stock: 50,
    active: true,
    image: "images/items/magplant.png",
    fallback: "MAG100K",
    sortOrder: 6
  }
];

// ==================================================
// PENGUMUMAN AWAL (DEMO)
// --------------------------------------------------
// Mode Supabase: pengumuman dikelola dari Admin →
// Announcements (tabel `announcements`). Data di bawah
// hanya dipakai di demo mode.
// ==================================================

GT.seedAnnouncements = [
  {
    id: "ann-1",
    category: "event",
    title: "Double Drop Rate Weekend!",
    content: "Semua drop rate di server GTPLAY naik 2x lipat selama akhir pekan ini. Jangan lewatkan kesempatan farming item langka!",
    publishedOn: "2026-11-01",
    published: true,
    createdAt: "2026-11-01T00:00:00.000Z"
  },
  {
    id: "ann-2",
    category: "update",
    title: "Restock Magplant Tersedia",
    content: "Stok Magplant 5K sampai 100K sudah tersedia kembali di Store. Pembayaran via QRIS, pesanan diproses setelah admin memverifikasi bukti pembayaran.",
    publishedOn: "2026-10-28",
    published: true,
    createdAt: "2026-10-28T00:00:00.000Z"
  },
  {
    id: "ann-3",
    category: "maintenance",
    title: "Jadwal Maintenance Mingguan",
    content: "Server akan maintenance setiap Senin pukul 02.00–04.00 WIB untuk optimasi performa. Mohon tidak melakukan transaksi selama jam tersebut.",
    publishedOn: "2026-10-25",
    published: true,
    createdAt: "2026-10-25T00:00:00.000Z"
  },
  {
    id: "ann-4",
    category: "update",
    title: "Perbaikan Sistem Checkout",
    content: "Sistem checkout & konfirmasi pembayaran QRIS sudah diperbarui agar lebih stabil. Laporkan ke Admin via WhatsApp jika masih menemukan kendala.",
    publishedOn: "2026-10-20",
    published: true,
    createdAt: "2026-10-20T00:00:00.000Z"
  }
];
