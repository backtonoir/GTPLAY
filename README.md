# GTPLAY Store

Toko item untuk **GTPLAY — Growtopia Private Server**. Frontend tetap HTML, CSS, dan Vanilla JavaScript (tanpa framework, tanpa build step). Backend opsional memakai **Supabase** (PostgreSQL + Auth + Storage).

## Fitur

- **Store** — search, filter kategori, sorting, status stok (In stock / Only N left / Sold out), lazy-loading gambar.
- **Cart** — tambah, kurangi (min. 1), tambah (maks. stok), hapus, clear, subtotal & total otomatis, tersimpan di `localStorage` (hanya ID + qty; harga selalu dibaca ulang dari katalog).
- **Checkout** — ringkasan pesanan, validasi GrowID, konfirmasi GrowID, harga & stok dicek ulang saat order dibuat.
- **QRIS Payment** — Order ID unik, kode akses, QRIS besar & responsif, countdown 5 menit yang **tidak reset saat refresh**, upload bukti bayar, *I Have Paid*, *Cancel Order*, *Order again* untuk pesanan yang expired.
- **Order Tracking** — cari dengan Order ID + kode akses, timeline status, daftar pesanan di perangkat ini.
- **Admin Dashboard** — overview (total order, revenue, pending, completed, produk tersedia), kelola pesanan (search, filter status, detail, lihat bukti bayar, verify / reject / processing / completed / cancel), kelola produk (tambah, edit, hapus, harga, stok, upload gambar, aktif/sembunyikan), rename kategori.
- **Halaman lain** — How to Buy & Payment Guide, FAQ, About / Terms / Refund Policy, Announcement, Maintenance, 404.

- **Redeem Code** — item dikirim dalam bentuk redeem code. Admin mengisi code (boleh lebih dari satu, satu per baris) saat menandai pesanan *Completed*; pembeli menyalinnya dengan tombol **Copy** di halaman pembayaran & Track Order. Code hanya terlihat oleh pembeli yang memegang Order ID + access code.
- **Redeem Code Generator** — Admin → buka pesanan → **⚙ Generate code**: website membuat code acak (prefix bisa diatur), server mengecek code belum pernah dipakai pesanan lain, admin membuat code yang sama di game lalu mencentang konfirmasi sebelum code dipakai. Code yang sama tidak bisa dipakai di dua pesanan (dijaga server).
- **Diskon** — per produk, diatur di Admin → Products (persen 0–90 + tanggal berakhir opsional). Harga akhir **dihitung server**; toko menampilkan harga coret + badge diskon, keranjang & checkout menampilkan total hemat.
- **Ulasan (Reviews)** — hanya pembeli dengan pesanan *Completed* yang bisa memberi ulasan (bintang + komentar). Ulasan tampil di landing page **setelah disetujui admin** (Admin → Reviews: Publish / Hide / Delete), urutan acak, GrowID disamarkan. Tidak ada testimoni palsu.
- **Dwi-bahasa (ID/EN)** — tombol bendera Indonesia & Amerika di navbar. Pilihan bahasa tersimpan di perangkat. Menambah/mengubah terjemahan: edit `js/i18n-dict.js`.

Status pesanan: `Pending Payment → Payment Submitted → Payment Verified → Processing → Completed`, plus `Expired`, `Cancelled`, `Rejected`.

## Dua mode

| | **Demo mode** (default) | **Supabase mode** (produksi) |
|---|---|---|
| Aktif bila | `SUPABASE_URL` kosong | `SUPABASE_URL` + `SUPABASE_ANON_KEY` diisi |
| Data pesanan | di browser pembeli saja | database Supabase |
| Harga, stok, Order ID, kedaluwarsa | dihitung di browser | **dihitung & dijaga server** |
| Konfirmasi ke admin | **wajib via WhatsApp** (seperti website lama) | otomatis masuk dashboard; WhatsApp opsional |
| Admin dashboard | demo, tanpa login, hanya data browser itu | login Supabase Auth, hanya akun di tabel `admins` |
| Bukti bayar | tidak disimpan (dikirim via WhatsApp) | disimpan di bucket privat |

> Demo mode **tidak aman untuk transaksi nyata** — data browser bisa diubah pembeli. Alurnya tetap sama dengan website lama (pembeli mengirim detail + bukti ke WhatsApp admin), hanya lebih rapi. Untuk produksi, aktifkan Supabase.

## Struktur folder

