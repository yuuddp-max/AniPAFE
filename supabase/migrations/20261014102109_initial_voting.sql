-- Dedicated AniPAFE project only. No access to existing projects is needed.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100 and display_name !~ '^[[:space:]　]*$'),
  nico_user_id text not null unique check (nico_user_id ~ '^(0|[1-9][0-9]{0,29})$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.videos (
  video_id text primary key check (video_id ~ '^(sm|so|nm)[0-9]+$'),
  display_order integer not null check (display_order > 0),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  author_nico_user_id text not null check (author_nico_user_id ~ '^(0|[1-9][0-9]{0,29})$'),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 100),
  theme text check (theme is null or (char_length(btrim(theme)) between 1 and 500 and theme !~ '^[[:space:]　]*$')),
  watch_url text not null check (watch_url = 'https://www.nicovideo.jp/watch/' || video_id),
  thumbnail_url text check (thumbnail_url is null or thumbnail_url ~ '^https://([a-zA-Z0-9-]+\.)*(nicovideo\.jp|nimg\.jp)/'),
  posted_at date, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.award_types (
  code text primary key, name text not null, min_votes integer not null check (min_votes > 0),
  max_votes integer not null check (max_votes >= min_votes), display_order integer not null unique
);
insert into public.award_types values
  ('overall','総合賞',5,10,1), ('music','選曲賞',1,3,2), ('composition','構成賞',1,3,3),
  ('creative','クリエイティブ賞',1,3,4), ('humor','諧謔賞',1,3,5), ('theme','テーマ賞',1,3,6);
create table public.ballots (
  id uuid primary key default gen_random_uuid(), voter_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','submitted')),
  revision integer not null default 0, submitted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status = 'submitted') = (submitted_at is not null))
);
create table public.ballot_entries (
  id uuid primary key default gen_random_uuid(), ballot_id uuid not null references public.ballots(id) on delete cascade,
  award_code text not null references public.award_types(code), video_id text not null references public.videos(video_id),
  comment text check (char_length(comment) <= 1000), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (ballot_id, award_code, video_id)
);
create index ballot_entries_video_idx on public.ballot_entries(video_id);
create table public.poll_settings (
  id integer primary key check (id = 1), starts_at timestamptz, ends_at timestamptz,
  is_published boolean not null default false, results_public boolean not null default false,
  master_revision integer not null default 0,
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (not is_published or (starts_at is not null and ends_at is not null))
);
insert into public.poll_settings (id) values (1);
create table public.admin_users (auth_user_id uuid primary key references auth.users(id) on delete cascade);
create table public.audit_logs (
  id bigint generated always as identity primary key, actor uuid references auth.users(id),
  action text not null, target text, summary jsonb not null default '{}', created_at timestamptz not null default now()
);

-- All writers take the same event lock, including master imports and profile changes.
-- This small event favors correctness and serializable master/ballot interactions.
create function private.is_google() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from auth.identities where user_id = auth.uid() and provider = 'google')
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_google() and exists(select 1 from public.admin_users where auth_user_id = auth.uid())
$$;
create function private.require_user() returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_google() then raise exception 'Googleログインが必要です。' using errcode = '42501'; end if;
  return auth.uid();
end $$;
create function private.require_admin() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception '運営者権限が必要です。' using errcode = '42501'; end if;
end $$;
create function private.require_open() returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.poll_settings where id = 1 and is_published and starts_at <= now() and now() < ends_at)
  then raise exception '現在は投票期間外です。'; end if;
end $$;

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.award_types enable row level security;
alter table public.ballots enable row level security;
alter table public.ballot_entries enable row level security;
alter table public.poll_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.audit_logs enable row level security;
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.videos, public.award_types, public.ballots, public.ballot_entries, public.poll_settings, public.admin_users, public.audit_logs to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
create policy profiles_read on public.profiles for select to authenticated using (private.is_google() and (user_id = (select auth.uid()) or private.is_admin()));
create policy videos_read on public.videos for select to authenticated using (private.is_google() and (is_active or private.is_admin()));
create policy awards_read on public.award_types for select to authenticated using (private.is_google());
create policy ballots_read on public.ballots for select to authenticated using (private.is_google() and (voter_id = (select auth.uid()) or private.is_admin()));
create policy entries_read on public.ballot_entries for select to authenticated using (private.is_google() and exists(select 1 from public.ballots b where b.id = ballot_id and (b.voter_id = (select auth.uid()) or private.is_admin())));
create policy poll_read on public.poll_settings for select to authenticated using (private.is_google());
create policy admin_read on public.admin_users for select to authenticated using (private.is_google() and auth_user_id = (select auth.uid()));
create policy audit_read on public.audit_logs for select to authenticated using (private.is_admin());

