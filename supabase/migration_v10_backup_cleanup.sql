-- ==================================================
-- GTPLAY v10 — BACKUP & PEMBERSIHAN DATA LAMA
-- --------------------------------------------------
-- Admin → Server → Backup & Pembersihan:
--   • Download Backup  : semua data dalam satu file JSON
--                        (tidak menghapus apa pun)
--   • Bersihkan data lama: hanya pesanan selesai /
--     dibatalkan / ditolak / expired yang lebih tua dari
--     X hari, foto bukti bayarnya, dan feedback yang sudah
--     dibaca. Produk, kupon, pengaturan, ulasan yang tampil,
--     dan pesanan aktif TIDAK disentuh.
--
-- Juga memulihkan bucket "payment-proofs" (bukti bayar)
-- beserta aturan aksesnya bila bucket itu terhapus.
--
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

-- --------------------------------------------------
-- 1. Bucket bukti bayar (PRIVATE)
-- --------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "gtplay proofs: customer upload" on storage.objects;
create policy "gtplay proofs: customer upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and public.can_upload_proof(name));

drop policy if exists "gtplay proofs: admin read" on storage.objects;
create policy "gtplay proofs: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

-- Admin boleh menghapus bukti bayar (dipakai saat pembersihan).
drop policy if exists "gtplay proofs: admin delete" on storage.objects;
create policy "gtplay proofs: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

-- --------------------------------------------------
-- 2. Backup: semua tabel dalam satu JSON
-- --------------------------------------------------
-- Tidak menyertakan data rahasia: hash kode akses pesanan,
-- hash IP feedback, token statistik server, dan daftar admin.
create or replace function public.admin_export_backup()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tables text[] := array[
    'products', 'orders', 'order_items', 'order_events', 'coupons', 'reviews',
    'feedback', 'announcements', 'lock_prices', 'store_settings'
  ];
  v_table  text;
  v_hidden text[];
  v_rows   jsonb;
  v_out    jsonb := '{}'::jsonb;
begin
  perform public.gt_require_admin();

  foreach v_table in array v_tables loop
    continue when to_regclass('public.' || v_table) is null;
    v_hidden := case v_table
      when 'orders' then array['access_code_hash']
      when 'feedback' then array['ip_hash']
      else array[]::text[]
    end;
    execute format('select coalesce(jsonb_agg(to_jsonb(t) - %L::text[]), ''[]''::jsonb) from public.%I t', v_hidden, v_table)
      into v_rows;
    v_out := v_out || jsonb_build_object(v_table, v_rows);
  end loop;

  return jsonb_build_object(
    'format', 'gtplay-backup',
    'version', 1,
    'exportedAt', now(),
    'tables', v_out
  );
end $$;

-- --------------------------------------------------
-- 3. Pembersihan data lama
-- --------------------------------------------------
-- Pesanan yang boleh dibersihkan: status akhir, tidak
-- berubah lebih dari p_days hari, dan tidak punya ulasan
-- yang sedang tampil di website.
create or replace function public.gt_cleanup_candidates(p_days integer)
returns setof public.orders
language sql
stable
set search_path = public, pg_temp
as $$
  select o.*
  from public.orders o
  where o.status in ('completed', 'cancelled', 'rejected', 'expired')
    and o.updated_at < now() - make_interval(days => p_days)
    and not exists (
      select 1 from public.reviews r where r.order_id = o.id and r.status = 'approved'
    );
$$;

create or replace function public.admin_cleanup_preview(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  if p_days is null or p_days < 7 or p_days > 3650 then
    raise exception 'GT:INVALID_CLEANUP';
  end if;

  return jsonb_build_object(
    'days', p_days,
    'orders', (select count(*) from public.gt_cleanup_candidates(p_days)),
    'proofs', (select count(*) from public.gt_cleanup_candidates(p_days) c where c.proof_path is not null),
    'feedback', case when to_regclass('public.feedback') is null then 0
                     else (select count(*) from public.feedback where status = 'read') end,
    'totalOrders', (select count(*) from public.orders),
    'activeOrders', (select count(*) from public.orders
                     where status in ('pending_payment', 'payment_submitted', 'payment_verified', 'processing')),
    'databaseBytes', pg_database_size(current_database())
  );
end $$;

create or replace function public.admin_cleanup_old_data(p_days integer, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_paths    text[];
  v_orders   integer;
  v_feedback integer := 0;
begin
  perform public.gt_require_admin();
  if p_days is null or p_days < 7 or p_days > 3650 then
    raise exception 'GT:INVALID_CLEANUP';
  end if;
  if coalesce(p_confirm, '') <> 'HAPUS' then
    raise exception 'GT:CLEANUP_CONFIRM';
  end if;

  select coalesce(array_agg(c.proof_path) filter (where c.proof_path is not null), array[]::text[])
    into v_paths
    from public.gt_cleanup_candidates(p_days) c;

  -- order_items, order_events, dan ulasan tersembunyi ikut terhapus (cascade).
  delete from public.orders
    where id in (select c.id from public.gt_cleanup_candidates(p_days) c);
  get diagnostics v_orders = row_count;

  if to_regclass('public.feedback') is not null then
    delete from public.feedback where status = 'read';
    get diagnostics v_feedback = row_count;
  end if;

  -- File bukti bayar dihapus admin lewat Storage API (lihat js/api.js).
  return jsonb_build_object('orders', v_orders, 'feedback', v_feedback, 'proofPaths', to_jsonb(v_paths));
end $$;

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.gt_cleanup_candidates(integer)           from public, anon, authenticated;
revoke all on function public.admin_export_backup()                    from public, anon;
revoke all on function public.admin_cleanup_preview(integer)           from public, anon;
revoke all on function public.admin_cleanup_old_data(integer, text)    from public, anon;

grant execute on function public.admin_export_backup()                 to authenticated;
grant execute on function public.admin_cleanup_preview(integer)        to authenticated;
grant execute on function public.admin_cleanup_old_data(integer, text) to authenticated;
