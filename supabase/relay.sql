-- 8棒接力:公开多人版的资料表与函数
-- 用法:Supabase 后台 → SQL Editor → New query → 整段贴上 → Run。重跑也安全。
-- 网页只能呼叫下面的函数,不能直接读写资料表;AI 那一棒存在 relay_secret,只有主办方函数读得到。

create table if not exists public.relay_slots (
  n          int primary key check (n between 1 and 8),
  device     text check (device is null or char_length(device) between 3 and 40),
  claimed_at timestamptz,
  last_at    timestamptz,
  px         text check (px is null or px ~ '^[0-9a-f]{3072}$'),
  done_at    timestamptz
);
insert into public.relay_slots (n) select g from generate_series(1, 8) g on conflict do nothing;

create table if not exists public.relay_secret (
  id int primary key default 1 check (id = 1),
  ai_slot int not null check (ai_slot between 2 and 7)
);
create table if not exists public.relay_meta (
  id int primary key default 1 check (id = 1),
  revealed boolean not null default false,
  ai_slot int
);
insert into public.relay_meta (id) values (1) on conflict do nothing;

create table if not exists public.relay_votes (
  device  text primary key check (char_length(device) between 8 and 40),
  r       jsonb not null,
  g       int not null check (g between 1 and 8),
  c       int check (c between 1 and 3),
  pre     int check (pre between 1 and 5),
  ar      boolean not null default false,
  rr      int check (rr between 1 and 5),
  post    int check (post between 1 and 5),
  at      timestamptz not null default now(),
  post_at timestamptz
);
create table if not exists public.relay_notes (
  id     bigint generated always as identity primary key,
  device text not null,
  t      text not null check (char_length(t) between 1 and 140),
  at     timestamptz not null default now()
);
create table if not exists public.relay_host (token_hash text primary key);

alter table public.relay_slots  enable row level security;
alter table public.relay_secret enable row level security;
alter table public.relay_meta   enable row level security;
alter table public.relay_votes  enable row level security;
alter table public.relay_notes  enable row level security;
alter table public.relay_host   enable row level security;
revoke all on public.relay_slots, public.relay_secret, public.relay_meta, public.relay_votes, public.relay_notes, public.relay_host from anon, authenticated;

create or replace function public.relay_is_host(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_token is not null and exists (
    select 1 from relay_host where token_hash = encode(digest(p_token, 'sha256'), 'hex'));
$$;

create or replace function public.relay_state(p_device text, p_token text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slots', (select coalesce(jsonb_agg(jsonb_build_object(
        'n', n, 'px', coalesce(px, ''), 'mine', device is not distinct from p_device,
        'busy', px is null and device is not null and (device = 'ORG' or last_at > now() - interval '30 minutes'),
        'mineAt', case when device = p_device then (extract(epoch from claimed_at) * 1000)::bigint end
      ) order by n), '[]'::jsonb) from relay_slots),
    'meta', (select jsonb_build_object('revealed', revealed, 'aiSlot', case when revealed then ai_slot end) from relay_meta where id = 1),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object(
        'r', r, 'g', g, 'c', c, 'pre', pre, 'ar', ar, 'rr', rr, 'post', post, 'me', device = p_device)), '[]'::jsonb) from relay_votes),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'at', (extract(epoch from at) * 1000)::bigint) order by at), '[]'::jsonb) from relay_notes),
    'host', case when relay_is_host(p_token) then jsonb_build_object('aiSlot', (select ai_slot from relay_secret where id = 1)) end
  );
$$;

