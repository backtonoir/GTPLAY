-- ==================================================
-- GTPLAY v15 — KODE REFERRAL CONTENT CREATOR
-- --------------------------------------------------
-- Kupon bisa ditandai sebagai kode milik content creator
-- (YouTuber / TikToker). Admin melihat berapa pesanan dan
-- omzet yang masuk lewat kode itu, plus komisi creator.
--
--   • Link referral   : https://situsmu/?ref=KODE
--                       → kode otomatis terpasang di halaman
--                         pembayaran pembeli.
--   • Halaman creator : /creator?code=KODE#key=RAHASIA
--                       → creator bisa cek statistiknya
--                         sendiri tanpa akses admin. GrowID
--                         pembeli disamarkan.
--
-- Butuh migration_v9_coupons.sql.
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

alter table public.coupons add column if not exists creator text
  check (creator is null or length(btrim(creator)) between 1 and 40);
alter table public.coupons add column if not exists commission_pct integer not null default 0
  check (commission_pct between 0 and 50);
alter table public.coupons add column if not exists stats_key text;

-- Pesanan yang sudah dibayar (dihitung sebagai penjualan).
create or replace function public.gt_paid_status(p_status text)
returns boolean
language sql
immutable
as $$ select p_status in ('payment_verified', 'processing', 'completed') $$;

-- Kolom orders.status bertipe enum order_status.
create or replace function public.gt_paid_status(p_status public.order_status)
returns boolean
language sql
immutable
as $$ select p_status::text in ('payment_verified', 'processing', 'completed') $$;

-- --------------------------------------------------
-- Daftar kupon (+ data creator)
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
      'creator', c.creator,
      'commissionPct', c.commission_pct,
      'statsKey', c.stats_key,
      'used', public.gt_coupon_used(c.code, null, null),
      'paid', (select count(*) from public.orders o
               where o.coupon_code = c.code and public.gt_paid_status(o.status)),
      'discountGiven', (select coalesce(sum(o.discount), 0) from public.orders o
                        where o.coupon_code = c.code and public.gt_paid_status(o.status)),
      'revenue', (select coalesce(sum(o.total), 0) from public.orders o
                  where o.coupon_code = c.code and public.gt_paid_status(o.status)),
      'createdAt', c.created_at
    ) order by c.active desc, c.created_at desc)
    from public.coupons c
  ), '[]'::jsonb);
end $$;

-- --------------------------------------------------
-- Simpan kupon (+ creator & komisi)
-- --------------------------------------------------
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
  v_creator text := nullif(btrim(regexp_replace(coalesce(p_coupon ->> 'creator', ''), '[[:cntrl:]]+', ' ', 'g')), '');
  v_comm integer;
  v_key text;
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
    v_comm     := coalesce(nullif(p_coupon ->> 'commissionPct', '')::integer, 0);
  exception when others then
    raise exception 'GT:INVALID_COUPON';
  end;

  if v_creator is null then v_comm := 0; end if;

  if v_code !~ '^[A-Z0-9_-]{3,24}$' or v_kind not in ('percent', 'fixed')
     or v_value is null or v_value <= 0 or (v_kind = 'percent' and v_value > 90)
     or v_min < 0 or (v_max_disc is not null and v_max_disc <= 0)
     or (v_max_uses is not null and v_max_uses <= 0) or (v_per is not null and v_per <= 0)
     or (v_starts is not null and v_ends is not null and v_ends <= v_starts)
     or length(v_note) > 120
     or (v_creator is not null and length(v_creator) > 40)
     or v_comm < 0 or v_comm > 50 then
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
    select stats_key into v_key from public.coupons where code = v_orig;
    delete from public.coupons where code = v_orig;
  elsif v_orig is null and exists (select 1 from public.coupons where code = v_code) then
    raise exception 'GT:COUPON_EXISTS';
  else
    select stats_key into v_key from public.coupons where code = v_code;
  end if;

  -- Kunci halaman statistik creator (dibuat sekali, tetap sama).
  if v_creator is not null and v_key is null then
    v_key := substr(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), 1, 20);
  end if;

  insert into public.coupons (code, kind, value, min_total, max_discount, max_uses, per_grow_id, starts_at, ends_at, active, note, creator, commission_pct, stats_key)
  values (v_code, v_kind, v_value, v_min, case when v_kind = 'percent' then v_max_disc end,
          v_max_uses, v_per, v_starts, v_ends, coalesce((p_coupon ->> 'active')::boolean, true), v_note,
          v_creator, v_comm, v_key)
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
    creator = excluded.creator,
    commission_pct = excluded.commission_pct,
    stats_key = excluded.stats_key,
    updated_at = now();
end $$;