create function private.validate_entries(p_uid uuid, p_entries jsonb, p_final boolean) returns void language plpgsql security definer set search_path = '' as $$
declare nico text; award_row record; n integer;
begin
  select nico_user_id into nico from public.profiles where user_id = p_uid;
  if nico is null then raise exception 'プロフィールを登録してください。'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception '投票形式が不正です。'; end if;
  if jsonb_array_length(p_entries) > 25 then raise exception '選択上限を超えています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object' or e->>'video_id' is null or e->>'award_code' is null or (e ? 'comment' and jsonb_typeof(e->'comment') not in ('string','null')) or char_length(e->>'comment') > 1000) then raise exception '投票内容または感想が不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'award_code', e->>'video_id' having count(*) > 1) then raise exception '同じ部門で作品が重複しています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e left join public.award_types a on a.code = e->>'award_code' left join public.videos v on v.video_id = e->>'video_id' where a.code is null or v.video_id is null or not v.is_active or v.author_nico_user_id = nico or (a.code = 'theme' and nullif(btrim(v.theme),'') is null)) then raise exception '自薦・無効な作品・テーマ未記入の作品には投票できません。'; end if;
  for award_row in select * from public.award_types loop
    select count(*) into n from jsonb_array_elements(p_entries) e where e->>'award_code' = award_row.code;
    if n > award_row.max_votes or (p_final and n < award_row.min_votes) then raise exception '%は%～%作品選択してください。', award_row.name, award_row.min_votes, award_row.max_votes; end if;
  end loop;
end $$;

create function private.save_profile(p_name text, p_nico text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; nico text; removed integer;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_name ~ '^[[:space:]　]*$' or p_nico is null or btrim(p_nico) !~ '^[0-9]{1,30}$' then raise exception 'ユーザー名と半角数字のニコニコユーザーIDを入力してください。'; end if;
  nico := coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  if exists(select 1 from public.ballots where voter_id = uid and status = 'submitted') and exists(select 1 from public.profiles where user_id = uid and nico_user_id <> nico) then raise exception '確定後はニコニコユーザーIDを変更できません。運営へお問い合わせください。'; end if;
  if exists(select 1 from public.profiles where nico_user_id = nico and user_id <> uid) then raise exception 'このニコニコユーザーIDは登録済みです。運営へお問い合わせください。'; end if;
  insert into public.profiles(user_id,display_name,nico_user_id) values(uid,btrim(p_name),nico) on conflict(user_id) do update set display_name = excluded.display_name, nico_user_id = excluded.nico_user_id, updated_at = now();
  insert into public.ballots(voter_id) values(uid) on conflict(voter_id) do nothing;
  delete from public.ballot_entries e using public.ballots b, public.videos v where e.ballot_id = b.id and b.voter_id = uid and b.status = 'draft' and e.video_id = v.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.ballots set revision = revision + 1, updated_at = now() where voter_id = uid and status = 'draft';
  return jsonb_build_object('removed',removed);
end $$;
create function public.save_profile(p_name text, p_nico text) returns jsonb language sql security invoker set search_path = '' as $$ select private.save_profile(p_name,p_nico) $$;

create function private.save_draft(p_entries jsonb, p_revision integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; b public.ballots;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1); perform private.require_open();
  select * into b from public.ballots where voter_id = uid for update;
  if b.id is null then raise exception 'プロフィールを登録してください。'; end if;
  if b.status <> 'draft' then raise exception '投票は確定済みです。'; end if;
  if p_revision is null or b.revision <> p_revision then raise exception '別の画面で内容が更新されました。再読み込みして確認してください。' using errcode = '40001'; end if;
  perform private.validate_entries(uid,p_entries,false);
  delete from public.ballot_entries where ballot_id = b.id;
  insert into public.ballot_entries(ballot_id,award_code,video_id,comment) select b.id,e->>'award_code',e->>'video_id',nullif(e->>'comment','') from jsonb_array_elements(p_entries) e;
  update public.ballots set revision = revision + 1, updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('revision',b.revision);
end $$;
create function public.save_draft(p_entries jsonb, p_revision integer) returns jsonb language sql security invoker set search_path = '' as $$ select private.save_draft(p_entries,p_revision) $$;

create function private.submit_ballot(p_revision integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; b public.ballots; entries jsonb;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1);
  select * into b from public.ballots where voter_id = uid for update;
  if b.id is null then raise exception '投票内容がありません。'; end if;
  -- Idempotent retry returns the existing receipt without changing any data.
  if b.status = 'submitted' then return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision); end if;
  perform private.require_open();
  if p_revision is null or b.revision <> p_revision then raise exception '投票内容が更新されました。確認画面を開き直してください。' using errcode = '40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('award_code',award_code,'video_id',video_id,'comment',comment)),'[]') into entries from public.ballot_entries where ballot_id = b.id;
  perform private.validate_entries(uid,entries,true);
  update public.ballots set status = 'submitted',submitted_at = now(),revision = revision + 1,updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision);
