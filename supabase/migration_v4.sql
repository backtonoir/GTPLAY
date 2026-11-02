-- ==================================================
-- GTPLAY v4.0 — MIGRATION
-- --------------------------------------------------
-- Realtime untuk tabel orders, supaya admin dashboard
-- menerima order baru & perubahan status secara live
-- tanpa polling. RLS tidak diubah: Realtime tetap
-- mengikuti policy SELECT yang sudah ada (hanya admin
-- yang bisa membaca orders).
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah
-- schema.sql (v3.x) sudah diterapkan.
-- ==================================================

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;
