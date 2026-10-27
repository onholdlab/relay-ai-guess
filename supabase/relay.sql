-- 8棒接力:公开多人版的资料表与函数(多卷版)
-- 用法:Supabase 后台 → SQL Editor → New query → 整段贴上 → Run。重跑也安全,旧资料会自动变成「第1卷」。
-- 网页只能呼叫下面的函数,不能直接读写资料表;AI 那一棒存在 relay_secret,只有主办方函数读得到。

-- ===== 资料表 =====
create table if not exists public.relay_scrolls (
  id         int primary key,
  created_at timestamptz not null default now(),
  opened_by  text,
  revealed   boolean not null default false,
  ai_slot    int,           -- 揭晓后才填
  done_at    timestamptz    -- 8 棒都画完的时间
);
insert into public.relay_scrolls (id) values (1) on conflict do nothing;

create table if not exists public.relay_slots (
  scroll     int not null default 1,
  n          int not null check (n between 1 and 8),
  device     text check (device is null or char_length(device) between 3 and 40),
  claimed_at timestamptz,
  last_at    timestamptz,
  px         text,
  done_at    timestamptz,
  primary key (scroll, n)
);
alter table public.relay_slots add column if not exists scroll int not null default 1;
-- 像素检查:Postgres 正则最多只能重复255次,旧版的 {3072} 会让交出失败,改成长度+字元检查
alter table public.relay_slots drop constraint if exists relay_slots_px_check;
alter table public.relay_slots add constraint relay_slots_px_check check (px is null or (char_length(px) = 3072 and px ~ '^[0-9a-f]+$'));

create table if not exists public.relay_secret (
  scroll    int primary key default 1,
  ai_slot   int not null check (ai_slot between 2 and 7)
);
alter table public.relay_secret add column if not exists scroll int not null default 1;
alter table public.relay_secret add column if not exists ops jsonb;
alter table public.relay_secret add column if not exists model text;
alter table public.relay_secret add column if not exists locked_at timestamptz;

create table if not exists public.relay_votes (
  scroll  int not null default 1,
  device  text not null check (char_length(device) between 8 and 40),
  r       jsonb not null,
  g       int not null check (g between 1 and 8),
  c       int check (c between 1 and 3),
  pre     int check (pre between 1 and 5),
  ar      boolean not null default false,
  rr      int check (rr between 1 and 5),
  post    int check (post between 1 and 5),
  at      timestamptz not null default now(),
  post_at timestamptz,
  primary key (scroll, device)
);
alter table public.relay_votes add column if not exists scroll int not null default 1;
alter table public.relay_votes add column if not exists n_done int;

create table if not exists public.relay_notes (
  id     bigint generated always as identity primary key,
  device text not null,
  t      text not null check (char_length(t) between 1 and 140),
  at     timestamptz not null default now()
);
alter table public.relay_notes add column if not exists scroll int not null default 1;
create table if not exists public.relay_host (token_hash text primary key);

-- 旧版(单卷)升级:主键改成「卷 + 棒」,旧资料都归第1卷
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'public.relay_slots'::regclass and contype = 'p' and array_length(conkey, 1) = 1) then
    alter table public.relay_slots drop constraint relay_slots_pkey;
    alter table public.relay_slots add primary key (scroll, n);
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.relay_votes'::regclass and contype = 'p' and array_length(conkey, 1) = 1) then
    alter table public.relay_votes drop constraint relay_votes_pkey;
    alter table public.relay_votes add primary key (scroll, device);
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.relay_secret'::regclass and attname = 'id' and not attisdropped) then
    alter table public.relay_secret drop constraint if exists relay_secret_pkey;
    alter table public.relay_secret drop column id;
    alter table public.relay_secret add primary key (scroll);
  end if;
  if to_regclass('public.relay_meta') is not null then
    update public.relay_scrolls s set revealed = true, ai_slot = m.ai_slot
      from public.relay_meta m where s.id = 1 and m.id = 1 and m.revealed and not s.revealed;
    drop table public.relay_meta;
  end if;
end $$;
insert into public.relay_slots (scroll, n) select 1, g from generate_series(1, 8) g on conflict do nothing;
update public.relay_scrolls s set done_at = (select max(done_at) from public.relay_slots where scroll = s.id)
 where done_at is null and (select count(*) from public.relay_slots where scroll = s.id and px is not null) = 8;
