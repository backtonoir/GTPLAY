-- ==================================================
-- GTPLAY STORE — SEED PRODUCTS
-- --------------------------------------------------
-- Sama dengan js/products.js. Harga dari website lama.
-- STOK = PLACEHOLDER (50) — ganti dengan stok asli,
-- lewat Admin Dashboard atau langsung di sini.
-- Aman dijalankan ulang (on conflict do nothing).
-- ==================================================

insert into public.products (id, name, category, description, price, stock, active, image_url, fallback, sort_order)
values
  ('item-001', 'Magplant 5K',   'Magplant', 'Magplant 5K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.',   5000, 50, true, 'images/items/magplant.png', 'MAG5K',   1),
  ('item-002', 'Magplant 7K',   'Magplant', 'Magplant 7K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.',   7000, 50, true, 'images/items/magplant.png', 'MAG7K',   2),
  ('item-003', 'Magplant 15K',  'Magplant', 'Magplant 15K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.', 13000, 50, true, 'images/items/magplant.png', 'MAG15K',  3),
  ('item-004', 'Magplant 30K',  'Magplant', 'Magplant 30K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.', 25000, 50, true, 'images/items/magplant.png', 'MAG30K',  4),
  ('item-005', 'Magplant 50K',  'Magplant', 'Magplant 50K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.', 40000, 50, true, 'images/items/magplant.png', 'MAG50K',  5),
  ('item-006', 'Magplant 100K', 'Magplant', 'Magplant 100K untuk server GTPLAY. Diberikan dalam bentuk redeem code setelah pembayaran diverifikasi admin.', 75000, 50, true, 'images/items/magplant.png', 'MAG100K', 6)
on conflict (id) do nothing;

-- ==================================================
-- MAKE AN ADMIN
-- --------------------------------------------------
-- 1. Dashboard → Authentication → Users → Add user
--    (email + password yang kuat).
-- 2. Ganti email di bawah lalu jalankan:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'admin@example.com'
-- on conflict do nothing;
-- ==================================================
