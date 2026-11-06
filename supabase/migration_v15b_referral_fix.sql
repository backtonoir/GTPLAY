-- ==================================================
-- GTPLAY v15b — PERBAIKAN KODE REFERRAL
-- --------------------------------------------------
-- Memperbaiki error "function gt_paid_status(order_status)
-- does not exist" yang membuat tab Admin → Coupons tidak
-- bisa dibuka setelah menjalankan migration_v15_referral.sql.
--
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

create or replace function public.gt_paid_status(p_status public.order_status)
returns boolean
language sql
immutable
as $$ select p_status::text in ('payment_verified', 'processing', 'completed') $$;

revoke all on function public.gt_paid_status(public.order_status) from public, anon, authenticated;
