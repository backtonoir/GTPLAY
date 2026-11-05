-- ==================================================
-- GTPLAY v12 — PAKET BUNDLE
-- --------------------------------------------------
-- Produk bisa berisi produk lain beserta jumlahnya
-- (mis. Starter Bundle = Magplant 5K ×2 + Rayman Fist ×1).
-- Harga & stok bundle diatur sendiri seperti produk biasa.
-- Store menampilkan isi paket dan penghematan dibanding
-- beli satuan; detail pesanan admin menampilkan isinya.
--
-- Format: [{"productId": "<id>", "qty": 2}, ...] (maks 10).
-- Atur di Admin → Products → Edit → Isi bundle.
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

alter table public.products add column if not exists bundle_items jsonb
  check (bundle_items is null or (jsonb_typeof(bundle_items) = 'array' and jsonb_array_length(bundle_items) <= 10));
