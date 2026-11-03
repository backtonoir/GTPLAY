-- ==================================================
-- GTPLAY v8 — PENGATURAN WEBSITE DARI ADMIN
-- --------------------------------------------------
-- Admin → Server → Pengaturan Website:
--   • Nama server & warna tema
--   • Logo, favicon, ikon iPhone, gambar preview link (OG),
--     gambar hero
--   • Pembayaran: gambar QRIS, GoPay, rekening bank
--   • WhatsApp admin & link sosial media
--
-- Disimpan di store_settings.site_settings (jsonb, 1 baris).
-- Field kosong → website memakai nilai di js/config.js.
-- Semua isi divalidasi di server; hanya admin yang bisa
-- menyimpan dan meng-upload gambar.
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah
-- schema.sql dan migration_v6. Aman dijalankan ulang.
-- ==================================================

alter table public.store_settings
  add column if not exists site_settings jsonb not null default '{}'::jsonb;

-- Status toko + login guide + pengaturan website (dibaca semua halaman).
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
    'loginGuide', coalesce(s.login_guide, '{}'::jsonb),
    'site', coalesce(s.site_settings, '{}'::jsonb)
  )
  from public.store_settings s
  where s.id;
$$;

-- Ambil teks dari jsonb, rapikan, dan cek pola + panjang.
create or replace function public.gt_site_text(p_source jsonb, p_key text, p_pattern text, p_max integer)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_value text := btrim(regexp_replace(coalesce(p_source ->> p_key, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  if v_value = '' then return null; end if;
  if length(v_value) > p_max or v_value !~ p_pattern then
    raise exception 'GT:INVALID_SITE_SETTINGS' using detail = p_key;
  end if;
  return v_value;
end $$;

create or replace function public.admin_set_site_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_url    constant text := '^https://[^[:space:]<>"]+$';
  c_plain  constant text := '^[^<>]+$';
  v_social jsonb := coalesce(p_settings -> 'social', '{}'::jsonb);
  v_pay    jsonb := coalesce(p_settings -> 'payment', '{}'::jsonb);
  v_img    jsonb := coalesce(p_settings -> 'images', '{}'::jsonb);
  v_key    text;
  v_out    jsonb;
  v_part   jsonb;
begin
  perform public.gt_require_admin();

  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or jsonb_typeof(v_social) <> 'object' or jsonb_typeof(v_pay) <> 'object' or jsonb_typeof(v_img) <> 'object' then
    raise exception 'GT:INVALID_SITE_SETTINGS';
  end if;

  v_out := jsonb_strip_nulls(jsonb_build_object(
    'serverName', public.gt_site_text(p_settings, 'serverName', c_plain, 40),
    'theme',      lower(public.gt_site_text(p_settings, 'theme', '^#[0-9A-Fa-f]{6}$', 7)),
    'whatsapp',   public.gt_site_text(p_settings, 'whatsapp', '^[0-9]{8,15}$', 15)
  ));

  v_part := '{}'::jsonb;
  foreach v_key in array array['instagram', 'tiktok', 'discord', 'youtube', 'facebook'] loop
    v_part := v_part || jsonb_strip_nulls(jsonb_build_object(v_key, public.gt_site_text(v_social, v_key, c_url, 300)));
  end loop;
  if v_part <> '{}'::jsonb then v_out := v_out || jsonb_build_object('social', v_part); end if;

  v_part := jsonb_strip_nulls(jsonb_build_object(
    'qrisImage',   public.gt_site_text(v_pay, 'qrisImage', c_url, 500),
    'gopayNumber', public.gt_site_text(v_pay, 'gopayNumber', '^[0-9 +-]{6,20}$', 20),
    'gopayName',   public.gt_site_text(v_pay, 'gopayName', c_plain, 60),
    'bankLabel',   public.gt_site_text(v_pay, 'bankLabel', c_plain, 30),
    'bankName',    public.gt_site_text(v_pay, 'bankName', c_plain, 30),
    'bankNumber',  public.gt_site_text(v_pay, 'bankNumber', '^[0-9 -]{4,30}$', 30),
    'bankHolder',  public.gt_site_text(v_pay, 'bankHolder', c_plain, 60)
  ));
  if v_part <> '{}'::jsonb then v_out := v_out || jsonb_build_object('payment', v_part); end if;

  v_part := '{}'::jsonb;
  foreach v_key in array array['logo', 'favicon', 'appleTouch', 'ogImage', 'hero'] loop
    v_part := v_part || jsonb_strip_nulls(jsonb_build_object(v_key, public.gt_site_text(v_img, v_key, c_url, 500)));
  end loop;
  if v_part <> '{}'::jsonb then v_out := v_out || jsonb_build_object('images', v_part); end if;

  insert into public.store_settings (id) values (true) on conflict (id) do nothing;
  update public.store_settings set site_settings = v_out, updated_at = now() where id;

  return public.get_store_status();
end $$;

-- --------------------------------------------------
-- STORAGE: gambar website (logo, QRIS, OG, dll.)
-- --------------------------------------------------
-- PUBLIC read (dipakai di semua halaman), hanya admin yang
-- upload/ganti/hapus. Maks 3 MB, PNG/JPG/WEBP/ICO.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 3145728,
        array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'])
on conflict (id) do nothing;

drop policy if exists "gtplay site assets: admin insert" on storage.objects;
create policy "gtplay site assets: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "gtplay site assets: admin update" on storage.objects;
create policy "gtplay site assets: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());

drop policy if exists "gtplay site assets: admin delete" on storage.objects;
create policy "gtplay site assets: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-assets' and public.is_admin());

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.gt_site_text(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public.get_store_status()                       from public;
grant execute on function public.get_store_status()                    to anon, authenticated;
revoke all on function public.admin_set_site_settings(jsonb)           from public, anon;
grant execute on function public.admin_set_site_settings(jsonb)        to authenticated;
