// ==================================================
// ANNOUNCEMENT DATA
// --------------------------------------------------
// Edit / tambah objek di array ini untuk menulis
// pengumuman baru (yang terbaru di atas). "category"
// menentukan warna badge: "event", "update", atau
// "maintenance".
// ==================================================

const announcements = [
  {
    id: 1,
    category: "event",
    date: "1 November 2026",
    title: "Double Drop Rate Weekend!",
    content:
      "Semua drop rate di server GTPLAY naik 2x lipat selama akhir pekan ini. Jangan lewatkan kesempatan farming item langka!"
  },
  {
    id: 2,
    category: "update",
    date: "28 Oktober 2026",
    title: "Restock Magplant Tersedia",
    content:
      "Stok Magplant 5K sampai 100K sudah tersedia kembali di Store. Pembayaran via QRIS, pesanan diproses setelah admin memverifikasi bukti pembayaran."
  },
  {
    id: 3,
    category: "maintenance",
    date: "25 Oktober 2026",
    title: "Jadwal Maintenance Mingguan",
    content:
      "Server akan maintenance setiap Senin pukul 02.00–04.00 WIB untuk optimasi performa. Mohon tidak melakukan transaksi selama jam tersebut."
  },
  {
    id: 4,
    category: "update",
    date: "20 Oktober 2026",
    title: "Perbaikan Sistem Checkout",
    content:
      "Sistem checkout & konfirmasi pembayaran QRIS sudah diperbarui agar lebih stabil. Laporkan ke Admin via WhatsApp jika masih menemukan kendala."
  }
];

// ==================================================
// RENDER (aman: teks dimasukkan lewat textContent)
// ==================================================

(function () {
  const { h, $ } = GT.utils;
  const list = $("#announcementList");
  const allowed = ["event", "update", "maintenance"];

  if (announcements.length === 0) {
    list.replaceChildren(h("div", { class: "state-block" }, h("p", { class: "state-title" }, "No announcements yet")));
  } else {
    list.replaceChildren(...announcements.map(item => {
      const category = allowed.includes(item.category) ? item.category : "update";

      return h("article", { class: "announcement-card" },
        h("div", { class: "announcement-top" },
          h("span", { class: `announcement-badge ${category}` }, category),
          h("span", { class: "announcement-date" }, item.date)
        ),
        h("h3", {}, item.title),
        h("p", {}, item.content)
      );
    }));
  }

  GT.layout.init().catch(() => {});
})();