create index if not exists relay_notes_scroll on public.relay_notes (scroll, at);
-- 第1卷如果还没设AI那一棒,从还没人领的第2到7棒里随机挑一棒
do $$ declare k int; begin
  if not exists (select 1 from public.relay_secret where scroll = 1) then
    select n into k from public.relay_slots where scroll = 1 and n between 2 and 7 and device is null and px is null order by random() limit 1;
    if k is not null then
      update public.relay_slots set device = 'ORG', claimed_at = now(), last_at = now() where scroll = 1 and n = k;
      insert into public.relay_secret (scroll, ai_slot) values (1, k);
    end if;
  end if;
end $$;

alter table public.relay_scrolls enable row level security;
alter table public.relay_slots   enable row level security;
alter table public.relay_secret  enable row level security;
alter table public.relay_votes   enable row level security;
alter table public.relay_notes   enable row level security;
alter table public.relay_host    enable row level security;
revoke all on public.relay_scrolls, public.relay_slots, public.relay_secret, public.relay_votes, public.relay_notes, public.relay_host from anon, authenticated;

-- 旧版函数(参数不同)先移除,避免同名函数打架
drop function if exists public.relay_state(text, text);
drop function if exists public.relay_claim(text, int, text);
drop function if exists public.relay_beat(text, int);
drop function if exists public.relay_submit(text, int, text);
drop function if exists public.relay_vote(text, jsonb, int, int, int);
drop function if exists public.relay_post(text, int, int);
drop function if exists public.relay_note(text, text);
drop function if exists public.relay_reserve(text, int);
drop function if exists public.relay_upload(text, text);
drop function if exists public.relay_upload_strokes(text, text, jsonb);
drop function if exists public.relay_reveal(text);
drop function if exists public.relay_release(text, int);

-- ===== 共用规则 =====
create or replace function public.relay_is_host(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_token is not null and exists (
    select 1 from relay_host where token_hash = encode(digest(p_token, 'sha256'), 'hex'));
$$;

-- 这台装置在这一卷现在能领哪一棒(0 = 没有)。上一棒画完才能领;一卷只能画一棒;24小时没落笔的棒可被接手
create or replace function public.relay_takeable(p_scroll int, p_device text) returns int
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from relay_slots where scroll = p_scroll and device = p_device and px is not null) then 0
  else coalesce((select x.n from relay_slots x where x.scroll = p_scroll and x.px is null
    and (x.n = 1 or exists (select 1 from relay_slots p where p.scroll = p_scroll and p.n = x.n - 1 and p.px is not null))
    and (x.device is null or (x.device <> 'ORG' and x.last_at < now() - interval '24 hours'))
    order by x.n limit 1), 0) end;
$$;

-- 画完一棒后:8棒都画完就记下完成时间
create or replace function public.relay_after_px(p_scroll int) returns void
language sql security definer set search_path = public as $$
  update relay_scrolls set done_at = now() where id = p_scroll and done_at is null
    and (select count(*) from relay_slots where scroll = p_scroll and px is not null) = 8;
$$;

