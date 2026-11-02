-- ==================================================
-- GTPLAY v4.0 — MIGRATION
-- --------------------------------------------------
-- Fitur baru:
--   1. Changelog   — riwayat versi / update
--   2. Blacklist    — daftar pemain yang diblokir
--   3. Broadcast    — log pesan broadcast ke game server
--   4. Realtime     — orders table untuk admin dashboard
--
-- Jalankan di Supabase Dashboard → SQL Editor setelah
-- schema.sql (v3.x) sudah diterapkan.
-- ==================================================

-- --------------------------------------------------
-- 1. CHANGELOG
-- --------------------------------------------------

create table if not exists public.changelog (
  id           uuid primary key default gen_random_uuid(),
  version      text not null check (length(btrim(version)) between 1 and 20),
  title        text not null check (length(btrim(title)) between 1 and 120),
  content      text not null check (length(content) between 1 and 5000),
  category     text not null default 'feature'
                 check (category in ('feature', 'bugfix', 'improvement', 'security')),
  published_on date not null default (now() at time zone 'Asia/Jakarta')::date,
  published    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists changelog_published_idx
  on public.changelog (published, published_on desc);

drop trigger if exists changelog_touch on public.changelog;
create trigger changelog_touch
  before update on public.changelog
  for each row execute function public.touch_updated_at();

alter table public.changelog enable row level security;

drop policy if exists "changelog: public reads published" on public.changelog;
create policy "changelog: public reads published" on public.changelog
  for select to anon, authenticated
  using (published or public.is_admin());

drop policy if exists "changelog: admin writes" on public.changelog;
create policy "changelog: admin writes" on public.changelog
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Public: daftar changelog yang sudah dipublikasikan.
create or replace function public.list_changelog(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'version', c.version,
      'title', c.title,
      'content', c.content,
      'category', c.category,
      'publishedOn', c.published_on,
      'createdAt', c.created_at
    ) order by c.published_on desc, c.created_at desc)
    from (
      select * from public.changelog
      where published
      order by published_on desc, created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) c
  ), '[]'::jsonb);
$$;

-- Admin: semua changelog termasuk yang belum dipublikasikan.
create or replace function public.admin_list_changelog()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'version', c.version,
      'title', c.title,
      'content', c.content,
      'category', c.category,
      'publishedOn', c.published_on,
      'published', c.published,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at
    ) order by c.published_on desc, c.created_at desc)
    from public.changelog c
  ), '[]'::jsonb);
end $$;

-- Admin: tambah atau edit changelog entry.
create or replace function public.admin_upsert_changelog(
  p_id uuid default null,
  p_version text default null,
  p_title text default null,
  p_content text default null,
  p_category text default 'feature',
  p_published_on date default null,
  p_published boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.gt_require_admin();

  if btrim(coalesce(p_version, '')) = '' then
    raise exception 'GT:INVALID_VERSION';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'GT:INVALID_TITLE';
  end if;
  if coalesce(p_content, '') = '' then
    raise exception 'GT:INVALID_CONTENT';
  end if;

  if p_id is not null then
    -- Update existing
    update public.changelog set
      version      = coalesce(p_version, version),
      title        = coalesce(p_title, title),
      content      = coalesce(p_content, content),
      category     = coalesce(p_category, category),
      published_on = coalesce(p_published_on, published_on),
      published    = coalesce(p_published, published)
    where id = p_id;

    if not found then
      raise exception 'GT:NOT_FOUND';
    end if;
    v_id := p_id;
  else
    -- Insert new
    insert into public.changelog (version, title, content, category, published_on, published)
    values (
      p_version,
      p_title,
      p_content,
      coalesce(p_category, 'feature'),
      coalesce(p_published_on, (now() at time zone 'Asia/Jakarta')::date),
      coalesce(p_published, true)
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Admin: hapus changelog entry.
create or replace function public.admin_delete_changelog(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  delete from public.changelog where id = p_id;
  if not found then
    raise exception 'GT:NOT_FOUND';
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------
-- 2. BLACKLIST
-- --------------------------------------------------

create table if not exists public.blacklist (
  id          uuid primary key default gen_random_uuid(),
  grow_id     text not null check (grow_id ~ '^[A-Za-z0-9_]{3,24}$'),
  reason      text not null default '' check (length(reason) <= 500),
  banned_at   timestamptz not null default now(),
  banned_by   uuid references auth.users (id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Satu GrowID hanya bisa ada satu kali di blacklist aktif.
create unique index if not exists blacklist_growid_active_idx
  on public.blacklist (lower(grow_id)) where active;

create index if not exists blacklist_active_banned_idx
  on public.blacklist (active, banned_at desc);

drop trigger if exists blacklist_touch on public.blacklist;
create trigger blacklist_touch
  before update on public.blacklist
  for each row execute function public.touch_updated_at();

alter table public.blacklist enable row level security;

-- Pemain bisa melihat daftar blacklist yang aktif (transparan).
drop policy if exists "blacklist: public reads active" on public.blacklist;
create policy "blacklist: public reads active" on public.blacklist
  for select to anon, authenticated
  using (active or public.is_admin());

drop policy if exists "blacklist: admin writes" on public.blacklist;
create policy "blacklist: admin writes" on public.blacklist
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Public: cek apakah GrowID ada di blacklist.
create or replace function public.check_blacklist(p_grow_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
      'banned', true,
      'growId', b.grow_id,
      'reason', b.reason,
      'bannedAt', b.banned_at
    )
    from public.blacklist b
    where lower(b.grow_id) = lower(btrim(coalesce(p_grow_id, '')))
      and b.active
    limit 1),
    jsonb_build_object('banned', false)
  );
$$;

-- Public: daftar blacklist dengan pencarian dan pagination.
create or replace function public.list_blacklist(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'total', (
      select count(*) from public.blacklist
      where active
        and (p_search is null or btrim(p_search) = '' or lower(grow_id) like '%' || lower(btrim(p_search)) || '%')
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'growId', b.grow_id,
        'reason', b.reason,
        'bannedAt', b.banned_at
      ) order by b.banned_at desc)
      from (
        select * from public.blacklist
        where active
          and (p_search is null or btrim(p_search) = '' or lower(grow_id) like '%' || lower(btrim(p_search)) || '%')
        order by banned_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
        offset greatest(coalesce(p_offset, 0), 0)
      ) b
    ), '[]'::jsonb)
  );
