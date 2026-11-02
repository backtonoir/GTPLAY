-- ==================================================
-- GTPLAY v7 — DESKRIPSI PRODUK PANJANG
-- --------------------------------------------------
-- Batas deskripsi produk dinaikkan dari 300 ke 2.000
-- karakter supaya detail seperti benefit dan syarat
-- bisa ditulis lengkap. Tampil penuh di jendela Detail
-- pada halaman Store.
--
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

alter table public.products drop constraint if exists products_description_check;
alter table public.products
  add constraint products_description_check check (length(description) <= 2000);