-- ===== 读取:每5秒轮询;资料没变时只回 {same:true},省流量 =====
create or replace function public.relay_state(p_device text, p_token text default null, p_scroll int default null, p_v text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare sc int; v text; my record; host boolean := relay_is_host(p_token);
begin
  -- 8棒画完24小时后自动揭晓
  update relay_scrolls s set revealed = true, ai_slot = (select ai_slot from relay_secret where scroll = s.id)
   where not revealed and done_at < now() - interval '24 hours' and exists (select 1 from relay_secret where scroll = s.id);

  select scroll, n, claimed_at into my from relay_slots
   where device = p_device and px is null and last_at > now() - interval '24 hours' order by claimed_at desc limit 1;
  sc := coalesce(
    (select id from relay_scrolls where id = p_scroll),
    my.scroll,
    (select id from relay_scrolls where done_at is null and relay_takeable(id, p_device) > 0 order by id limit 1),
    (select max(id) from relay_scrolls));

  v := md5(concat_ws('|', sc, host, floor(extract(epoch from now()) / 3600),
    (select concat_ws(',', count(*), count(px), max(claimed_at), max(done_at), count(device)) from relay_slots),
    (select concat_ws(',', count(*), max(at), max(post_at)) from relay_votes),
    (select concat_ws(',', count(*), max(at)) from relay_notes),
    (select string_agg(id || ':' || revealed, ',' order by id) from relay_scrolls)));
  if p_v = v then return jsonb_build_object('same', true, 'v', v); end if;

  return jsonb_build_object(
    'v', v, 'scroll', sc,
    'scrolls', (select jsonb_agg(jsonb_build_object('id', id, 'done', (select count(px) from relay_slots where scroll = s.id),
        'revealed', revealed, 'finished', done_at is not null) order by id) from relay_scrolls s),
    'drawScroll', (select id from relay_scrolls where done_at is null and relay_takeable(id, p_device) > 0 order by id limit 1),
    'my', case when my.scroll is not null then jsonb_build_object('scroll', my.scroll, 'n', my.n, 'at', (extract(epoch from my.claimed_at) * 1000)::bigint) end,
    'canOpen', my.scroll is null
      and not exists (select 1 from relay_scrolls where done_at is null and relay_takeable(id, p_device) > 0)
      and (select count(*) from relay_scrolls where done_at is null) < 3,
    'slots', (select coalesce(jsonb_agg(jsonb_build_object(
        'n', x.n, 'px', coalesce(x.px, ''), 'mine', x.device is not distinct from p_device,
        'busy', x.px is null and x.device is not null and (
          (x.device = 'ORG' and (x.n = 1 or exists (select 1 from relay_slots p where p.scroll = sc and p.n = x.n - 1 and p.px is not null)))
          or (x.device <> 'ORG' and x.last_at > now() - interval '24 hours')),
        'mineAt', case when x.device = p_device then (extract(epoch from x.claimed_at) * 1000)::bigint end
      ) order by x.n), '[]'::jsonb) from relay_slots x where x.scroll = sc),
    'meta', (select jsonb_build_object('revealed', revealed, 'aiSlot', case when revealed then ai_slot end,
        'aiOps', case when revealed then (select ops from relay_secret where scroll = sc) end) from relay_scrolls where id = sc),
    'votes', (select coalesce(jsonb_agg(jsonb_build_object(
        'r', r, 'g', g, 'c', c, 'pre', pre, 'ar', ar, 'nd', n_done, 'rr', rr, 'post', post, 'me', device = p_device)), '[]'::jsonb)
        from relay_votes where scroll = sc),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'at', (extract(epoch from at) * 1000)::bigint) order by at), '[]'::jsonb)
        from relay_notes where scroll = sc),
    'host', case when host then jsonb_build_object('aiSlot', (select ai_slot from relay_secret where scroll = sc)) end
  );
end $$;

-- ===== 玩家 =====
-- 开下一卷:只有在所有进行中的卷都没有你能领的棒时才能开;同时最多3卷没画完。AI 那一棒随机放在第2到7棒
create or replace function public.relay_open(p_device text) returns int
language plpgsql security definer set search_path = public as $$
declare nid int; k int;
begin
  if char_length(p_device) not between 8 and 40 then raise exception 'bad_input'; end if;
  perform pg_advisory_xact_lock(81888);
  if exists (select 1 from relay_slots where device = p_device and px is null and last_at > now() - interval '24 hours') then raise exception 'has_claim'; end if;
  if exists (select 1 from relay_scrolls where done_at is null and relay_takeable(id, p_device) > 0) then raise exception 'not_full'; end if;
  if (select count(*) from relay_scrolls where done_at is null) >= 3 then raise exception 'too_many'; end if;
  select coalesce(max(id), 0) + 1 into nid from relay_scrolls;
  k := 2 + floor(random() * 6)::int;
  insert into relay_scrolls (id, opened_by) values (nid, p_device);
  insert into relay_slots (scroll, n) select nid, g from generate_series(1, 8) g;
  update relay_slots set device = 'ORG', claimed_at = now(), last_at = now() where scroll = nid and n = k;
  insert into relay_secret (scroll, ai_slot) values (nid, k);
  return nid;
end $$;