$$;

-- Admin: semua blacklist termasuk yang tidak aktif.
create or replace function public.admin_list_blacklist()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'growId', b.grow_id,
      'reason', b.reason,
      'bannedAt', b.banned_at,
      'bannedBy', b.banned_by,
      'active', b.active,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at
    ) order by b.banned_at desc)
    from public.blacklist b
  ), '[]'::jsonb);
end $$;

-- Admin: tambah pemain ke blacklist.
create or replace function public.admin_add_blacklist(p_grow_id text, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grow_id text := btrim(coalesce(p_grow_id, ''));
  v_id uuid;
begin
  perform public.gt_require_admin();

  if v_grow_id !~ '^[A-Za-z0-9_]{3,24}$' then
    raise exception 'GT:INVALID_GROWID';
  end if;

  -- Cek apakah sudah ada di blacklist aktif.
  if exists (select 1 from public.blacklist where lower(grow_id) = lower(v_grow_id) and active) then
    raise exception 'GT:ALREADY_BLACKLISTED';
  end if;

  insert into public.blacklist (grow_id, reason, banned_by)
  values (v_grow_id, coalesce(btrim(p_reason), ''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Admin: update blacklist entry (reason / active status).
create or replace function public.admin_update_blacklist(
  p_id uuid,
  p_reason text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.blacklist;
begin
  perform public.gt_require_admin();

  select * into v_row from public.blacklist where id = p_id for update;
  if not found then
    raise exception 'GT:NOT_FOUND';
  end if;

  -- Jika mengaktifkan kembali, cek duplikat.
  if coalesce(p_active, v_row.active) and not v_row.active then
    if exists (select 1 from public.blacklist where lower(grow_id) = lower(v_row.grow_id) and active and id <> p_id) then
      raise exception 'GT:ALREADY_BLACKLISTED';
    end if;
  end if;

  update public.blacklist set
    reason = coalesce(p_reason, reason),
    active = coalesce(p_active, active)
  where id = p_id;

  return jsonb_build_object('ok', true);
end $$;

-- Admin: hapus blacklist entry permanen.
create or replace function public.admin_remove_blacklist(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  delete from public.blacklist where id = p_id;
  if not found then
    raise exception 'GT:NOT_FOUND';
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------
-- 3. BROADCAST MESSAGES
-- --------------------------------------------------
-- Hanya log — pengiriman aktual dilakukan oleh Vercel
-- serverless function (api/broadcast.js) yang berkomunikasi
-- langsung dengan GTPS Cloud. Kredensial server TIDAK
-- pernah dikirim ke frontend.

create table if not exists public.broadcast_messages (
  id          uuid primary key default gen_random_uuid(),
  message     text not null check (length(btrim(message)) between 1 and 500),
  sent_by     uuid not null references auth.users (id),
  sent_at     timestamptz not null default now(),
  status      text not null default 'pending'
                check (status in ('pending', 'sent', 'failed')),
  response    text check (response is null or length(response) <= 2000),
  created_at  timestamptz not null default now()
);

create index if not exists broadcast_messages_sent_idx
  on public.broadcast_messages (sent_at desc);

alter table public.broadcast_messages enable row level security;

-- Broadcast hanya untuk admin — tidak ada akses publik.
drop policy if exists "broadcast: admin reads" on public.broadcast_messages;
create policy "broadcast: admin reads" on public.broadcast_messages
  for select to authenticated
  using (public.is_admin());

drop policy if exists "broadcast: admin inserts" on public.broadcast_messages;
create policy "broadcast: admin inserts" on public.broadcast_messages
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "broadcast: admin updates" on public.broadcast_messages;
create policy "broadcast: admin updates" on public.broadcast_messages
  for update to authenticated
  using (public.is_admin());

-- Admin: daftar broadcast yang sudah dikirim.
create or replace function public.admin_list_broadcasts(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'message', b.message,
      'sentBy', b.sent_by,
      'sentAt', b.sent_at,
      'status', b.status,
      'response', b.response,
      'createdAt', b.created_at
    ) order by b.sent_at desc)
    from (
      select * from public.broadcast_messages
      order by sent_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) b
  ), '[]'::jsonb);
end $$;

-- Admin: catat broadcast baru (dipanggil oleh Vercel function
-- setelah mengirim ke game server, BUKAN dari frontend langsung).
create or replace function public.admin_log_broadcast(
  p_message text,
  p_status text default 'pending',
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.gt_require_admin();

  if btrim(coalesce(p_message, '')) = '' then
    raise exception 'GT:INVALID_MESSAGE';
  end if;

  if coalesce(p_status, 'pending') not in ('pending', 'sent', 'failed') then
    raise exception 'GT:INVALID_STATUS';
  end if;

  insert into public.broadcast_messages (message, sent_by, status, response)
  values (
    btrim(p_message),
    auth.uid(),
    coalesce(p_status, 'pending'),
    p_response
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Admin: update status broadcast (setelah Vercel function mendapat respons).
create or replace function public.admin_update_broadcast_status(
  p_id uuid,
  p_status text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.gt_require_admin();

  if coalesce(p_status, '') not in ('pending', 'sent', 'failed') then
    raise exception 'GT:INVALID_STATUS';
  end if;

  update public.broadcast_messages set
    status   = p_status,
    response = coalesce(p_response, response)
  where id = p_id;

  if not found then
    raise exception 'GT:NOT_FOUND';
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- --------------------------------------------------
-- 4. REALTIME (untuk admin dashboard order updates)
-- --------------------------------------------------
-- Supabase Realtime mendengarkan perubahan di tabel orders
-- sehingga admin dashboard bisa update secara real-time
-- tanpa polling.

do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

-- --------------------------------------------------
-- FUNCTION PRIVILEGES
-- --------------------------------------------------

-- Changelog
revoke all on function public.list_changelog(integer)                              from public;
revoke all on function public.admin_list_changelog()                               from public, anon;
revoke all on function public.admin_upsert_changelog(uuid, text, text, text, text, date, boolean) from public, anon;
revoke all on function public.admin_delete_changelog(uuid)                         from public, anon;

grant execute on function public.list_changelog(integer)                           to anon, authenticated;
grant execute on function public.admin_list_changelog()                            to authenticated;
grant execute on function public.admin_upsert_changelog(uuid, text, text, text, text, date, boolean) to authenticated;
grant execute on function public.admin_delete_changelog(uuid)                      to authenticated;

-- Blacklist
revoke all on function public.check_blacklist(text)                                from public;
revoke all on function public.list_blacklist(integer, integer, text)               from public;
revoke all on function public.admin_list_blacklist()                               from public, anon;
revoke all on function public.admin_add_blacklist(text, text)                      from public, anon;
revoke all on function public.admin_update_blacklist(uuid, text, boolean)          from public, anon;
revoke all on function public.admin_remove_blacklist(uuid)                         from public, anon;

grant execute on function public.check_blacklist(text)                             to anon, authenticated;
grant execute on function public.list_blacklist(integer, integer, text)            to anon, authenticated;
grant execute on function public.admin_list_blacklist()                            to authenticated;
grant execute on function public.admin_add_blacklist(text, text)                   to authenticated;
grant execute on function public.admin_update_blacklist(uuid, text, boolean)       to authenticated;
grant execute on function public.admin_remove_blacklist(uuid)                      to authenticated;

-- Broadcast
revoke all on function public.admin_list_broadcasts(integer)                       from public, anon;
revoke all on function public.admin_log_broadcast(text, text, text)                from public, anon;
revoke all on function public.admin_update_broadcast_status(uuid, text, text)      from public, anon;

grant execute on function public.admin_list_broadcasts(integer)                    to authenticated;
grant execute on function public.admin_log_broadcast(text, text, text)             to authenticated;
grant execute on function public.admin_update_broadcast_status(uuid, text, text)   to authenticated;