-- Buat ulang kunci statistik (kalau link creator bocor).
create or replace function public.admin_reset_creator_key(p_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := substr(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), 1, 20);
begin
  perform public.gt_require_admin();
  update public.coupons set stats_key = v_key, updated_at = now()
    where code = upper(btrim(coalesce(p_code, ''))) and creator is not null;
  if not found then raise exception 'GT:COUPON_NOT_FOUND'; end if;
  return v_key;
end $$;

-- --------------------------------------------------
-- Laporan referral per periode (Admin → Coupons)
-- --------------------------------------------------
create or replace function public.admin_referral_report(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  return coalesce((
    select jsonb_agg(r order by (r ->> 'revenue')::bigint desc, r ->> 'creator')
    from (
      select jsonb_build_object(
        'code', c.code,
        'creator', c.creator,
        'commissionPct', c.commission_pct,
        'active', c.active,
        'statsKey', c.stats_key,
        'orders', count(o.id) filter (where public.gt_paid_status(o.status)),
        'pending', count(o.id) filter (where o.status in ('pending_payment', 'payment_submitted')),
        'revenue', coalesce(sum(o.total) filter (where public.gt_paid_status(o.status)), 0),
        'discount', coalesce(sum(o.discount) filter (where public.gt_paid_status(o.status)), 0),
        'commission', floor(coalesce(sum(o.total) filter (where public.gt_paid_status(o.status)), 0) * c.commission_pct / 100.0)::bigint
      ) as r
      from public.coupons c
      left join public.orders o
        on o.coupon_code = c.code
       and (p_from is null or o.created_at >= p_from)
       and (p_to is null or o.created_at < p_to)
      where c.creator is not null
      group by c.code
    ) x
  ), '[]'::jsonb);
end $$;

-- --------------------------------------------------
-- Statistik untuk creator (publik, butuh kunci rahasia)
-- --------------------------------------------------
create or replace function public.creator_stats(p_code text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.coupons;
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
begin
  select * into v_c from public.coupons where code = upper(btrim(coalesce(p_code, '')));
  if not found or v_c.creator is null or v_c.stats_key is null
     or coalesce(p_key, '') = '' or v_c.stats_key <> p_key then
    raise exception 'GT:CREATOR_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'code', v_c.code,
    'creator', v_c.creator,
    'active', v_c.active,
    'kind', v_c.kind,
    'value', v_c.value,
    'maxDiscount', v_c.max_discount,
    'commissionPct', v_c.commission_pct,
    'month', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue', coalesce(sum(o.total), 0),
        'commission', floor(coalesce(sum(o.total), 0) * v_c.commission_pct / 100.0)::bigint
      ) from public.orders o
      where o.coupon_code = v_c.code and public.gt_paid_status(o.status) and o.created_at >= v_month
    ),
    'allTime', (
      select jsonb_build_object(
        'orders', count(*),
        'revenue', coalesce(sum(o.total), 0),
        'commission', floor(coalesce(sum(o.total), 0) * v_c.commission_pct / 100.0)::bigint
      ) from public.orders o
      where o.coupon_code = v_c.code and public.gt_paid_status(o.status)
    ),
    -- 20 pesanan terakhir, GrowID disamarkan (mis. "Dr****er").
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'growId', case when length(x.grow_id) <= 3 then left(x.grow_id, 1) || '**'
                       else left(x.grow_id, 2) || repeat('*', least(length(x.grow_id) - 3, 6)) || right(x.grow_id, 1) end,
        'total', x.total,
        'status', case when public.gt_paid_status(x.status) then 'paid' else 'pending' end,
        'createdAt', x.created_at
      ) order by x.created_at desc)
      from (
        select o.grow_id, o.total, o.status, o.created_at from public.orders o
        where o.coupon_code = v_c.code
          and (public.gt_paid_status(o.status) or o.status in ('pending_payment', 'payment_submitted'))
        order by o.created_at desc limit 20
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.gt_paid_status(text)                              from public, anon, authenticated;
revoke all on function public.gt_paid_status(public.order_status)               from public, anon, authenticated;
revoke all on function public.admin_list_coupons()                              from public, anon;
revoke all on function public.admin_upsert_coupon(jsonb, text)                  from public, anon;
revoke all on function public.admin_reset_creator_key(text)                     from public, anon;
revoke all on function public.admin_referral_report(timestamptz, timestamptz)   from public, anon;
revoke all on function public.creator_stats(text, text)                         from public;

grant execute on function public.admin_list_coupons()                            to authenticated;
grant execute on function public.admin_upsert_coupon(jsonb, text)                to authenticated;
grant execute on function public.admin_reset_creator_key(text)                   to authenticated;
grant execute on function public.admin_referral_report(timestamptz, timestamptz) to authenticated;
grant execute on function public.creator_stats(text, text)                       to anon, authenticated;
