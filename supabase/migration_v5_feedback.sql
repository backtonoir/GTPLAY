-- ==================================================
-- GTPLAY v5 — FEEDBACK (saran & laporan bug)
-- --------------------------------------------------
-- Player mengirim saran / laporan bug dari /feedback.
-- Admin membaca dari Admin → Feedback.
--
-- Dibuat ringan supaya database tidak cepat penuh:
--   • Pesan maks 500 karakter, tanpa upload file.
--   • Maks 3 kiriman per GrowID dan 5 per jaringan (IP)
--     setiap 24 jam; pesan yang sama tidak bisa dikirim ulang.
--   • Maks 100 kiriman baru per 24 jam untuk seluruh website.
--   • Pembersihan otomatis setiap ada kiriman baru:
--       - yang sudah dibaca & lebih dari 30 hari → dihapus
--       - semua yang lebih dari 90 hari → dihapus
--       - total disimpan maks 500 (yang terlama dibuang)
--     → paling besar ±500 baris (< 1 MB).
--   • IP tidak disimpan mentah, hanya hash SHA-256
--     (untuk batas kiriman).
--
-- Tabel tanpa policy RLS: player & admin hanya bisa
-- mengakses lewat RPC di bawah.
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah
-- schema.sql. Aman dijalankan ulang.
-- ==================================================

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('suggestion', 'bug')),
  grow_id    text not null check (grow_id ~ '^[A-Za-z0-9_]{3,24}$'),
  message    text not null check (length(message) between 10 and 500),
  status     text not null default 'new' check (status in ('new', 'read')),
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_growid_idx  on public.feedback (lower(grow_id), created_at desc);
create index if not exists feedback_ip_idx      on public.feedback (ip_hash, created_at desc) where ip_hash is not null;

alter table public.feedback enable row level security;
-- feedback: tanpa policy → hanya lewat RPC.

-- --------------------------------------------------
-- Player: kirim saran / laporan bug
-- --------------------------------------------------
create or replace function public.submit_feedback(p_kind text, p_grow_id text, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grow_id text := btrim(coalesce(p_grow_id, ''));
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]+', ' ', 'g'));
  v_headers json;
  v_ip      text;
  v_ip_hash text;
begin
  if p_kind not in ('suggestion', 'bug') then
    raise exception 'GT:INVALID_FEEDBACK';
  end if;
  if v_grow_id !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'GT:INVALID_GROWID';
  end if;
  if length(v_message) < 10 or length(v_message) > 500 then
    raise exception 'GT:INVALID_FEEDBACK';
  end if;

  -- IP pengirim (dari header PostgREST), disimpan sebagai hash saja.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1)), '');
  if v_ip is not null then
    v_ip_hash := encode(extensions.digest('gtplay-feedback:' || v_ip, 'sha256'), 'hex');
  end if;

  -- Batas kiriman.
  if (select count(*) from public.feedback
      where lower(grow_id) = lower(v_grow_id) and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'GT:FEEDBACK_LIMIT';
  end if;
  if v_ip_hash is not null and (select count(*) from public.feedback
      where ip_hash = v_ip_hash and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'GT:FEEDBACK_LIMIT';
  end if;
  if exists (select 1 from public.feedback
      where lower(grow_id) = lower(v_grow_id) and lower(message) = lower(v_message)) then
    raise exception 'GT:FEEDBACK_DUPLICATE';
  end if;
  if (select count(*) from public.feedback where created_at > now() - interval '24 hours') >= 100 then
    raise exception 'GT:FEEDBACK_BUSY';
  end if;

  insert into public.feedback (kind, grow_id, message, ip_hash)
  values (p_kind, v_grow_id, v_message, v_ip_hash);

  -- Pembersihan otomatis supaya tabel tetap kecil.
  delete from public.feedback
  where (status = 'read' and created_at < now() - interval '30 days')
     or created_at < now() - interval '90 days';

  delete from public.feedback
  where id in (select id from public.feedback order by created_at desc offset 500);

  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------
-- Admin
-- --------------------------------------------------
create or replace function public.admin_list_feedback()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'kind', f.kind, 'growId', f.grow_id, 'message', f.message,
      'status', f.status, 'createdAt', f.created_at
    ) order by f.created_at desc)
    from public.feedback f
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_feedback_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  if p_status not in ('new', 'read') then
    raise exception 'GT:INVALID_FEEDBACK';
  end if;
  update public.feedback set status = p_status where id = p_id;
end $$;

create or replace function public.admin_delete_feedback(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();
  delete from public.feedback where id = p_id;
end $$;

-- Hapus semua yang sudah dibaca.
create or replace function public.admin_clear_read_feedback()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.gt_require_admin();
  delete from public.feedback where status = 'read';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- --------------------------------------------------
-- Hak akses
-- --------------------------------------------------
revoke all on function public.submit_feedback(text, text, text)          from public;
revoke all on function public.admin_list_feedback()                       from public, anon;
revoke all on function public.admin_set_feedback_status(bigint, text)     from public, anon;
revoke all on function public.admin_delete_feedback(bigint)               from public, anon;
revoke all on function public.admin_clear_read_feedback()                 from public, anon;

grant execute on function public.submit_feedback(text, text, text)       to anon, authenticated;
grant execute on function public.admin_list_feedback()                    to authenticated;
grant execute on function public.admin_set_feedback_status(bigint, text)  to authenticated;
grant execute on function public.admin_delete_feedback(bigint)            to authenticated;
grant execute on function public.admin_clear_read_feedback()              to authenticated;
