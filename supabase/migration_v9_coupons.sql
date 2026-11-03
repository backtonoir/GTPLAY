-- ==================================================
-- GTPLAY v9 — KODE KUPON
-- --------------------------------------------------
-- Pembeli memasukkan kode kupon di halaman pembayaran
-- (hanya saat status "menunggu pembayaran"). Admin
-- mengatur kupon di Admin → Coupons.
--
-- Jenis kupon:
--   percent : potong X% (1–90), bisa diberi max_discount
--   fixed   : potong Rp X
-- Aturan: minimal belanja, kuota total, batas per GrowID,
-- tanggal mulai/berakhir, aktif/nonaktif.
--
-- Semua perhitungan di server. Kuota dihitung dari pesanan
-- yang memakai kupon dan TIDAK expired/cancelled/rejected,
-- jadi kuota otomatis kembali bila pesanan batal.
-- Maks 10 kode salah per pesanan (anti tebak kode).
--
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

create table if not exists public.coupons (
  code          text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind          text not null check (kind in ('percent', 'fixed')),
  value         integer not null check (value > 0),
  min_total     bigint not null default 0 check (min_total >= 0),
  max_discount  bigint check (max_discount is null or max_discount > 0),
  max_uses      integer check (max_uses is null or max_uses > 0),
  per_grow_id   integer check (per_grow_id is null or per_grow_id > 0),
  starts_at     timestamptz,
  ends_at       timestamptz,
  active        boolean not null default true,
  note          text not null default '' check (length(note) <= 120),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

alter table public.coupons enable row level security;
-- coupons: tanpa policy → hanya lewat RPC.

alter table public.orders add column if not exists subtotal        bigint check (subtotal is null or subtotal >= 0);
alter table public.orders add column if not exists discount        bigint not null default 0 check (discount >= 0);
alter table public.orders add column if not exists coupon_code     text;
alter table public.orders add column if not exists coupon_attempts integer not null default 0;

create index if not exists orders_coupon_idx on public.orders (coupon_code) where coupon_code is not null;

-- --------------------------------------------------
-- Data pesanan (ditambah subtotal, diskon, kupon)
-- --------------------------------------------------
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
    'subtotal', coalesce(o.subtotal, o.total),
    'discount', o.discount,
    'couponCode', o.coupon_code,
    'createdAt', o.created_at,
    'updatedAt', o.updated_at,
    'expiresAt', o.expires_at,
    'proofSubmittedAt', o.proof_submitted_at,
    'paymentMethod', o.payment_method,
    'adminNote', case when p_include_private or o.status = 'rejected' then coalesce(o.admin_note, '') else '' end,
    'proofPath', case when p_include_private then o.proof_path else null end,
    -- Pembeli baru bisa melihat redeem code setelah pesanan Completed.
    'redeemCode', case when p_include_private or o.status = 'completed' then o.redeem_code else null end,
    'serverNow', now(),
    'review', (
      select jsonb_build_object('rating', r.rating, 'comment', r.comment, 'status', r.status, 'createdAt', r.created_at)
      from public.reviews r where r.order_id = o.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', i.product_id,
        'name', i.product_name,
        'unitPrice', i.unit_price,
        'listPrice', i.list_price,
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

-- Pemakaian kupon yang masih "hidup" (tidak dibatalkan/kedaluwarsa).
create or replace function public.gt_coupon_used(p_code text, p_grow_id text, p_exclude_order text)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.orders
  where coupon_code = p_code
    and status not in ('expired', 'cancelled', 'rejected')
    and (p_grow_id is null or lower(grow_id) = lower(p_grow_id))
    and (p_exclude_order is null or id <> p_exclude_order);
$$;

create or replace function public.gt_rupiah(p_amount bigint)
returns text
language sql
immutable
as $$
  select 'Rp' || replace(to_char(p_amount, 'FM999G999G999G990'), ',', '.');
$$;

-- --------------------------------------------------
-- PEMBELI: pasang / lepas kupon
-- --------------------------------------------------
create or replace function public.apply_coupon(p_order_id text, p_access_code text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order    public.orders;
  v_coupon   public.coupons;
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_subtotal bigint;
  v_discount bigint;
  v_error    text;
begin
  perform public.expire_stale_orders();
  v_order := public.gt_owned_order(p_order_id, p_access_code);

  if v_order.status <> 'pending_payment' or v_order.expires_at <= now() then
    raise exception 'GT:COUPON_NOT_ALLOWED';
  end if;
  if v_order.coupon_attempts >= 10 then
    raise exception 'GT:COUPON_TOO_MANY';
  end if;

  v_subtotal := coalesce(v_order.subtotal, v_order.total);

  select * into v_coupon from public.coupons where code = v_code for update;

  if not found or v_code !~ '^[A-Z0-9_-]{3,24}$' then
    v_error := 'GT:COUPON_NOT_FOUND';
  elsif not v_coupon.active then
    v_error := 'GT:COUPON_INACTIVE';
  elsif v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    v_error := 'GT:COUPON_NOT_STARTED';
  elsif v_coupon.ends_at is not null and now() >= v_coupon.ends_at then
    v_error := 'GT:COUPON_EXPIRED';
  elsif v_subtotal < v_coupon.min_total then
    raise exception 'GT:COUPON_MIN %', public.gt_rupiah(v_coupon.min_total);
  elsif v_coupon.max_uses is not null and public.gt_coupon_used(v_code, null, v_order.id) >= v_coupon.max_uses then
    v_error := 'GT:COUPON_USED_UP';
  elsif v_coupon.per_grow_id is not null and public.gt_coupon_used(v_code, v_order.grow_id, v_order.id) >= v_coupon.per_grow_id then
    v_error := 'GT:COUPON_LIMIT_USER';
  end if;

  if v_error is not null then
    -- Hitung percobaan gagal (tersimpan walau error dikembalikan).
    update public.orders set coupon_attempts = coupon_attempts + 1 where id = v_order.id;
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  if v_coupon.kind = 'percent' then
    v_discount := floor(v_subtotal * v_coupon.value / 100.0);
    if v_coupon.max_discount is not null then
      v_discount := least(v_discount, v_coupon.max_discount);
    end if;
  else
    v_discount := v_coupon.value;
  end if;
  -- Total minimal Rp1 (pesanan tetap perlu dibayar & diverifikasi).
  v_discount := greatest(0, least(v_discount, v_subtotal - 1));

  update public.orders
    set subtotal = v_subtotal,
        discount = v_discount,
        total = v_subtotal - v_discount,
        coupon_code = v_code,
        updated_at = now()
    where id = v_order.id;

  insert into public.order_events (order_id, status, note, actor)
    values (v_order.id, v_order.status,
            'Coupon ' || v_code || ' applied (-' || public.gt_rupiah(v_discount) || ').', 'customer');

  return jsonb_build_object('ok', true, 'order', public.gt_order_json(v_order.id, false));
end $$;

create or replace function public.remove_coupon(p_order_id text, p_access_code text)
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

  if v_order.status <> 'pending_payment' or v_order.expires_at <= now() then
    raise exception 'GT:COUPON_NOT_ALLOWED';
  end if;

  if v_order.coupon_code is not null then
    update public.orders
      set total = coalesce(subtotal, total),
          discount = 0,
          coupon_code = null,
          updated_at = now()
      where id = v_order.id;

    insert into public.order_events (order_id, status, note, actor)
      values (v_order.id, v_order.status, 'Coupon ' || v_order.coupon_code || ' removed.', 'customer');
  end if;

  return public.gt_order_json(v_order.id, false);
end $$;

-- --------------------------------------------------
-- ADMIN
-- --------------------------------------------------
create or replace function public.admin_list_coupons()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code,
      'kind', c.kind,
      'value', c.value,
      'minTotal', c.min_total,
      'maxDiscount', c.max_discount,
      'maxUses', c.max_uses,
      'perGrowId', c.per_grow_id,
      'startsAt', c.starts_at,
      'endsAt', c.ends_at,
      'active', c.active,
      'note', c.note,
      'used', public.gt_coupon_used(c.code, null, null),
      'paid', (select count(*) from public.orders o
               where o.coupon_code = c.code and o.status in ('payment_verified', 'processing', 'completed')),
      'discountGiven', (select coalesce(sum(o.discount), 0) from public.orders o
                        where o.coupon_code = c.code and o.status in ('payment_verified', 'processing', 'completed')),
      'createdAt', c.created_at
    ) order by c.active desc, c.created_at desc)
    from public.coupons c
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_upsert_coupon(p_coupon jsonb, p_original_code text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_coupon ->> 'code', '')));
  v_orig text := nullif(upper(btrim(coalesce(p_original_code, ''))), '');
  v_kind text := coalesce(p_coupon ->> 'kind', '');
  v_value integer;
  v_min bigint;
  v_max_disc bigint;
  v_max_uses integer;
  v_per integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_note text := btrim(regexp_replace(coalesce(p_coupon ->> 'note', ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  perform public.gt_require_admin();

  begin
    v_value    := (p_coupon ->> 'value')::integer;
    v_min      := coalesce(nullif(p_coupon ->> 'minTotal', '')::bigint, 0);
    v_max_disc := nullif(p_coupon ->> 'maxDiscount', '')::bigint;
    v_max_uses := nullif(p_coupon ->> 'maxUses', '')::integer;
    v_per      := nullif(p_coupon ->> 'perGrowId', '')::integer;
    v_starts   := nullif(p_coupon ->> 'startsAt', '')::timestamptz;
    v_ends     := nullif(p_coupon ->> 'endsAt', '')::timestamptz;
  exception when others then
    raise exception 'GT:INVALID_COUPON';
  end;

  if v_code !~ '^[A-Z0-9_-]{3,24}$' or v_kind not in ('percent', 'fixed')
     or v_value is null or v_value <= 0 or (v_kind = 'percent' and v_value > 90)
     or v_min < 0 or (v_max_disc is not null and v_max_disc <= 0)
     or (v_max_uses is not null and v_max_uses <= 0) or (v_per is not null and v_per <= 0)
     or (v_starts is not null and v_ends is not null and v_ends <= v_starts)
     or length(v_note) > 120 then
    raise exception 'GT:INVALID_COUPON';
  end if;

  if v_orig is not null and v_orig <> v_code then
    -- Ganti kode: hanya boleh bila kupon lama belum pernah dipakai.
    if exists (select 1 from public.orders where coupon_code = v_orig) then
      raise exception 'GT:COUPON_IN_USE';
    end if;
    if exists (select 1 from public.coupons where code = v_code) then
      raise exception 'GT:COUPON_EXISTS';
    end if;
    delete from public.coupons where code = v_orig;
  elsif v_orig is null and exists (select 1 from public.coupons where code = v_code) then
    raise exception 'GT:COUPON_EXISTS';
  end if;

  insert into public.coupons (code, kind, value, min_total, max_discount, max_uses, per_grow_id, starts_at, ends_at, active, note)
  values (v_code, v_kind, v_value, v_min, case when v_kind = 'percent' then v_max_disc end,
          v_max_uses, v_per, v_starts, v_ends, coalesce((p_coupon ->> 'active')::boolean, true), v_note)
  on conflict (code) do update set
    kind = excluded.kind,
    value = excluded.value,
    min_total = excluded.min_total,
    max_discount = excluded.max_discount,
    max_uses = excluded.max_uses,
    per_grow_id = excluded.per_grow_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    active = excluded.active,
    note = excluded.note,
    updated_at = now();
end $$;

create or replace function public.admin_set_coupon_active(p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  update public.coupons set active = coalesce(p_active, false), updated_at = now()
    where code = upper(btrim(coalesce(p_code, '')));
end $$;

-- Hapus kupon. Pesanan lama tetap menyimpan kode & diskonnya.
create or replace function public.admin_delete_coupon(p_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  delete from public.coupons where code = upper(btrim(coalesce(p_code, '')));
end $$;

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.gt_coupon_used(text, text, text)         from public, anon, authenticated;
revoke all on function public.gt_rupiah(bigint)                         from public, anon, authenticated;
revoke all on function public.apply_coupon(text, text, text)            from public;
revoke all on function public.remove_coupon(text, text)                 from public;
revoke all on function public.admin_list_coupons()                      from public, anon;
revoke all on function public.admin_upsert_coupon(jsonb, text)          from public, anon;
revoke all on function public.admin_set_coupon_active(text, boolean)    from public, anon;
revoke all on function public.admin_delete_coupon(text)                 from public, anon;

grant execute on function public.apply_coupon(text, text, text)         to anon, authenticated;
grant execute on function public.remove_coupon(text, text)              to anon, authenticated;
grant execute on function public.admin_list_coupons()                   to authenticated;
grant execute on function public.admin_upsert_coupon(jsonb, text)       to authenticated;
grant execute on function public.admin_set_coupon_active(text, boolean) to authenticated;
grant execute on function public.admin_delete_coupon(text)              to authenticated;