end $$;
create function public.submit_ballot(p_revision integer) returns jsonb language sql security invoker set search_path = '' as $$ select private.submit_ballot(p_revision) $$;

-- Shared master mutation. Votes are never deleted by upsert. Invalid drafts are pruned;
-- a change that would invalidate a submitted ballot is rejected until admin reopens it.
create function private.import_master(p_videos jsonb, p_expected integer) returns jsonb language plpgsql security definer set search_path = '' as $$
declare inserted integer; updated integer; removed integer; e record;
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_expected is null or p_expected <> (select master_revision from public.poll_settings where id = 1) then raise exception '作品マスターが更新されました。プレビューをやり直してください。' using errcode = '40001'; end if;
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' or jsonb_array_length(p_videos) not between 1 and 2000 then raise exception '作品データが不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_videos) v group by v->>'video_id' having count(*) > 1) then raise exception '作品IDが重複しています。'; end if;
  select count(*) into inserted from jsonb_array_elements(p_videos) v where not exists(select 1 from public.videos old where old.video_id = v->>'video_id');
  updated := jsonb_array_length(p_videos) - inserted;
  insert into public.videos(video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,posted_at,is_active)
  select v->>'video_id',(v->>'display_order')::integer,v->>'title',coalesce(nullif(ltrim(btrim(v->>'author_nico_user_id'),'0'),''),'0'),v->>'author_name',nullif(btrim(v->>'theme'),''),v->>'watch_url',(v->>'posted_at')::date,(v->>'is_active')::boolean from jsonb_array_elements(p_videos) v
  on conflict(video_id) do update set display_order = excluded.display_order,title = excluded.title,author_nico_user_id = excluded.author_nico_user_id,author_name = excluded.author_name,theme = excluded.theme,watch_url = excluded.watch_url,posted_at = excluded.posted_at,is_active = excluded.is_active,updated_at = now();
  for e in select b.voter_id, jsonb_agg(jsonb_build_object('award_code',be.award_code,'video_id',be.video_id,'comment',be.comment)) as entries from public.ballots b join public.ballot_entries be on be.ballot_id = b.id where b.status = 'submitted' group by b.id loop
    perform private.validate_entries(e.voter_id,e.entries,true);
  end loop;
  -- Advance draft revisions for every affected master update, so stale clients cannot restore invalid choices.
  update public.ballots set revision = revision + 1,updated_at = now() where status = 'draft' and exists(select 1 from public.ballot_entries be join jsonb_array_elements(p_videos) v on v->>'video_id' = be.video_id where be.ballot_id = ballots.id);
  delete from public.ballot_entries be using public.ballots b,public.videos v,public.profiles p where be.ballot_id = b.id and b.status = 'draft' and p.user_id = b.voter_id and be.video_id = v.video_id and (not v.is_active or v.author_nico_user_id = p.nico_user_id or (be.award_code = 'theme' and v.theme is null));
  get diagnostics removed = row_count;
  update public.poll_settings set master_revision = master_revision + 1 where id = 1;
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'import',jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed));
  return jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed);
end $$;
create function private.admin_import(p_videos jsonb,p_expected integer) returns jsonb language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(); return private.import_master(p_videos,p_expected); end $$;
create function public.admin_import(p_videos jsonb,p_expected integer) returns jsonb language sql security invoker set search_path = '' as $$ select private.admin_import(p_videos,p_expected) $$;
create function public.bootstrap_import(p_videos jsonb,p_initial boolean default true) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(2026,1);
  if exists(select 1 from public.ballot_entries) then raise exception '投票が存在するため管理画面の確認付き再取込を使用してください。'; end if;
  result := private.import_master(p_videos,(select master_revision from public.poll_settings where id = 1));
  if p_initial and ((select count(*) from public.videos where is_active) <> 107 or (select count(*) from public.videos where is_active and theme is not null) <> 55) then raise exception '初期件数は107作品・テーマ55作品である必要があります。'; end if;
  return result;
end $$;

create function private.admin_settings(p_start timestamptz,p_end timestamptz,p_published boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.poll_settings set starts_at = p_start,ends_at = p_end,is_published = p_published where id = 1;
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'settings',jsonb_build_object('starts_at',p_start,'ends_at',p_end,'published',p_published));
end $$;
create function public.admin_settings(p_start timestamptz,p_end timestamptz,p_published boolean) returns void language sql security invoker set search_path = '' as $$ select private.admin_settings(p_start,p_end,p_published) $$;
create function private.admin_reopen(p_voter uuid,p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if char_length(btrim(p_reason)) not between 1 and 500 or p_reason is null then raise exception '再開理由を入力してください。'; end if;
  update public.ballots set status = 'draft',submitted_at = null,revision = revision + 1,updated_at = now() where voter_id = p_voter and status = 'submitted';
  if not found then raise exception '確定済み投票が見つかりません。'; end if;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'reopen',p_voter::text,jsonb_build_object('reason',p_reason));
