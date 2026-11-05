-- ==================================================
-- GTPLAY v14 — PENGUMUMAN OTOMATIS KE DISCORD
-- --------------------------------------------------
-- Setiap pengumuman yang di-publish dari Admin Panel
-- (Announcements) otomatis dikirim ke channel Discord
-- publik, mis. #pengumuman. Webhook-nya TERPISAH dari
-- webhook notifikasi order (channel admin), supaya data
-- pesanan tidak pernah masuk ke channel pemain.
--
-- Dikirim saat:
--   • pengumuman baru dibuat dalam keadaan Published, atau
--   • pengumuman Draft diubah menjadi Published.
-- Mengedit pengumuman yang sudah tampil TIDAK mengirim ulang.
--
-- Butuh migration_v11_discord_notify.sql (pg_net).
-- Jalankan di Supabase Dashboard → SQL Editor.
-- Aman dijalankan ulang.
-- ==================================================

create extension if not exists pg_net with schema extensions;

alter table public.store_settings add column if not exists discord_announce_webhook text
  check (discord_announce_webhook is null or discord_announce_webhook ~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$');
alter table public.store_settings add column if not exists discord_announce_ping boolean not null default false;

-- --------------------------------------------------
-- Embed pengumuman
-- --------------------------------------------------
create or replace function public.gt_announcement_embed(p_title text, p_content text, p_category text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_content, ''));
begin
  -- Teks berwarna ala Discord: baris diawali + / - / ! dibungkus
  -- ```diff supaya warnanya juga muncul di Discord.
  if position('```' in v_body) = 0 and v_body ~ '(^|\n)[+!-]' then
    v_body := E'```diff\n' || v_body || E'\n```';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'title', left(p_title, 250),
    'url', public.gt_admin_link('/announcement'),
    'description', left(v_body, 4000),
    'color', case p_category when 'event' then 16750848 when 'maintenance' then 16729950 else 15015729 end,
    'footer', jsonb_build_object('text', case p_category when 'event' then 'Event' when 'maintenance' then 'Maintenance' else 'Update' end),
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ));
end $$;

-- Kirim ke webhook pengumuman.
create or replace function public.gt_discord_announce(p_embed jsonb)
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
  if not found or v_settings.discord_announce_webhook is null then return null; end if;

  select net.http_post(
    url := v_settings.discord_announce_webhook,
    body := jsonb_strip_nulls(jsonb_build_object(
      'username', coalesce(nullif(v_settings.site_settings ->> 'serverName', ''), 'GTPLAY'),
      'content', case when v_settings.discord_announce_ping then '@everyone' end,
      'embeds', jsonb_build_array(p_embed),
      -- Hanya @everyone dari pengaturan admin; mention di isi pengumuman diabaikan.
      'allowed_mentions', jsonb_build_object('parse',
        case when v_settings.discord_announce_ping then '["everyone"]'::jsonb else '[]'::jsonb end)
    )),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request;

  return v_request;
exception when others then
  -- Notifikasi tidak boleh membuat penyimpanan pengumuman gagal.
  return null;
end $$;

create or replace function public.gt_notify_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    perform public.gt_discord_announce(public.gt_announcement_embed(new.title, new.content, new.category));
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists gt_notify_announcement on public.announcements;
create trigger gt_notify_announcement
  after insert or update of published on public.announcements
  for each row execute function public.gt_notify_announcement();

-- --------------------------------------------------
-- ADMIN
-- --------------------------------------------------
create or replace function public.admin_get_discord_announce()
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
    'configured', v.discord_announce_webhook is not null,
    'preview', case when v.discord_announce_webhook is null then null
                    else regexp_replace(v.discord_announce_webhook, '^(https://[^/]+/api/webhooks/[0-9]{4})[0-9]*/.*$', '\1…/••••') end,
    'ping', coalesce(v.discord_announce_ping, false)
  );
end $$;

-- p_webhook kosong = webhook lama tetap dipakai; p_clear = hapus webhook.
create or replace function public.admin_set_discord_announce(p_webhook text, p_ping boolean, p_site_url text, p_clear boolean default false)
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
    discord_announce_webhook = case when p_clear then null else coalesce(v_hook, discord_announce_webhook) end,
    discord_announce_ping = coalesce(p_ping, false),
    notify_site_url = coalesce(v_site, notify_site_url),
    updated_at = now()
  where id;

  return public.admin_get_discord_announce();
end $$;

-- Kirim pengumuman ke Discord secara manual (mis. setelah diedit).
-- p_id null = pesan tes.
create or replace function public.admin_send_announcement_discord(p_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.announcements;
  v_request bigint;
begin
  perform public.gt_require_admin();
  if not exists (select 1 from public.store_settings where id and discord_announce_webhook is not null) then
    raise exception 'GT:INVALID_WEBHOOK';
  end if;

  if p_id is null then
    v_request := public.gt_discord_announce(jsonb_build_object(
      'title', 'Channel pengumuman tersambung',
      'description', 'Pesan tes dari Admin Panel. Setiap pengumuman yang di-publish akan muncul di channel ini.',
      'color', 2278750
    ));
  else
    select * into v_row from public.announcements where id = p_id;
    if not found then raise exception 'GT:NOT_FOUND'; end if;
    v_request := public.gt_discord_announce(public.gt_announcement_embed(v_row.title, v_row.content, v_row.category));
  end if;
  return v_request;
end $$;

-- --------------------------------------------------
-- Backup tidak menyertakan URL webhook mana pun.
-- --------------------------------------------------
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
      when 'store_settings' then array['discord_webhook', 'discord_announce_webhook']
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
revoke all on function public.gt_announcement_embed(text, text, text)                    from public, anon, authenticated;
revoke all on function public.gt_discord_announce(jsonb)                                 from public, anon, authenticated;
revoke all on function public.gt_notify_announcement()                                   from public, anon, authenticated;
revoke all on function public.admin_get_discord_announce()                               from public, anon;
revoke all on function public.admin_set_discord_announce(text, boolean, text, boolean)   from public, anon;
revoke all on function public.admin_send_announcement_discord(uuid)                      from public, anon;
revoke all on function public.admin_export_backup()                                      from public, anon;

grant execute on function public.admin_get_discord_announce()                             to authenticated;
grant execute on function public.admin_set_discord_announce(text, boolean, text, boolean) to authenticated;
grant execute on function public.admin_send_announcement_discord(uuid)                    to authenticated;
grant execute on function public.admin_export_backup()                                    to authenticated;