```text
GTPLAY/
├── index.html          Home, Store, How to Buy, FAQ
├── checkout.html       Ringkasan pesanan + GrowID
├── payment.html        QRIS, countdown, upload bukti
├── track.html          Order tracking
├── admin.html          Admin dashboard
├── info.html           About, Terms & Conditions, Refund Policy
├── announcement.html   Pengumuman
├── maintenance.html    Halaman maintenance
├── 404.html
├── style.css           Seluruh desain (satu file)
├── favicon.svg
├── vercel.json         Security headers (CSP, dll.)
├── api/
│   └── server-status.js  Status server dari API GTPS Cloud (Vercel function)
├── js/
│   ├── config.js       ← KONFIGURASI (WhatsApp, QRIS, Supabase, sosial media)
│   ├── utils.js        Format Rupiah, DOM builder aman, toast, status
│   ├── products.js     Katalog awal / demo
│   ├── api.js          Data layer (adapter Demo + Supabase)
│   ├── cart.js         State keranjang
│   ├── layout.js       Navbar mobile, cart drawer, footer
│   ├── store.js        Halaman store
│   ├── checkout.js
│   ├── payment.js
│   ├── timeline.js     Timeline status (payment, track, admin)
│   ├── track.js
│   ├── admin.js
│   └── announcement.js ← Isi pengumuman
├── images/
│   ├── qris.png        ← QRIS kamu (tidak disertakan, pakai file lama)
│   ├── items/          ← Gambar item (mis. magplant.png dari website lama)
│   └── brand/          Hero, OG image, apple-touch-icon
└── supabase/
    ├── schema.sql      Tabel, RLS, RPC, storage policy
    └── seed.sql        Produk awal + cara membuat admin
```

`script.js` dan `announcement.js` lama di root sudah digantikan oleh file di `js/` — hapus dari repo.

## Menjalankan secara lokal

Buka folder dengan **Live Server** (VS Code) atau:

```bash
python3 -m http.server 8000
# buka http://localhost:8000
```

