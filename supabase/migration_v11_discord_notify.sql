-- ==================================================
-- GTPLAY v11 — NOTIFIKASI DISCORD
-- --------------------------------------------------
-- Database mengirim pesan ke channel Discord admin lewat
-- webhook saat:
--   • order baru dibuat
--   • pembeli mengirim bukti bayar
--   • ada saran / laporan bug baru
--
-- URL webhook RAHASIA: hanya tersimpan di database, tidak
-- pernah dikirim ke browser pengunjung (get_store_status
-- tidak menyertakannya) dan tidak ikut file backup.
-- Pengiriman memakai pg_net (asinkron) sehingga checkout
-- tidak melambat dan tidak gagal bila Discord bermasalah.
--
-- Atur di Admin → Server → Notifikasi Discord.
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

create extension if not exists pg_net with schema extensions;

alter table public.store_settings add column if not exists discord_webhook text
  check (discord_webhook is null or discord_webhook ~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$');
alter table public.store_settings add column if not exists discord_events jsonb not null
  default '{"order": true, "payment": true, "feedback": true}'::jsonb;
alter table public.store_settings add column if not exists notify_site_url text
  check (notify_site_url is null or notify_site_url ~ '^https?://[^[:space:]<>"]+$');

-- --------------------------------------------------
-- Kirim satu pesan (embed) ke webhook
-- --------------------------------------------------
create or replace function public.gt_discord_post(p_event text, p_embed jsonb, p_force boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_settings public.store_settings;
  v_request  bigint;
begin
  select * into v_settings from public.store_settings where id;
  if not found or v_settings.discord_webhook is null then return null; end if;
  if not p_force and coalesce((v_settings.discord_events ->> p_event)::boolean, true) = false then return null; end if;

  select net.http_post(
    url := v_settings.discord_webhook,
    body := jsonb_build_object(
      'username', coalesce(nullif(v_settings.site_settings ->> 'serverName', ''), 'GTPLAY') || ' Store',
      'embeds', jsonb_build_array(p_embed),
      -- Tidak ada @everyone / @here / mention apa pun dari isi pesan.
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request;

  return v_request;
exception when others then
  -- Notifikasi tidak boleh membuat order/feedback gagal.
  return null;
end $$;

create or replace function public.gt_admin_link(p_path text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when s.notify_site_url is null then null
              else rtrim(s.notify_site_url, '/') || p_path end
  from public.store_settings s where s.id;
$$;

-- Embed untuk sebuah order (dipakai order baru & bukti bayar).
create or replace function public.gt_order_embed(p_order_id text, p_title text, p_color integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title || ' — ' || o.id,
    'url', public.gt_admin_link('/admin/orders'),
    'color', p_color,
    'fields', jsonb_build_array(
      jsonb_build_object('name', 'GrowID', 'value', o.grow_id, 'inline', true),
      jsonb_build_object('name', 'Total', 'value',
        public.gt_rupiah(o.total) || case when o.discount > 0
          then ' (kupon ' || coalesce(o.coupon_code, '') || ' −' || public.gt_rupiah(o.discount) || ')' else '' end,
        'inline', true),
      jsonb_build_object('name', 'Metode', 'value', coalesce(upper(o.payment_method), '—'), 'inline', true),
      jsonb_build_object('name', 'Item', 'value', left(coalesce((
        select string_agg(i.product_name || ' ×' || i.quantity || ' — ' || public.gt_rupiah(i.subtotal), E'\n' order by i.id)
        from public.order_items i where i.order_id = o.id
      ), '—'), 1000))
    ),
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ))
  from public.orders o where o.id = p_order_id;
$$;

-- --------------------------------------------------
-- Trigger
-- --------------------------------------------------
-- Dijalankan saat transaksi selesai (deferred) supaya item
-- pesanan sudah tersimpan ketika pesan dibuat.
create or replace function public.gt_notify_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.gt_discord_post('order', public.gt_order_embed(new.id, 'Order baru', 15017775));
  elsif new.status = 'payment_submitted' and old.status is distinct from 'payment_submitted' then
    perform public.gt_discord_post('payment', public.gt_order_embed(new.id, 'Bukti bayar masuk — cek & verifikasi', 16098596));
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists gt_notify_order_insert on public.orders;
create constraint trigger gt_notify_order_insert
  after insert on public.orders
  deferrable initially deferred
  for each row execute function public.gt_notify_order();

drop trigger if exists gt_notify_order_payment on public.orders;
create constraint trigger gt_notify_order_payment
  after update of status on public.orders
  deferrable initially deferred
  for each row
  when (new.status = 'payment_submitted' and old.status is distinct from new.status)
  execute function public.gt_notify_order();

create or replace function public.gt_notify_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_discord_post('feedback', jsonb_strip_nulls(jsonb_build_object(
    'title', case when new.kind = 'bug' then 'Laporan bug baru' else 'Saran baru' end,
    'url', public.gt_admin_link('/admin/feedback'),
    'color', case when new.kind = 'bug' then 16729950 else 3906559 end,
    'description', left(new.message, 1000),
    'fields', jsonb_build_array(jsonb_build_object('name', 'GrowID', 'value', new.grow_id, 'inline', true)),
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )));
  return null;
exception when others then
  return null;
end $$;

do $$
begin
  if to_regclass('public.feedback') is not null then
    execute 'drop trigger if exists gt_notify_feedback_insert on public.feedback';
    execute 'create trigger gt_notify_feedback_insert after insert on public.feedback
             for each row execute function public.gt_notify_feedback()';
  end if;
end $$;

-- --------------------------------------------------
-- ADMIN
-- --------------------------------------------------
create or replace function public.admin_get_discord_settings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.store_settings;
begin
  perform public.gt_require_admin();
  select * into v from public.store_settings where id;
  return jsonb_build_object(
    'configured', v.discord_webhook is not null,
    -- Hanya potongan awal URL yang ditampilkan, token tidak.
    'preview', case when v.discord_webhook is null then null
                    else regexp_replace(v.discord_webhook, '^(https://[^/]+/api/webhooks/[0-9]{4})[0-9]*/.*$', '\1…/••••') end,
    'events', coalesce(v.discord_events, '{"order": true, "payment": true, "feedback": true}'::jsonb),
    'siteUrl', v.notify_site_url
  );
end $$;

-- p_webhook kosong = webhook lama tetap dipakai; p_clear = hapus webhook.
create or replace function public.admin_set_discord_settings(p_webhook text, p_events jsonb, p_site_url text, p_clear boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hook text := nullif(btrim(coalesce(p_webhook, '')), '');
  v_site text := nullif(btrim(coalesce(p_site_url, '')), '');
begin
  perform public.gt_require_admin();

  if v_hook is not null and v_hook !~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    raise exception 'GT:INVALID_WEBHOOK';
  end if;
  if v_site is not null and v_site !~ '^https?://[^[:space:]<>"]+$' then
    raise exception 'GT:INVALID_WEBHOOK';
  end if;

  insert into public.store_settings (id) values (true) on conflict (id) do nothing;
  update public.store_settings set
    discord_webhook = case when p_clear then null else coalesce(v_hook, discord_webhook) end,
    discord_events = jsonb_build_object(
      'order',    coalesce((p_events ->> 'order')::boolean, true),
      'payment',  coalesce((p_events ->> 'payment')::boolean, true),
      'feedback', coalesce((p_events ->> 'feedback')::boolean, true)
    ),
    notify_site_url = coalesce(v_site, notify_site_url),
    updated_at = now()
  where id;

  return public.admin_get_discord_settings();
end $$;

-- Kirim pesan tes; hasilnya dicek dengan admin_discord_result.
create or replace function public.admin_test_discord()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request bigint;
begin
  perform public.gt_require_admin();
  if not exists (select 1 from public.store_settings where id and discord_webhook is not null) then
    raise exception 'GT:INVALID_WEBHOOK';
  end if;
  v_request := public.gt_discord_post('test', jsonb_build_object(
    'title', 'Notifikasi Discord tersambung',
    'description', 'Pesan tes dari Admin Panel. Order baru, bukti bayar, dan feedback akan muncul di channel ini.',
    'color', 2278750,
    'url', public.gt_admin_link('/admin/server')
  ), true);
  return v_request;
end $$;

create or replace function public.admin_discord_result(p_request bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_status integer;
  v_error  text;
  v_found  boolean := false;
begin
  perform public.gt_require_admin();
  select r.status_code, r.error_msg, true into v_status, v_error, v_found
    from net._http_response r where r.id = p_request;
  return jsonb_build_object('done', coalesce(v_found, false), 'status', v_status, 'error', v_error);
end $$;

-- Backup tidak menyertakan URL webhook.
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
      when 'store_settings' then array['discord_webhook']
      else array[]::text[]
    end;
    execute format('select coalesce(jsonb_agg(to_jsonb(t) - %L::text[]), ''[]''::jsonb) from public.%I t', v_hidden, v_table)
      into v_rows;
    v_out := v_out || jsonb_build_object(v_table, v_rows);
  end loop;

  return jsonb_build_object('format', 'gtplay-backup', 'version', 1, 'exportedAt', now(), 'tables', v_out);
end $$;

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.gt_discord_post(text, jsonb, boolean)                    from public, anon, authenticated;
revoke all on function public.gt_admin_link(text)                                      from public, anon, authenticated;
revoke all on function public.gt_order_embed(text, text, integer)                     from public, anon, authenticated;
revoke all on function public.gt_notify_order()                                       from public, anon, authenticated;
revoke all on function public.gt_notify_feedback()                                    from public, anon, authenticated;
revoke all on function public.admin_get_discord_settings()                            from public, anon;
revoke all on function public.admin_set_discord_settings(text, jsonb, text, boolean)  from public, anon;
revoke all on function public.admin_test_discord()                                    from public, anon;
revoke all on function public.admin_discord_result(bigint)                            from public, anon;
revoke all on function public.admin_export_backup()                                   from public, anon;

grant execute on function public.admin_get_discord_settings()                         to authenticated;
grant execute on function public.admin_set_discord_settings(text, jsonb, text, boolean) to authenticated;
grant execute on function public.admin_test_discord()                                 to authenticated;
grant execute on function public.admin_discord_result(bigint)                         to authenticated;
grant execute on function public.admin_export_backup()                                to authenticated;