end $$;
create function public.admin_reopen(p_voter uuid,p_reason text) returns void language sql security invoker set search_path = '' as $$ select private.admin_reopen(p_voter,p_reason) $$;
create function private.admin_profile(p_voter uuid,p_nico text,p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare nico text; removed integer;
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if p_nico is null or btrim(p_nico) !~ '^[0-9]{1,30}$' or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception '正しいIDと修正理由を入力してください。'; end if;
  if exists(select 1 from public.ballots where voter_id = p_voter and status = 'submitted') then raise exception '先に確定投票を再開してください。'; end if;
  nico := coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  update public.profiles set nico_user_id = nico,updated_at = now() where user_id = p_voter;
  if not found then raise exception 'プロフィールが見つかりません。'; end if;
  delete from public.ballot_entries e using public.ballots b,public.videos v where e.ballot_id = b.id and b.voter_id = p_voter and v.video_id = e.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.ballots set revision = revision + 1,updated_at = now() where voter_id = p_voter;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'profile_correction',p_voter::text,jsonb_build_object('reason',p_reason,'removed_drafts',removed));
  return jsonb_build_object('removed',removed);
end $$;
create function public.admin_profile(p_voter uuid,p_nico text,p_reason text) returns jsonb language sql security invoker set search_path = '' as $$ select private.admin_profile(p_voter,p_nico,p_reason) $$;
create function private.admin_thumbnail(p_video text,p_url text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.videos set thumbnail_url = p_url,updated_at = now() where video_id = p_video;
  insert into public.audit_logs(actor,action,target) values(auth.uid(),'thumbnail',p_video);
end $$;
create function public.admin_thumbnail(p_video text,p_url text) returns void language sql security invoker set search_path = '' as $$ select private.admin_thumbnail(p_video,p_url) $$;
create function private.admin_report() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rankings jsonb; details jsonb;
begin
  perform private.require_admin();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.award_order,r.rank,r.display_order),'[]') into rankings from (
    select a.code as award_code,a.name as award_name,a.display_order as award_order,v.video_id,v.title,v.author_name,v.display_order,count(be.id)::integer as votes,
      rank() over(partition by a.code order by count(be.id) desc)::integer as rank
    from public.award_types a cross join public.videos v left join public.ballot_entries be on be.award_code = a.code and be.video_id = v.video_id and exists(select 1 from public.ballots b where b.id = be.ballot_id and b.status = 'submitted')
    where v.is_active and (a.code <> 'theme' or v.theme is not null) group by a.code,v.video_id
  ) r;
  select coalesce(jsonb_agg(jsonb_build_object('award_name',a.name,'video_id',v.video_id,'title',v.title,'display_name',p.display_name,'nico_user_id',p.nico_user_id,'comment',e.comment,'submitted_at',b.submitted_at) order by a.display_order,v.display_order),'[]') into details from public.ballot_entries e join public.ballots b on b.id = e.ballot_id and b.status = 'submitted' join public.profiles p on p.user_id = b.voter_id join public.videos v on v.video_id = e.video_id join public.award_types a on a.code = e.award_code;
  return jsonb_build_object('stats',jsonb_build_object('videos',(select count(*) from public.videos where is_active),'themed',(select count(*) from public.videos where is_active and theme is not null),'google_users',(select count(distinct user_id) from auth.identities where provider = 'google'),'drafts',(select count(*) from public.ballots where status = 'draft'),'submitted',(select count(*) from public.ballots where status = 'submitted')),'rankings',rankings,'details',details);
end $$;
create function public.admin_report() returns jsonb language sql security invoker set search_path = '' as $$ select private.admin_report() $$;

-- Explicit allowlist of callable functions. Private validation/import helpers are not granted.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function private.is_google(),private.is_admin() to authenticated;
grant execute on function private.save_profile(text,text),private.save_draft(jsonb,integer),private.submit_ballot(integer),private.admin_import(jsonb,integer),private.admin_settings(timestamptz,timestamptz,boolean),private.admin_reopen(uuid,text),private.admin_profile(uuid,text,text),private.admin_thumbnail(text,text),private.admin_report() to authenticated;
grant execute on function public.save_profile(text,text),public.save_draft(jsonb,integer),public.submit_ballot(integer),public.admin_import(jsonb,integer),public.admin_settings(timestamptz,timestamptz,boolean),public.admin_reopen(uuid,text),public.admin_profile(uuid,text,text),public.admin_thumbnail(text,text),public.admin_report() to authenticated;
grant execute on function public.bootstrap_import(jsonb,boolean) to service_role;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
