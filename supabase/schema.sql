-- ==================================================
-- GTPLAY STORE — SUPABASE SCHEMA
-- --------------------------------------------------
-- Jalankan sekali di Supabase Dashboard → SQL Editor.
-- Lalu jalankan supabase/seed.sql untuk produk awal.
--
-- Prinsip:
--   • Frontend TIDAK dipercaya. Harga, stok, total,
--     Order ID, kode akses, kedaluwarsa, dan status
--     semuanya ditentukan di sini.
--   • Pembeli hanya bisa membaca pesanan lewat RPC
--     dengan Order ID + kode akses (disimpan sebagai hash).
--   • Admin = user Supabase Auth yang terdaftar di tabel
--     public.admins. Semua aksi admin dicek ulang di server.
-- ==================================================

create extension if not exists pgcrypto with schema extensions;

-- --------------------------------------------------
-- TYPES
-- --------------------------------------------------

do $$
begin
  create type public.order_status as enum (
    'pending_payment',
    'payment_submitted',
    'payment_verified',
    'processing',
    'completed',
    'expired',
    'cancelled',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

-- --------------------------------------------------
-- TABLES
-- --------------------------------------------------

create table if not exists public.products (
  id          text primary key default ('item-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  name        text not null check (length(btrim(name)) between 1 and 60),
  category    text not null check (length(btrim(category)) between 1 and 40),
  description text not null default '' check (length(description) <= 300),
  price       integer not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  active      boolean not null default true,
  image_url   text check (image_url is null or length(image_url) <= 500),
  fallback    text check (fallback is null or length(fallback) <= 10),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists products_active_sort_idx on public.products (active, sort_order);

create table if not exists public.orders (
  id                 text primary key check (id ~ '^GTPLAY-[0-9]{8}-[A-Z0-9]{6}$'),
  access_code_hash   text not null,
  grow_id            text not null check (grow_id ~ '^[A-Za-z0-9_]{3,24}$'),
  status             public.order_status not null default 'pending_payment',
  total              bigint not null default 0 check (total >= 0),
  expires_at         timestamptz not null,
  proof_path         text,
  proof_submitted_at timestamptz,
  admin_note         text check (admin_note is null or length(admin_note) <= 500),
  redeem_code        text check (redeem_code is null or length(redeem_code) <= 2000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Upgrade untuk database yang dibuat sebelum fitur redeem code.
alter table public.orders add column if not exists redeem_code text
  check (redeem_code is null or length(redeem_code) <= 2000);

create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_pending_growid_idx on public.orders (lower(grow_id)) where status = 'pending_payment';
create index if not exists orders_pending_expiry_idx on public.orders (expires_at) where status = 'pending_payment';

create table if not exists public.order_items (
  id           bigint generated always as identity primary key,
  order_id     text not null references public.orders (id) on delete cascade,
  product_id   text references public.products (id) on delete set null,
  product_name text not null,
  unit_price   integer not null check (unit_price >= 0),
  quantity     integer not null check (quantity between 1 and 100000),
  subtotal     bigint generated always as (unit_price::bigint * quantity) stored
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   text not null references public.orders (id) on delete cascade,
  status     public.order_status not null,
  note       text,
  actor      text not null check (actor in ('customer', 'admin', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- updated_at otomatis untuk products
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------
-- ROW LEVEL SECURITY
-- --------------------------------------------------

alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.order_events enable row level security;
alter table public.admins       enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "products: public reads active" on public.products;
create policy "products: public reads active" on public.products
  for select to anon, authenticated
  using (active or public.is_admin());

drop policy if exists "products: admin inserts" on public.products;
create policy "products: admin inserts" on public.products
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "products: admin updates" on public.products;
create policy "products: admin updates" on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "products: admin deletes" on public.products;
create policy "products: admin deletes" on public.products
  for delete to authenticated
  using (public.is_admin());

-- Pesanan: tidak ada akses tabel langsung untuk pembeli.
-- Admin boleh membaca (mis. untuk laporan di SQL/Studio);
-- semua perubahan lewat RPC di bawah.
drop policy if exists "orders: admin reads" on public.orders;
create policy "orders: admin reads" on public.orders
  for select to authenticated using (public.is_admin());

drop policy if exists "order_items: admin reads" on public.order_items;
create policy "order_items: admin reads" on public.order_items
  for select to authenticated using (public.is_admin());

drop policy if exists "order_events: admin reads" on public.order_events;
create policy "order_events: admin reads" on public.order_events
  for select to authenticated using (public.is_admin());

-- public.admins: tanpa policy = tidak bisa dibaca/diubah dari API.

-- --------------------------------------------------
-- HELPERS (internal)
-- --------------------------------------------------

-- Kode acak dari crypto (pgcrypto). Alfabet 32 karakter tanpa
-- huruf/angka yang mirip (0/O, 1/I) → 256 habis dibagi 32,
-- jadi tidak ada bias modulo.
create or replace function public.gt_random_code(p_length integer)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_length);
  v_out text := '';
  i integer;
begin
  for i in 0 .. p_length - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end $$;

create or replace function public.gt_hash_code(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
$$;

-- Bentuk JSON pesanan (camelCase, sama dengan adapter demo di js/api.js).
create or replace function public.gt_order_json(p_order_id text, p_include_private boolean)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', o.id,
    'growId', o.grow_id,
    'status', o.status,
    'total', o.total,
    'createdAt', o.created_at,
    'updatedAt', o.updated_at,
    'expiresAt', o.expires_at,
    'proofSubmittedAt', o.proof_submitted_at,
    'adminNote', case when p_include_private or o.status = 'rejected' then coalesce(o.admin_note, '') else '' end,
    'proofPath', case when p_include_private then o.proof_path else null end,
    -- Pembeli baru bisa melihat redeem code setelah pesanan Completed.
    'redeemCode', case when p_include_private or o.status = 'completed' then o.redeem_code else null end,
    'serverNow', now(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', i.product_id,
        'name', i.product_name,
        'unitPrice', i.unit_price,
        'quantity', i.quantity,
        'subtotal', i.subtotal
      ) order by i.id)
      from public.order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', e.status,
        'note', coalesce(e.note, ''),
        'actor', e.actor,
        'at', e.created_at
      ) order by e.created_at, e.id)
      from public.order_events e
      where e.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- Tambah/kurangi stok untuk semua item pesanan.
-- p_direction = +1 (lepas reservasi) atau -1 (reservasi).
-- Baris produk dikunci berurutan (order by id) agar tidak deadlock.
create or replace function public.gt_adjust_stock(p_order_id text, p_direction integer)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select i.product_id, sum(i.quantity)::integer as qty
    from public.order_items i
    where i.order_id = p_order_id and i.product_id is not null
    group by i.product_id
    order by i.product_id
  loop
    perform 1 from public.products where id = r.product_id for update;

    if p_direction < 0 then
      update public.products
        set stock = stock - r.qty
        where id = r.product_id and stock >= r.qty;
      if not found then
        raise exception 'GT:OUT_OF_STOCK' using detail = r.product_id;
      end if;
    else
      update public.products set stock = stock + r.qty where id = r.product_id;
    end if;
  end loop;
end $$;

-- Ubah pesanan pending yang sudah lewat waktu → expired dan
-- kembalikan stoknya. Dipanggil di awal setiap RPC
-- ("lazy expiry") dan opsional lewat pg_cron tiap menit.
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select id from public.orders
    where status = 'pending_payment' and expires_at <= now()
    order by id
    for update skip locked
  loop
    update public.orders set status = 'expired', updated_at = now() where id = r.id;
    perform public.gt_adjust_stock(r.id, 1);
    insert into public.order_events (order_id, status, note, actor)
      values (r.id, 'expired', 'Payment window ended.', 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Ambil & kunci pesanan milik pembeli (Order ID + kode akses).
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

  if not found or v_order.access_code_hash <> public.gt_hash_code(p_access_code) then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;

  return v_order;
end $$;

-- --------------------------------------------------
-- STORE SETTINGS (maintenance mode)
-- --------------------------------------------------
-- Satu baris saja (id selalu true). Diubah lewat tombol
-- Maintenance di Admin Dashboard.

create table if not exists public.store_settings (
  id                  boolean primary key default true check (id),
  maintenance         boolean not null default false,
  maintenance_message text check (maintenance_message is null or length(maintenance_message) <= 500),
  maintenance_eta     text check (maintenance_eta is null or length(maintenance_eta) <= 60),
  updated_at          timestamptz not null default now()
);

insert into public.store_settings (id) values (true) on conflict (id) do nothing;

-- Link download client (diisi dari Admin → Downloads).
alter table public.store_settings add column if not exists download_windows text check (download_windows is null or download_windows ~ '^https://');
alter table public.store_settings add column if not exists download_android text check (download_android is null or download_android ~ '^https://');
alter table public.store_settings add column if not exists download_ios     text check (download_ios is null or download_ios ~ '^https://');
alter table public.store_settings add column if not exists download_mac     text check (download_mac is null or download_mac ~ '^https://');

alter table public.store_settings enable row level security;
-- Tanpa policy: dibaca/diubah hanya lewat RPC di bawah.

create or replace function public.get_store_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'maintenance', coalesce(s.maintenance, false),
    'message', coalesce(s.maintenance_message, ''),
    'eta', coalesce(s.maintenance_eta, ''),
    'updatedAt', s.updated_at,
    'downloads', jsonb_build_object(
      'windows', coalesce(s.download_windows, ''),
      'android', coalesce(s.download_android, ''),
      'ios', coalesce(s.download_ios, ''),
      'mac', coalesce(s.download_mac, '')
    )
  )
  from public.store_settings s
  where s.id;
$$;

-- --------------------------------------------------
-- LANDING PAGE CONTENT
-- --------------------------------------------------

-- Pengumuman (dikelola dari Admin → Announcements).
create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'update' check (category in ('event', 'update', 'maintenance')),
  title        text not null check (length(btrim(title)) between 1 and 120),
  content      text not null check (length(content) between 1 and 2000),
  published_on date not null default (now() at time zone 'Asia/Jakarta')::date,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists announcements_published_idx on public.announcements (published, published_on desc);

drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch
  before update on public.announcements
  for each row execute function public.touch_updated_at();

alter table public.announcements enable row level security;

drop policy if exists "announcements: public reads published" on public.announcements;
create policy "announcements: public reads published" on public.announcements
  for select to anon, authenticated
  using (published or public.is_admin());

drop policy if exists "announcements: admin writes" on public.announcements;
create policy "announcements: admin writes" on public.announcements
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Pengumuman awal (dari announcement.js lama) — hanya jika tabel masih kosong.
insert into public.announcements (category, title, content, published_on)
select v.category, v.title, v.content, v.published_on
from (values
  ('event', 'Double Drop Rate Weekend!', 'Semua drop rate di server GTPLAY naik 2x lipat selama akhir pekan ini. Jangan lewatkan kesempatan farming item langka!', date '2026-11-01'),
  ('update', 'Restock Magplant Tersedia', 'Stok Magplant 5K sampai 100K sudah tersedia kembali di Store. Pembayaran via QRIS, pesanan diproses setelah admin memverifikasi bukti pembayaran.', date '2026-10-28'),
  ('maintenance', 'Jadwal Maintenance Mingguan', 'Server akan maintenance setiap Senin pukul 02.00–04.00 WIB untuk optimasi performa. Mohon tidak melakukan transaksi selama jam tersebut.', date '2026-10-25'),
  ('update', 'Perbaikan Sistem Checkout', 'Sistem checkout & konfirmasi pembayaran QRIS sudah diperbarui agar lebih stabil. Laporkan ke Admin via WhatsApp jika masih menemukan kendala.', date '2026-10-20')
) as v(category, title, content, published_on)
where not exists (select 1 from public.announcements);

-- Riwayat harga Blue Gem Lock dalam Rupiah (satu harga per tanggal).
create table if not exists public.lock_prices (
  recorded_on date primary key,
  price       integer not null check (price > 0),
  created_at  timestamptz not null default now()
);

alter table public.lock_prices enable row level security;

drop policy if exists "lock_prices: public reads" on public.lock_prices;
create policy "lock_prices: public reads" on public.lock_prices
  for select to anon, authenticated
  using (true);

drop policy if exists "lock_prices: admin writes" on public.lock_prices;
create policy "lock_prices: admin writes" on public.lock_prices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --------------------------------------------------
-- SERVER STATS (dikirim oleh script Lua di server game)
-- --------------------------------------------------
-- Script Lua memanggil report_server_stats setiap ±60 detik
-- dengan token rahasia. Token dibuat dari Admin → Server
-- dan hanya hash-nya yang disimpan.

create table if not exists public.server_stats (
  id             boolean primary key default true check (id),
  players_online integer not null default 0 check (players_online between 0 and 100000),
  active_worlds  integer not null default 0 check (active_worlds between 0 and 1000000),
  peak_players   integer not null default 0 check (peak_players >= 0),
  reported_at    timestamptz,
  token_hash     text
);

insert into public.server_stats (id) values (true) on conflict (id) do nothing;

-- Jumlah world boleh kosong (tidak semua engine punya fungsi world list).
alter table public.server_stats alter column active_worlds drop not null;
alter table public.server_stats alter column active_worlds drop default;

alter table public.server_stats enable row level security;
-- Tanpa policy: hanya lewat RPC.

create or replace function public.get_server_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'configured', s.token_hash is not null,
    'online', s.reported_at is not null and s.reported_at > now() - interval '3 minutes',
    'players', s.players_online,
    'worlds', s.active_worlds,
    'peak', s.peak_players,
    'reportedAt', s.reported_at
  )
  from public.server_stats s
  where s.id;
$$;

-- Dipanggil oleh script Lua server (role anon + token rahasia).
drop function if exists public.report_server_stats(text, integer, integer);
create or replace function public.report_server_stats(p_token text, p_players integer, p_worlds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  select token_hash into v_hash from public.server_stats where id;

  if v_hash is null or p_token is null or public.gt_hash_code(p_token) <> v_hash then
    raise exception 'GT:BAD_TOKEN';
  end if;

  if p_players is null or p_players < 0 or p_players > 100000
     or (p_worlds is not null and (p_worlds < 0 or p_worlds > 1000000)) then
    raise exception 'GT:BAD_STATS';
  end if;

  update public.server_stats
    set players_online = p_players,
        active_worlds = p_worlds,
        peak_players = greatest(peak_players, p_players),
        reported_at = now()
    where id;

  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------
-- CUSTOMER RPCs
-- --------------------------------------------------

create or replace function public.create_order(p_grow_id text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_window   constant interval := interval '5 minutes';   -- durasi sesi pembayaran
  c_max_lines constant integer := 20;
  c_max_pending constant integer := 3;

  v_grow_id  text := btrim(coalesce(p_grow_id, ''));
  v_order_id text;
  v_code     text;
  v_total    bigint := 0;
  v_expires  timestamptz := now() + c_window;
  v_line     record;
  v_product  public.products;
  v_tries    integer := 0;
begin
  perform public.expire_stale_orders();

  -- Saat maintenance, pesanan baru ditolak (pesanan lama tetap bisa dibayar).
  if exists (select 1 from public.store_settings where id and maintenance) then
    raise exception 'GT:MAINTENANCE';
  end if;

  if v_grow_id !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'GT:INVALID_GROWID';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'GT:EMPTY_CART';
  end if;

  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'GT:TOO_MANY_ITEMS';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e ->> 'product_id', '') = ''
       or coalesce(e ->> 'quantity', '') !~ '^[0-9]{1,5}$'
       or (e ->> 'quantity')::integer < 1
  ) then
    raise exception 'GT:INVALID_QTY';
  end if;

  if (select count(*) from public.orders
      where lower(grow_id) = lower(v_grow_id) and status = 'pending_payment') >= c_max_pending then
    raise exception 'GT:TOO_MANY_PENDING';
  end if;

  -- Order ID unik: GTPLAY-YYYYMMDD-XXXXXX (tanggal WIB).
  loop
    v_tries := v_tries + 1;
    v_order_id := 'GTPLAY-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD') || '-' || public.gt_random_code(6);
    v_code := public.gt_random_code(8);

    begin
      insert into public.orders (id, access_code_hash, grow_id, status, total, expires_at)
      values (v_order_id, public.gt_hash_code(v_code), v_grow_id, 'pending_payment', 0, v_expires);
      exit;
    exception when unique_violation then
      if v_tries >= 5 then raise; end if;
    end;
  end loop;

  -- Harga & stok dibaca dari database (bukan dari browser).
  for v_line in
    select e ->> 'product_id' as product_id, sum((e ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(p_items) e
    group by e ->> 'product_id'
    order by e ->> 'product_id'
  loop
    select * into v_product from public.products where id = v_line.product_id for update;

    if not found or not v_product.active then
      raise exception 'GT:PRODUCT_UNAVAILABLE' using detail = v_line.product_id;
    end if;

    if v_product.stock < v_line.qty then
      raise exception 'GT:OUT_OF_STOCK' using detail = v_line.product_id;
    end if;

    update public.products set stock = stock - v_line.qty where id = v_product.id;

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    values (v_order_id, v_product.id, v_product.name, v_product.price, v_line.qty);

    v_total := v_total + v_product.price::bigint * v_line.qty;
  end loop;

  update public.orders set total = v_total where id = v_order_id;

  insert into public.order_events (order_id, status, note, actor)
  values (v_order_id, 'pending_payment', 'Order created.', 'customer');

  return jsonb_build_object('orderId', v_order_id, 'accessCode', v_code, 'expiresAt', v_expires);
end $$;

create or replace function public.get_order(p_order_id text, p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  perform public.expire_stale_orders();
  v_order := public.gt_owned_order(p_order_id, p_access_code);
  return public.gt_order_json(v_order.id, false);
end $$;

create or replace function public.submit_payment(p_order_id text, p_access_code text, p_proof_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  perform public.expire_stale_orders();
  v_order := public.gt_owned_order(p_order_id, p_access_code);

  if v_order.status = 'expired' or (v_order.status = 'pending_payment' and v_order.expires_at <= now()) then
    raise exception 'GT:ORDER_EXPIRED';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'GT:INVALID_STATUS';
  end if;

  if p_proof_path is null
     or split_part(p_proof_path, '/', 1) <> v_order.id
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'payment-proofs' and name = p_proof_path
     ) then
    raise exception 'GT:PROOF_REQUIRED';
  end if;

  update public.orders
    set status = 'payment_submitted',
        proof_path = p_proof_path,
        proof_submitted_at = now(),
        updated_at = now()
    where id = v_order.id;

  insert into public.order_events (order_id, status, note, actor)
  values (v_order.id, 'payment_submitted', 'Payment proof submitted.', 'customer');

  return public.gt_order_json(v_order.id, false);
end $$;

create or replace function public.cancel_order(p_order_id text, p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  perform public.expire_stale_orders();
  v_order := public.gt_owned_order(p_order_id, p_access_code);

  if v_order.status <> 'pending_payment' then
    raise exception 'GT:INVALID_STATUS';
  end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  perform public.gt_adjust_stock(v_order.id, 1);

  insert into public.order_events (order_id, status, note, actor)
  values (v_order.id, 'cancelled', 'Cancelled by customer.', 'customer');

  return public.gt_order_json(v_order.id, false);
end $$;

-- Dipakai policy storage: upload bukti hanya ke folder pesanan
-- yang masih pending & belum lewat waktu, maksimal 5 file.
create or replace function public.can_upload_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_name ~ '^GTPLAY-[0-9]{8}-[A-Z0-9]{6}/[0-9]{10,16}-[A-Z0-9]{6}\.(png|jpg|webp)$'
    and exists (
      select 1 from public.orders o
      where o.id = split_part(p_name, '/', 1)
        and o.status = 'pending_payment'
        and o.expires_at > now()
    )
    and (
      select count(*) from storage.objects s
      where s.bucket_id = 'payment-proofs'
        and s.name like split_part(p_name, '/', 1) || '/%'
    ) < 5;
$$;

-- --------------------------------------------------
-- ADMIN RPCs
-- --------------------------------------------------

create or replace function public.gt_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'GT:NOT_ADMIN';
  end if;
end $$;

create or replace function public.admin_list_orders(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  perform public.expire_stale_orders();

  return coalesce((
    select jsonb_agg(public.gt_order_json(o.id, true) order by o.created_at desc)
    from (
      select id, created_at from public.orders
      order by created_at desc
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) o
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_get_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_json jsonb;
begin
  perform public.gt_require_admin();
  perform public.expire_stale_orders();

  v_json := public.gt_order_json(p_order_id, true);
  if v_json is null then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;
  return v_json;
end $$;

-- Transisi yang diizinkan (sama dengan ADMIN_TRANSITIONS di js/api.js).
-- Versi lama (3 parameter) dihapus agar tidak ada dua versi fungsi.
drop function if exists public.admin_update_order_status(text, text, text);

create or replace function public.admin_update_order_status(
  p_order_id text,
  p_status text,
  p_note text default null,
  p_redeem_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_next public.order_status;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_redeem text := nullif(btrim(coalesce(p_redeem_code, '')), '');
  v_released public.order_status[] := array['expired', 'cancelled', 'rejected']::public.order_status[];
  v_allowed boolean;
begin
  perform public.gt_require_admin();
  perform public.expire_stale_orders();

  begin
    v_next := p_status::public.order_status;
  exception when invalid_text_representation then
    raise exception 'GT:INVALID_TRANSITION';
  end;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;

  v_allowed := case v_order.status
    when 'pending_payment'   then v_next in ('payment_verified', 'rejected', 'cancelled')
    when 'payment_submitted' then v_next in ('payment_verified', 'rejected', 'cancelled')
    when 'payment_verified'  then v_next in ('processing', 'completed', 'cancelled')
    when 'processing'        then v_next in ('completed', 'cancelled')
    when 'expired'           then v_next in ('payment_verified')
    else false
  end;

  if not v_allowed then
    raise exception 'GT:INVALID_TRANSITION';
  end if;

  if v_next = 'rejected' and v_note is null then
    raise exception 'GT:INVALID_TRANSITION' using detail = 'A reason is required to reject a payment.';
  end if;

  -- Pesanan dikirim dalam bentuk redeem code → wajib ada saat Completed.
  if v_next = 'completed' and coalesce(v_redeem, v_order.redeem_code) is null then
    raise exception 'GT:REDEEM_REQUIRED';
  end if;

  -- Stok: lepas saat masuk status "released", reservasi ulang saat keluar darinya.
  if v_order.status = any (v_released) and not (v_next = any (v_released)) then
    perform public.gt_adjust_stock(v_order.id, -1);
  elsif not (v_order.status = any (v_released)) and v_next = any (v_released) then
    perform public.gt_adjust_stock(v_order.id, 1);
  end if;

  update public.orders
    set status = v_next,
        admin_note = coalesce(v_note, admin_note),
        redeem_code = coalesce(v_redeem, redeem_code),
        updated_at = now()
    where id = v_order.id;

  insert into public.order_events (order_id, status, note, actor)
  values (v_order.id, v_next, v_note, 'admin');

  return public.gt_order_json(v_order.id, true);
end $$;

-- Simpan / perbaiki redeem code tanpa mengubah status
-- (mis. salah ketik setelah Completed).
create or replace function public.admin_set_redeem_code(p_order_id text, p_redeem_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_redeem text := nullif(btrim(coalesce(p_redeem_code, '')), '');
begin
  perform public.gt_require_admin();

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'GT:ORDER_NOT_FOUND';
  end if;

  if v_order.status not in ('payment_verified', 'processing', 'completed') then
    raise exception 'GT:INVALID_STATUS';
  end if;

  if v_redeem is null and v_order.status = 'completed' then
    raise exception 'GT:REDEEM_REQUIRED';
  end if;

  update public.orders set redeem_code = v_redeem, updated_at = now() where id = v_order.id;

  return public.gt_order_json(v_order.id, true);
end $$;

-- Tombol Maintenance di Admin Dashboard.
create or replace function public.admin_set_maintenance(p_on boolean, p_message text default null, p_eta text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  insert into public.store_settings (id) values (true) on conflict (id) do nothing;

  update public.store_settings
    set maintenance = coalesce(p_on, false),
        maintenance_message = nullif(btrim(coalesce(p_message, '')), ''),
        maintenance_eta = nullif(btrim(coalesce(p_eta, '')), ''),
        updated_at = now()
    where id;

  return public.get_store_status();
end $$;

-- Link download dari Admin → Downloads (kosong = "Coming soon").
create or replace function public.admin_set_downloads(p_windows text, p_android text, p_ios text, p_mac text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_links text[] := array[p_windows, p_android, p_ios, p_mac];
  v_link text;
begin
  perform public.gt_require_admin();

  foreach v_link in array v_links loop
    if nullif(btrim(coalesce(v_link, '')), '') is not null and btrim(v_link) !~ '^https://' then
      raise exception 'GT:INVALID_LINK';
    end if;
  end loop;

  insert into public.store_settings (id) values (true) on conflict (id) do nothing;

  update public.store_settings
    set download_windows = nullif(btrim(coalesce(p_windows, '')), ''),
        download_android = nullif(btrim(coalesce(p_android, '')), ''),
        download_ios     = nullif(btrim(coalesce(p_ios, '')), ''),
        download_mac     = nullif(btrim(coalesce(p_mac, '')), ''),
        updated_at = now()
    where id;

  return public.get_store_status();
end $$;

-- Admin → Server: buat token baru (token lama langsung tidak berlaku).
-- Token asli hanya dikembalikan sekali; database menyimpan hash-nya.
create or replace function public.admin_rotate_stats_token()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := 'gts_' || public.gt_random_code(32);
begin
  perform public.gt_require_admin();
  insert into public.server_stats (id) values (true) on conflict (id) do nothing;
  update public.server_stats set token_hash = public.gt_hash_code(v_token) where id;
  return v_token;
end $$;

-- Admin → Server: reset rekor peak player.
create or replace function public.admin_reset_peak()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  update public.server_stats set peak_players = players_online where id;
  return public.get_server_stats();
end $$;

-- --------------------------------------------------
-- FUNCTION PRIVILEGES
-- --------------------------------------------------

revoke all on function public.gt_random_code(integer)                 from public, anon, authenticated;
revoke all on function public.gt_hash_code(text)                      from public, anon, authenticated;
revoke all on function public.gt_order_json(text, boolean)            from public, anon, authenticated;
revoke all on function public.gt_adjust_stock(text, integer)          from public, anon, authenticated;
revoke all on function public.gt_owned_order(text, text)              from public, anon, authenticated;
revoke all on function public.expire_stale_orders()                   from public, anon, authenticated;
revoke all on function public.gt_require_admin()                      from public, anon, authenticated;

revoke all on function public.create_order(text, jsonb)               from public;
revoke all on function public.get_order(text, text)                   from public;
revoke all on function public.submit_payment(text, text, text)        from public;
revoke all on function public.cancel_order(text, text)                from public;
revoke all on function public.can_upload_proof(text)                  from public;
revoke all on function public.is_admin()                              from public;
revoke all on function public.admin_list_orders(integer)              from public, anon;
revoke all on function public.admin_get_order(text)                   from public, anon;
revoke all on function public.admin_update_order_status(text, text, text, text) from public, anon;
revoke all on function public.admin_set_redeem_code(text, text)       from public, anon;

grant execute on function public.create_order(text, jsonb)            to anon, authenticated;
grant execute on function public.get_order(text, text)                to anon, authenticated;
grant execute on function public.submit_payment(text, text, text)     to anon, authenticated;
grant execute on function public.cancel_order(text, text)             to anon, authenticated;
grant execute on function public.can_upload_proof(text)               to anon, authenticated;
grant execute on function public.is_admin()                           to anon, authenticated;
grant execute on function public.admin_list_orders(integer)           to authenticated;
grant execute on function public.admin_get_order(text)                to authenticated;
grant execute on function public.admin_update_order_status(text, text, text, text) to authenticated;
grant execute on function public.admin_set_redeem_code(text, text)    to authenticated;

revoke all on function public.get_store_status()                      from public;
revoke all on function public.admin_set_maintenance(boolean, text, text) from public, anon;
grant execute on function public.get_store_status()                   to anon, authenticated;
grant execute on function public.admin_set_maintenance(boolean, text, text) to authenticated;
revoke all on function public.admin_set_downloads(text, text, text, text) from public, anon;
grant execute on function public.admin_set_downloads(text, text, text, text) to authenticated;

revoke all on function public.get_server_stats()                      from public;
revoke all on function public.report_server_stats(text, integer, integer) from public;
revoke all on function public.admin_rotate_stats_token()              from public, anon;
revoke all on function public.admin_reset_peak()                      from public, anon;
grant execute on function public.get_server_stats()                   to anon, authenticated;
grant execute on function public.report_server_stats(text, integer, integer) to anon, authenticated;
grant execute on function public.admin_rotate_stats_token()           to authenticated;
grant execute on function public.admin_reset_peak()                   to authenticated;

-- --------------------------------------------------
-- STORAGE
-- --------------------------------------------------
-- payment-proofs : PRIVATE (hanya admin yang bisa melihat)
-- product-images : PUBLIC read, hanya admin yang upload

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('product-images', 'product-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "gtplay proofs: customer upload" on storage.objects;
create policy "gtplay proofs: customer upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and public.can_upload_proof(name));

drop policy if exists "gtplay proofs: admin read" on storage.objects;
create policy "gtplay proofs: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

drop policy if exists "gtplay product images: admin insert" on storage.objects;
create policy "gtplay product images: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "gtplay product images: admin update" on storage.objects;
create policy "gtplay product images: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "gtplay product images: admin delete" on storage.objects;
create policy "gtplay product images: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- --------------------------------------------------
-- OPTIONAL: kedaluwarsa otomatis tiap menit (pg_cron)
-- --------------------------------------------------
-- Tanpa ini, pesanan tetap ditandai expired saat ada RPC
-- berikutnya (lazy expiry). Aktifkan extension pg_cron di
-- Dashboard → Database → Extensions, lalu jalankan:
--
--   select cron.schedule('gtplay-expire-orders', '* * * * *',
--     $$select public.expire_stale_orders()$$);
