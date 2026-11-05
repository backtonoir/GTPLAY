-- ==================================================
-- GTPLAY v13 — AKUN PEMBELI (LOGIN DENGAN DISCORD)
-- --------------------------------------------------
-- Pembeli bisa login dengan Discord (Supabase Auth).
-- Pesanan yang dibuat saat login, atau pesanan lama yang
-- tersimpan di perangkat, ditautkan ke akun sehingga bisa
-- dibuka dari halaman Akun tanpa kode akses.
--
-- Keamanan:
--   • Pemilik akun hanya bisa membuka pesanan yang
--     user_id-nya = akun dia (auth.uid()).
--   • Menautkan pesanan tetap butuh Order ID + kode akses
--     yang benar, dan pesanan milik akun lain tidak bisa
--     diambil alih.
--   • Akun pembeli tidak punya hak admin apa pun (semua
--     aturan tulis tetap memakai is_admin()).
--
-- Setelah menjalankan file ini, aktifkan provider Discord
-- di Supabase → Authentication → Sign In / Providers.
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

alter table public.orders add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc) where user_id is not null;

-- Pesanan milik pembeli: kode akses cocok ATAU pesanan
-- tertaut ke akun yang sedang login.
create or replace function public.gt_owned_order(p_order_id text, p_access_code text)
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  select * into v_order
  from public.orders
  where id = upper(btrim(coalesce(p_order_id, '')))
  for update;

  if not found then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;

  if v_order.access_code_hash = public.gt_hash_code(p_access_code) then
    return v_order;
  end if;
  if auth.uid() is not null and v_order.user_id = auth.uid() then
    return v_order;
  end if;

  raise exception 'GT:ORDER_NOT_FOUND';
end $$;

-- Tautkan pesanan ke akun yang sedang login.
create or replace function public.link_order(p_order_id text, p_access_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'GT:NOT_SIGNED_IN';
  end if;

  select * into v_order
  from public.orders
  where id = upper(btrim(coalesce(p_order_id, '')))
  for update;

  if not found or v_order.access_code_hash <> public.gt_hash_code(p_access_code) then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;
  if v_order.user_id is not null and v_order.user_id <> auth.uid() then
    raise exception 'GT:ORDER_LINKED';
  end if;

  update public.orders set user_id = auth.uid() where id = v_order.id and user_id is null;
  return true;
end $$;

-- Daftar pesanan akun yang sedang login (terbaru dulu).
create or replace function public.my_orders(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'GT:NOT_SIGNED_IN';
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.created_at desc)
    from (
      select o.created_at, jsonb_build_object(
        'id', o.id,
        'growId', o.grow_id,
        'status', o.status,
        'total', o.total,
        'discount', o.discount,
        'couponCode', o.coupon_code,
        'createdAt', o.created_at,
        'expiresAt', o.expires_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity) order by i.id)
          from public.order_items i where i.order_id = o.id
        ), '[]'::jsonb)
      ) as j
      from public.orders o
      where o.user_id = auth.uid()
      order by o.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.link_order(text, text)  from public, anon;
revoke all on function public.my_orders(integer)      from public, anon;
grant execute on function public.link_order(text, text) to authenticated;
grant execute on function public.my_orders(integer)     to authenticated;