create or replace function public.relay_claim(p_device text, p_scroll int, p_n int, p_token text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare host boolean := relay_is_host(p_token);
begin
  if p_n < 1 or p_n > 8 or char_length(p_device) not between 8 and 40 then raise exception 'bad_input'; end if;
  perform 1 from relay_slots where scroll = p_scroll and n = p_n for update;
  if not found then raise exception 'bad_input'; end if;
  if host then
    if p_n > 1 and not exists (select 1 from relay_slots where scroll = p_scroll and n = p_n - 1 and px is not null) then raise exception 'not_ready'; end if;
    if exists (select 1 from relay_slots where scroll = p_scroll and n = p_n and (px is not null or device = 'ORG'
      or (device is not null and device <> p_device and last_at > now() - interval '24 hours'))) then raise exception 'taken'; end if;
  else
    if exists (select 1 from relay_slots where device = p_device and px is null and last_at > now() - interval '24 hours'
      and not (scroll = p_scroll and n = p_n)) then raise exception 'has_claim'; end if;
    if exists (select 1 from relay_slots where scroll = p_scroll and n = p_n and device = p_device and px is null) then return true; end if;
    if relay_takeable(p_scroll, p_device) <> p_n then raise exception 'taken'; end if;
  end if;
  update relay_slots set device = p_device, claimed_at = now(), last_at = now() where scroll = p_scroll and n = p_n;
  return true;
end $$;

create or replace function public.relay_beat(p_device text, p_scroll int, p_n int) returns void
language sql security definer set search_path = public as $$
  update relay_slots set last_at = now() where scroll = p_scroll and n = p_n and device = p_device and px is null;
$$;

create or replace function public.relay_submit(p_device text, p_scroll int, p_n int, p_px text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update relay_slots set px = p_px, done_at = now(), last_at = now()
   where scroll = p_scroll and n = p_n and device = p_device and px is null;
  if not found then raise exception 'lost'; end if;
  perform relay_after_px(p_scroll);
  return true;
end $$;

-- 投票:第1棒画完就开放;要给所有已画完的棒评分,只能猜已画完的棒;
-- 揭晓前可以一直改(记下改的时候画完几棒),揭晓后才交的票标成 ar,只能交一次
create or replace function public.relay_vote(p_device text, p_scroll int, p_r jsonb, p_g int, p_c int, p_pre int) returns boolean
language plpgsql security definer set search_path = public as $$
declare d int; ok int; rev boolean;
begin
  if char_length(p_device) not between 8 and 40 then raise exception 'bad_input'; end if;
  select revealed into rev from relay_scrolls where id = p_scroll;
  if not found then raise exception 'bad_input'; end if;
  select count(*) into d from relay_slots where scroll = p_scroll and px is not null;
  if d < 1 then raise exception 'not_ready'; end if;
  if not exists (select 1 from relay_slots where scroll = p_scroll and n = p_g and px is not null) then raise exception 'bad_input'; end if;
  select count(*) into ok from jsonb_each_text(p_r) e join relay_slots s on s.scroll = p_scroll and s.n::text = e.key and s.px is not null where e.value ~ '^[1-5]$';
  if ok <> d then raise exception 'bad_input'; end if;
  if rev then
    insert into relay_votes (scroll, device, r, g, c, pre, ar, n_done) values (p_scroll, p_device, p_r, p_g, p_c, p_pre, true, d)
    on conflict (scroll, device) do nothing;
    if not found then raise exception 'already_voted'; end if;
  else
    insert into relay_votes (scroll, device, r, g, c, pre, ar, n_done) values (p_scroll, p_device, p_r, p_g, p_c, p_pre, false, d)
    on conflict (scroll, device) do update set r = excluded.r, g = excluded.g, c = excluded.c,
      pre = coalesce(relay_votes.pre, excluded.pre), n_done = excluded.n_done, at = now()
    where relay_votes.ar = false;
  end if;
  return true;
end $$;

-- 揭晓后两题:只能答一次
create or replace function public.relay_post(p_device text, p_scroll int, p_rr int, p_post int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select revealed from relay_scrolls where id = p_scroll), false) then raise exception 'not_revealed'; end if;
  update relay_votes set rr = p_rr, post = p_post, post_at = now() where scroll = p_scroll and device = p_device and post is null;
  if not found then raise exception 'not_allowed'; end if;
  return true;
end $$;

-- 留言:在这一卷交过猜测才能留;每台装置每卷最多20则,10秒内只能一则
create or replace function public.relay_note(p_device text, p_scroll int, p_t text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from relay_votes where scroll = p_scroll and device = p_device) then raise exception 'not_allowed'; end if;
  if exists (select 1 from relay_notes where device = p_device and at > now() - interval '10 seconds') then raise exception 'rate_limited'; end if;
  if (select count(*) from relay_notes where scroll = p_scroll and device = p_device) >= 20 then raise exception 'too_many'; end if;
  insert into relay_notes (scroll, device, t) values (p_scroll, p_device, trim(p_t));
  return true;
end $$;

-- ===== 主办方(要带正确的密语) =====
create or replace function public.relay_reserve(p_token text, p_scroll int, p_n int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  if p_n not between 2 and 7 or exists (select 1 from relay_secret where scroll = p_scroll) then raise exception 'bad_input'; end if;
  update relay_slots set device = 'ORG', claimed_at = now(), last_at = now() where scroll = p_scroll and n = p_n and device is null and px is null;
  if not found then raise exception 'taken'; end if;
  insert into relay_secret (scroll, ai_slot) values (p_scroll, p_n);
  return true;
end $$;

create or replace function public.relay_upload(p_token text, p_scroll int, p_px text) returns boolean
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  select ai_slot into k from relay_secret where scroll = p_scroll;
  if k is null or not exists (select 1 from relay_slots where scroll = p_scroll and n = k - 1 and px is not null) then raise exception 'not_ready'; end if;
  update relay_slots set px = p_px, done_at = now(), last_at = now() where scroll = p_scroll and n = k and px is null;
  if not found then return false; end if;
  perform relay_after_px(p_scroll);
  return true;
end $$;

-- 手動版:主辦方把聊天裡 Claude 給的筆畫貼進網頁,網頁執行後連同筆畫一起上傳
create or replace function public.relay_upload_strokes(p_token text, p_scroll int, p_px text, p_ops jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  select ai_slot into k from relay_secret where scroll = p_scroll;
  if k is null or not exists (select 1 from relay_slots where scroll = p_scroll and n = k - 1 and px is not null) then raise exception 'not_ready'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 300 then raise exception 'bad_input'; end if;
  update relay_slots set px = p_px, done_at = now(), last_at = now() where scroll = p_scroll and n = k and px is null;
  if not found then raise exception 'already_done'; end if;
  update relay_secret set ops = p_ops, model = 'chat' where scroll = p_scroll;
  perform relay_after_px(p_scroll);
  return true;
end $$;

-- 提前揭晓(不按的话,8棒画完24小时后会自动揭晓)
create or replace function public.relay_reveal(p_token text, p_scroll int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  if (select count(*) from relay_slots where scroll = p_scroll and px is not null) < 8 then raise exception 'not_ready'; end if;
  update relay_scrolls set revealed = true, ai_slot = (select ai_slot from relay_secret where scroll = p_scroll) where id = p_scroll;
  return true;
end $$;

create or replace function public.relay_release(p_token text, p_scroll int, p_n int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  update relay_slots set device = null, claimed_at = null, last_at = null where scroll = p_scroll and n = p_n and px is null and device <> 'ORG';
  return found;
end $$;

-- 清空全部(所有卷),回到只有空白第1卷
create or replace function public.relay_reset(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare k int;
begin
  if not relay_is_host(p_token) then raise exception 'not_host'; end if;
  delete from relay_slots where true;
  delete from relay_votes where true;
  delete from relay_notes where true;
  delete from relay_secret where true;
  delete from relay_scrolls where true;
  insert into relay_scrolls (id) values (1);
  insert into relay_slots (scroll, n) select 1, g from generate_series(1, 8) g;
  k := 2 + floor(random() * 6)::int;
  update relay_slots set device = 'ORG', claimed_at = now(), last_at = now() where scroll = 1 and n = k;
  insert into relay_secret (scroll, ai_slot) values (1, k);
  return true;
end $$;

revoke all on function public.relay_is_host(text), public.relay_takeable(int, text), public.relay_after_px(int) from public, anon, authenticated;
grant execute on function
  public.relay_state(text, text, int, text), public.relay_open(text), public.relay_claim(text, int, int, text), public.relay_beat(text, int, int),
  public.relay_submit(text, int, int, text), public.relay_vote(text, int, jsonb, int, int, int), public.relay_post(text, int, int, int),
  public.relay_note(text, int, text), public.relay_reserve(text, int, int), public.relay_upload(text, int, text),
  public.relay_upload_strokes(text, int, text, jsonb), public.relay_reveal(text, int), public.relay_release(text, int, int), public.relay_reset(text)
to anon, authenticated;

-- 最后一步(只做一次,不要存进 GitHub):把下面的「换成你自己的密语」改掉再执行。
-- insert into public.relay_host values (encode(extensions.digest('换成你自己的密语', 'sha256'), 'hex'));
