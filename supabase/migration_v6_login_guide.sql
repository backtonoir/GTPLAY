-- ==================================================
-- GTPLAY v6 — LOGIN GUIDE (IP & link di halaman How To)
-- --------------------------------------------------
-- IP server, domain file hosts, dan semua link di
-- "Cara Login per Platform" bisa diubah dari
-- Admin → Downloads → How To Login.
--
-- Disimpan di store_settings.login_guide (jsonb, 1 baris).
-- Field yang kosong → halaman memakai nilai dari
-- js/config.js (LOGIN_GUIDE) sebagai cadangan.
--
-- Semua isi divalidasi di server: hanya key yang dikenal,
-- link wajib https://, panjang dibatasi.
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah
-- schema.sql. Aman dijalankan ulang.
-- ==================================================

alter table public.store_settings
  add column if not exists login_guide jsonb not null default '{}'::jsonb;

-- Status toko + login guide (dibaca semua halaman).
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
    ),
    'loginGuide', coalesce(s.login_guide, '{}'::jsonb)
  )
  from public.store_settings s
  where s.id;
$$;

create or replace function public.admin_set_login_guide(p_guide jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url_keys text[] := array[
    'certificateUrl', 'gtplayApk', 'powerTunnel', 'hostsGo', 'virtualHost',
    'hostsFile', 'surge5', 'androidHostsUrl', 'iosProfileUrl'
  ];
  v_key    text;
  v_value  text;
  v_out    jsonb := '{}'::jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_domain jsonb;
begin
  perform public.gt_require_admin();

  if p_guide is null or jsonb_typeof(p_guide) <> 'object' then
    raise exception 'GT:INVALID_LOGIN_GUIDE';
  end if;

  -- IP / host server
  v_value := btrim(coalesce(p_guide ->> 'serverIp', ''));
  if v_value <> '' then
    if length(v_value) > 64 or v_value !~ '^[A-Za-z0-9.:-]+$' then
      raise exception 'GT:INVALID_LOGIN_GUIDE';
    end if;
    v_out := v_out || jsonb_build_object('serverIp', v_value);
  end if;

  -- Domain untuk file hosts
  if p_guide ? 'hostsDomains' then
    if jsonb_typeof(p_guide -> 'hostsDomains') <> 'array' or jsonb_array_length(p_guide -> 'hostsDomains') > 10 then
      raise exception 'GT:INVALID_LOGIN_GUIDE';
    end if;
    for v_domain in select * from jsonb_array_elements(p_guide -> 'hostsDomains') loop
      v_value := btrim(coalesce(v_domain #>> '{}', ''));
      continue when v_value = '';
      if length(v_value) > 253 or v_value !~ '^[A-Za-z0-9.-]+$' then
        raise exception 'GT:INVALID_LOGIN_GUIDE';
      end if;
      v_domains := v_domains || to_jsonb(lower(v_value));
    end loop;
    if jsonb_array_length(v_domains) > 0 then
      v_out := v_out || jsonb_build_object('hostsDomains', v_domains);
    end if;
  end if;

  -- Semua link: kosong atau https://, tanpa spasi
  foreach v_key in array v_url_keys loop
    v_value := btrim(coalesce(p_guide ->> v_key, ''));
    continue when v_value = '';
    if length(v_value) > 500 or v_value !~ '^https://[^[:space:]]+$' then
      raise exception 'GT:INVALID_LINK';
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_value);
  end loop;

  -- Nama file hosts (Virtual Host)
  v_value := btrim(coalesce(p_guide ->> 'hostsFileName', ''));
  if v_value <> '' then
    if length(v_value) > 100 or v_value !~ '^[A-Za-z0-9 ._()-]+$' then
      raise exception 'GT:INVALID_LOGIN_GUIDE';
    end if;
    v_out := v_out || jsonb_build_object('hostsFileName', v_value);
  end if;

  insert into public.store_settings (id) values (true) on conflict (id) do nothing;
  update public.store_settings set login_guide = v_out, updated_at = now() where id;

  return public.get_store_status();
end $$;

revoke all on function public.get_store_status()             from public;
grant execute on function public.get_store_status()          to anon, authenticated;
revoke all on function public.admin_set_login_guide(jsonb)   from public, anon;
grant execute on function public.admin_set_login_guide(jsonb) to authenticated;