-- 领取一棒:上一棒画完才能领;一台装置只能画一棒(主办方除外);30分钟没落笔的棒可被接手
create or replace function public.relay_claim(p_device text, p_n int, p_token text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare s relay_slots;
begin
  if p_n < 1 or p_n > 8 or char_length(p_device) not between 8 and 40 then raise exception 'bad_input'; end if;
  if not relay_is_host(p_token) and exists (select 1 from relay_slots where device = p_device and px is not null) then
    raise exception 'already_drew'; end if;
  if p_n > 1 and not exists (select 1 from relay_slots where n = p_n - 1 and px is not null) then raise exception 'not_ready'; end if;
  select * into s from relay_slots where n = p_n for update;
  if s.px is not null or s.device = 'ORG' then raise exception 'taken'; end if;
  if s.device is not null and s.device <> p_device and s.last_at > now() - interval '30 minutes' then raise exception 'taken'; end if;
  update relay_slots set device = p_device, claimed_at = now(), last_at = now() where n = p_n;
  return true;
end $$;

create or replace function public.relay_beat(p_device text, p_n int) returns void
language sql security definer set search_path = public as $$
  update relay_slots set last_at = now() where n = p_n and device = p_device and px is null;
$$;

create or replace function public.relay_submit(p_device text, p_n int, p_px text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update relay_slots set px = p_px, done_at = now(), last_at = now()
   where n = p_n and device = p_device and px is null;
  if not found then raise exception 'lost'; end if;
  return true;
end $$;

-- 投票:8棒都画完才开放;每台装置一票,交出后不能改
create or replace function public.relay_vote(p_device text, p_r jsonb, p_g int, p_c int, p_pre int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if char_length(p_device) not between 8 and 40 then raise exception 'bad_input'; end if;
  if (select count(*) from relay_slots where px is not null) < 8 then raise exception 'not_ready'; end if;
  if (select count(*) from jsonb_each_text(p_r) where key ~ '^[1-8]$' and value ~ '^[1-5]$') <> 8 then raise exception 'bad_input'; end if;
  insert into relay_votes (device, r, g, c, pre, ar)
  values (p_device, p_r, p_g, p_c, p_pre, (select revealed from relay_meta where id = 1))
  on conflict (device) do nothing;
  if not found then raise exception 'already_voted'; end if;
  return true;
end $$;

-- 揭晓后两题:只能答一次
create or replace function public.relay_post(p_device text, p_rr int, p_post int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not (select revealed from relay_meta where id = 1) then raise exception 'not_revealed'; end if;
  update relay_votes set rr = p_rr, post = p_post, post_at = now() where device = p_device and post is null;
  if not found then raise exception 'not_allowed'; end if;
  return true;
end $$;

-- 留言:交过猜测才能留;每台装置最多20则,10秒内只能一则
create or replace function public.relay_note(p_device text, p_t text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from relay_votes where device = p_device) then raise exception 'not_allowed'; end if;
  if exists (select 1 from relay_notes where device = p_device and at > now() - interval '10 seconds') then raise exception 'rate_limited'; end if;
  if (select count(*) from relay_notes where device = p_device) >= 20 then raise exception 'too_many'; end if;
  insert into relay_notes (device, t) values (p_device, trim(p_t));
  return true;
end $$;

-- 以下是主办方函数,要带正确的密语
create or replace function public.relay_reserve(p_token text, p_n int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  if p_n not between 2 and 7 or exists (select 1 from relay_secret) then raise exception 'bad_input'; end if;
  update relay_slots set device = 'ORG', claimed_at = now(), last_at = now() where n = p_n and device is null and px is null;
  if not found then raise exception 'taken'; end if;
  insert into relay_secret (id, ai_slot) values (1, p_n);
  return true;
end $$;

create or replace function public.relay_upload(p_token text, p_px text) returns boolean
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  select ai_slot into k from relay_secret where id = 1;
  if k is null or not exists (select 1 from relay_slots where n = k - 1 and px is not null) then raise exception 'not_ready'; end if;
  update relay_slots set px = p_px, done_at = now(), last_at = now() where n = k and px is null;
  return found;
end $$;

create or replace function public.relay_reveal(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  if (select count(*) from relay_slots where px is not null) < 8 then raise exception 'not_ready'; end if;
  update relay_meta set revealed = true, ai_slot = (select ai_slot from relay_secret where id = 1) where id = 1;
  return true;
end $$;

create or replace function public.relay_release(p_token text, p_n int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  update relay_slots set device = null, claimed_at = null, last_at = null where n = p_n and px is null and device <> 'ORG';
  return found;
end $$;

create or replace function public.relay_reset(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  update relay_slots set device = null, claimed_at = null, last_at = null, px = null, done_at = null where true;
  delete from relay_votes where true;
  delete from relay_notes where true;
  delete from relay_secret where true;
  update relay_meta set revealed = false, ai_slot = null where id = 1;
  return true;
end $$;

revoke all on function public.relay_is_host(text) from public, anon, authenticated;
grant execute on function
  public.relay_state(text, text), public.relay_claim(text, int, text), public.relay_beat(text, int),
  public.relay_submit(text, int, text), public.relay_vote(text, jsonb, int, int, int), public.relay_post(text, int, int),
  public.relay_note(text, text), public.relay_reserve(text, int), public.relay_upload(text, text),
  public.relay_reveal(text), public.relay_release(text, int), public.relay_reset(text)
to anon, authenticated;

-- 最后一步(只做一次,不要存进 GitHub):把下面的「换成你自己的密语」改掉再执行。
-- insert into public.relay_host values (encode(extensions.digest('换成你自己的密语', 'sha256'), 'hex'));