Membuka `index.html` langsung (file://) juga berjalan, tetapi Live Server lebih mirip kondisi Vercel.

## Pengaturan umum

Semua di **`js/config.js`**.

- **WhatsApp admin** — `WHATSAPP_NUMBER: "6283829870348"` (format internasional, tanpa `+`/spasi). Link WhatsApp statis di HTML (footer, FAQ, maintenance) memakai nomor yang sama — cari `wa.me/` jika nomor berubah.
- **QRIS** — taruh gambar di `images/qris.png`, atau ubah `QRIS_IMAGE`. Gunakan PNG tajam minimal 600×600 px.
- **Metode pembayaran (QRIS / GoPay / BCA)** — di `PAYMENT_METHODS`. Pembeli memilih metode di halaman pembayaran lalu upload bukti; verifikasi tetap **manual** oleh admin. **Isi dengan data kamu sendiri** — jangan pakai contoh. Tiap metode tampil hanya jika datanya diisi:
  - `qris` — tampil selama ada `QRIS_IMAGE`.
  - `gopay` — isi `number` (nomor GoPay/HP) dan `name`. Kosongkan `number` untuk menyembunyikan.
  - `bca` — isi `number` (nomor rekening) dan `name`. Kosongkan `number` untuk menyembunyikan.

  Metode yang dipilih pembeli ikut tercatat di pesanan (terlihat di detail order Admin) dan di pesan WhatsApp konfirmasi. **Jalankan ulang `supabase/schema.sql`** agar kolom `payment_method` ditambahkan (aman diulang).
- **Sosial media** — isi `SOCIAL_LINKS` (instagram, tiktok, discord, youtube). Link kosong tidak ditampilkan.
- **Durasi pembayaran** — `PAYMENT_WINDOW_MINUTES` (demo). Di Supabase ubah `c_window` di fungsi `create_order` pada `supabase/schema.sql`.
- **Aturan GrowID** — `GROWID_PATTERN` di `js/utils.js` dan regex yang sama di `schema.sql` (default: 3–24 huruf/angka/underscore).

## Produk, harga, dan kategori

**Supabase mode:** gunakan **Admin Dashboard → Products** (tambah, edit harga/stok, upload gambar, aktif/sembunyikan, hapus). Kategori dibuat dengan mengetik nama kategori baru saat menambah/mengedit produk; ganti nama lewat **Manage categories**.

**Demo mode:** edit `js/products.js`.

```js
{
  id: "item-007",            // unik, jangan diubah setelah ada pesanan
  name: "World Lock",
  category: "Currency",      // kategori baru otomatis muncul di filter
  description: "…",
  price: 10000,              // Rupiah, angka bulat
  stock: 100,
  active: true,              // false = disembunyikan
  image: "images/items/world-lock.png",
  fallback: "WL",            // teks bila gambar tidak ada
  sortOrder: 7
}
```

> Harga Magplant dipertahankan dari website lama. **Stok 50 di data awal adalah placeholder** — ganti dengan stok asli.

## Redeem code

- Admin → Orders → buka pesanan → **Mark Completed** → isi redeem code → **Save & complete**. Completed tanpa redeem code ditolak server.
- Code bisa diisi lebih awal (status Verified/Processing) atau diperbaiki setelah Completed lewat kolom **Redeem code → Save redeem code**.
- Teks petunjuk di bawah code: `REDEEM_HELP` di `js/config.js`.

**Upgrade database yang sudah berjalan:** jalankan ulang seluruh isi `supabase/schema.sql` di SQL Editor. Aman diulang — data, produk, dan admin tidak hilang; kolom baru (`redeem_code`, `discount_percent`, `discount_ends_at`, `list_price`), tabel `reviews`, dan fungsi baru akan ditambahkan.

## Diskon, ulasan & dwi-bahasa (v3.7)

- **Diskon:** Admin → Products → Edit → kolom **Discount (%)** (0–90) dan **Ends at** (opsional). Kosongkan Ends at agar diskon berlaku terus sampai diubah kembali ke 0. Harga akhir dihitung di server (`gt_effective_price`), jadi harga dari browser tetap diabaikan.
- **Generator redeem code:** Admin → buka pesanan → **Generate code**. Prefix terakhir diingat di browser admin. Pakai **Generate** lagi jika ada code yang bentrok. Centang konfirmasi **hanya** setelah code dibuat di game.
- **Ulasan:** muncul otomatis di halaman pesanan setelah *Completed*. Admin menyetujui di tab **Reviews**. Hanya ulasan yang dipublikasikan tampil di landing page. Hapus ulasan juga menghapus kemampuan pembeli mengirim ulasan baru untuk pesanan itu.
- **Bahasa:** dua file — `js/i18n.js` (mesin) dan `js/i18n-dict.js` (kamus). Teks baru diterjemahkan dengan menambahkan pasangan `["English", "Indonesia"]` di kamus. Untuk teks statis di HTML yang sudah berbahasa Indonesia, pakai bentuk tiga elemen `["English", "Indonesia", "teks lama di HTML"]`.

## Landing page (index.html)

Halaman utama sekarang landing page; toko pindah ke `store.html`.

- **Status server, player online, world aktif** — dibaca otomatis dari API publik GTPS Cloud (`https://api.gtps.cloud/api/server/public/<ID>`) lewat Vercel function `api/server-status.js`, lalu di-cache 30 detik. Tidak perlu script Lua. Server ID default `6986`; untuk menggantinya isi environment variable `GTPS_SERVER_ID` di Vercel → Settings → Environment Variables lalu redeploy. Function hanya meneruskan status, jumlah player, world, dan uptime — IP/port server tidak dikirim ke browser. Di Live Server lokal endpoint ini tidak ada, jadi status tampil "Unavailable" (normal).
- **Peak online (opsional)** — Admin → Server → *Advanced — Lua stats reporter*: generate token & script Lua jika ingin mencatat peak online.
- **Harga Blue Gem Lock** — Admin → **BGL Price**: isi tanggal + harga (Rupiah). Satu harga per tanggal; grafik muncul setelah ada minimal 2 data.
- **Download** — Admin → **Downloads**: isi link Windows / Android (wajib `https://`). Link kosong tampil "Coming soon" (iOS & macOS).
- **Pengumuman** — Admin → **Announcements**: tambah, edit, hapus, atau simpan sebagai draft. Tampil di landing page (3 terbaru) dan `announcement.html`.

## Konfigurasi backend (Supabase)

1. Buat project di [supabase.com](https://supabase.com).
2. **SQL Editor** → jalankan isi `supabase/schema.sql`, lalu `supabase/seed.sql`.
3. **Authentication → Users → Add user** — buat akun admin (email + password kuat).
4. Jadikan admin (ganti emailnya):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'admin@example.com'
   on conflict do nothing;
   ```
5. **Authentication → Sign In / Providers** — matikan *Allow new users to sign up* agar orang lain tidak bisa membuat akun.
6. **Project Settings → API** — salin *Project URL* dan *anon / publishable key* ke `js/config.js`:
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ…"
   ```
   **Jangan pernah** memakai `service_role` key di frontend.
7. (Opsional) Aktifkan extension **pg_cron** lalu jalankan perintah di bagian akhir `schema.sql` agar pesanan expired diproses tiap menit. Tanpa ini, pesanan tetap ditandai expired saat ada request berikutnya.

### Yang dijamin server

- Harga, total, dan stok dihitung dari database; harga dari browser diabaikan.
- Stok direservasi saat order dibuat (aman dari *race condition* — diuji dengan 6 pembeli bersamaan untuk 1 stok tersisa), dikembalikan saat expired / cancelled / rejected.
- Order ID `GTPLAY-YYYYMMDD-XXXXXX` dari generator kriptografis + constraint UNIQUE.
- Kode akses 8 karakter, disimpan sebagai hash SHA-256. Pesanan tidak bisa dilihat hanya dengan menebak Order ID atau GrowID.
- Pesanan expired tidak bisa dibayar/di-upload bukti; batas waktu dicek di server, bukan dari timer browser.
- Maks. 3 pesanan *pending* per GrowID untuk mengurangi penimbunan stok.
- Admin hanya bisa melakukan transisi status yang valid; reject wajib menyertakan alasan. Pembayaran yang masuk setelah expired bisa diverifikasi admin (stok direservasi ulang).
- Bukti bayar di bucket **privat**; pembeli hanya bisa upload ke pesanan pending miliknya (maks. 5 file, PNG/JPG/WEBP, ≤ 5 MB).

### Yang belum otomatis (butuh integrasi tambahan)

- **Verifikasi pembayaran otomatis** — butuh payment gateway QRIS dinamis (mis. Midtrans, Xendit, Tripay) + webhook. Saat ini admin memverifikasi manual. QRIS statis tidak bisa diverifikasi otomatis.
- **Pengiriman item otomatis** — butuh integrasi ke server game GTPLAY.
- **Notifikasi** ke admin/pembeli (WhatsApp API, email, Telegram).
- **Anti-spam tambahan** untuk pembuatan order (mis. Cloudflare Turnstile + Edge Function).

## Deploy ke Vercel

1. Push folder ini ke GitHub (ganti isi repo lama).
2. Pastikan `images/qris.png` dan gambar item ikut ter-commit.
3. Di [vercel.com](https://vercel.com) → **Add New → Project** → pilih repo → Framework Preset **Other** → Build command & output directory kosong → **Deploy**. Project yang sudah terhubung akan deploy otomatis setiap push.
4. `vercel.json` menambahkan security headers (CSP, `X-Frame-Options`, dll.). Jika kamu menambah script/gambar dari domain lain, tambahkan domainnya ke CSP.

### URL bersih (tanpa `.html`)

`vercel.json` mengaktifkan `"cleanUrls": true`, jadi semua halaman diakses tanpa `.html`:

| Lama | Baru |
|---|---|
| `/store.html` | `/store` |
| `/track.html` | `/track` |
| `/admin.html` | `/admin` |
| `/admin.html#announcements` | `/admin/announcements` |

- URL lama (`...​.html` dan `/admin.html#tab`) tetap bekerja — otomatis dialihkan ke bentuk baru, jadi bookmark lama tidak rusak.
- Tab admin kini jadi bagian path: `/admin/orders`, `/admin/products`, `/admin/reviews`, `/admin/announcements`, `/admin/prices`, `/admin/downloads`, `/admin/server`. Blok `rewrites` di `vercel.json` yang membuat ini bekerja — **jangan dihapus**.
- Membuka `admin.html` langsung dari file (file://) tidak disarankan; akses lewat domain Vercel. Untuk tes lokal pakai `python3 -m http.server` lalu buka `/admin.html` (mode hash `#tab` otomatis dipakai saat URL masih berakhiran `.html`).

### Mode maintenance

**Cara utama:** Admin → Overview → kartu **Store status** → isi estimasi waktu & pesan → **Turn on maintenance**. Pengunjung toko dialihkan ke `maintenance.html`, pesanan baru ditolak server, sedangkan Payment & Track Order tetap bisa dibuka untuk pesanan yang sudah ada. Admin yang login tetap bisa melihat toko. Tekan **Open store** untuk membuka kembali — halaman maintenance otomatis kembali ke toko dalam ±30 detik.

**Cara darurat** (mis. Supabase sedang bermasalah) — lewat `vercel.json`:

Tambahkan blok `redirects` ke `vercel.json` (sejajar dengan `"headers"`), lalu commit. Semua halaman toko dialihkan ke `/maintenance`, sementara `/admin` tetap bisa dibuka:

```json
"redirects": [
  {
    "source": "/((?!maintenance|admin|style\\.css|favicon\\.svg|js/|images/|api/).*)",
    "destination": "/maintenance",
    "permanent": false
  }
],
```

Untuk membuka toko lagi, hapus blok `redirects` itu dan commit. Teks status / estimasi waktu ada di `maintenance.html`.

## Catatan

- Kebijakan di `info.html` (Terms & Refund) adalah **draf** yang mengikuti cara kerja sistem — tinjau sebelum dipublikasikan.
- GTPLAY adalah private server dan tidak berafiliasi dengan Growtopia atau Ubisoft.
