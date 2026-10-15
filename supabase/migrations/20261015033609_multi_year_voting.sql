-- Annual data stays in place. All existing rows belong to 2026.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(2026,1);
lock table public.data_mad,public.data_ballot,public.data_ballots,public.master_poll_settings,public.audit_logs in share row exclusive mode;
-- Compare all preexisting fields inside the same transaction; any discrepancy aborts the migration.
select set_config('anipafe.multi_year_before',jsonb_build_object(
  'videos',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by video_id),'')) from public.data_mad t),
  'ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballot t),
  'entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballots t),
  'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.master_poll_settings t),
  'audit',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.audit_logs t)
)::text,true);
alter table public.master_poll_settings drop constraint poll_settings_id_check;
alter table public.master_poll_settings add column year integer not null default 2026 unique check (year between 2000 and 2100);
alter table public.master_poll_settings add column title text not null default 'AniPAFE2026 人気投票' check (char_length(btrim(title)) between 1 and 100 and title !~ '^[[:space:]　]*$');
create table public.master_event_settings (
  id integer primary key check (id=1),
  target_year integer not null references public.master_poll_settings(year)
);
insert into public.master_event_settings values (1,2026);
alter table public.master_event_settings enable row level security;
revoke all on public.master_event_settings from public,anon,authenticated;
grant select on public.master_event_settings to authenticated;
grant all on public.master_event_settings to service_role;
create policy event_read on public.master_event_settings for select to authenticated using (private.is_google());

create function private.current_year() returns integer language sql stable security definer set search_path='' as $$
  select target_year from public.master_event_settings where id=1
$$;
revoke all on function private.current_year() from public,anon,authenticated;
grant execute on function private.current_year() to authenticated,service_role;

alter table public.data_mad add column year integer not null default 2026 references public.master_poll_settings(year);
alter table public.data_ballot add column year integer not null default 2026 references public.master_poll_settings(year);
alter table public.data_ballots add column year integer not null default 2026;
alter table public.data_ballots drop constraint ballot_entries_video_id_fkey;
alter table public.data_mad drop constraint videos_pkey;
alter table public.data_mad add primary key(year,video_id);
alter table public.data_ballot drop constraint ballots_voter_id_key;
alter table public.data_ballot add unique(voter_id,year);
alter table public.data_ballot add unique(id,year);
alter table public.data_ballots add foreign key(year,video_id) references public.data_mad(year,video_id);
alter table public.data_ballots add foreign key(ballot_id,year) references public.data_ballot(id,year) on delete cascade;
create index ballot_entries_year_video_idx on public.data_ballots(year,video_id);
create index ballot_entries_ballot_year_idx on public.data_ballots(ballot_id,year);
create index ballots_year_idx on public.data_ballot(year);
create index event_target_year_idx on public.master_event_settings(target_year);

-- Defaults pin legacy clients to 2026. New clients always send their loaded year.
-- History includes inactive works referenced by the user's own past ballot.
alter policy videos_read on public.data_mad using (private.is_google() and (is_active or private.is_admin() or exists (
  select 1 from public.data_ballots e join public.data_ballot b on b.id=e.ballot_id
  where e.year=data_mad.year and e.video_id=data_mad.video_id and b.voter_id=(select auth.uid())
)));

CREATE OR REPLACE FUNCTION private.require_open()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.master_poll_settings where year = private.current_year() and is_published and starts_at <= now() and now() < ends_at)
  then raise exception '現在は投票期間外です。'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION private.validate_entries(p_uid uuid, p_entries jsonb, p_final boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare nico text; award_row record; n integer;
begin
  select nico_user_id into nico from public.data_profiles where user_id = p_uid;
  if nico is null then raise exception 'プロフィールを登録してください。'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception '投票形式が不正です。'; end if;
  -- Bound input by the number of possible active video/award pairs, not final votes.
  if jsonb_array_length(p_entries) > (select count(*) from public.data_mad where year = private.current_year() and is_active) * (select count(*) from public.master_award_types) then raise exception '選択できる作品数を超えています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object' or e->>'video_id' is null or e->>'award_code' is null or (e ? 'comment' and jsonb_typeof(e->'comment') not in ('string','null')) or char_length(e->>'comment') > 1000) then raise exception '投票内容または感想が不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'award_code', e->>'video_id' having count(*) > 1) then raise exception '同じ部門で作品が重複しています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e left join public.master_award_types a on a.code = e->>'award_code' left join public.data_mad v on v.year = private.current_year() and v.video_id = e->>'video_id' where a.code is null or v.video_id is null or not v.is_active or v.author_nico_user_id = nico or (a.code = 'theme' and nullif(btrim(v.theme),'') is null)) then raise exception '自薦・無効な作品・テーマ未記入の作品には投票できません。'; end if;
  for award_row in select * from public.master_award_types loop
    select count(*) into n from jsonb_array_elements(p_entries) e where e->>'award_code' = award_row.code;
    if p_final and (n > award_row.max_votes or n < award_row.min_votes) then raise exception '%は%～%作品選択してください。', award_row.name, award_row.min_votes, award_row.max_votes; end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.import_master(p_videos jsonb, p_expected integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer; updated integer; removed integer; e record;
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_expected is null or p_expected <> (select master_revision from public.master_poll_settings where year = private.current_year()) then raise exception '作品マスターが更新されました。プレビューをやり直してください。' using errcode = '40001'; end if;
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' or jsonb_array_length(p_videos) not between 1 and 2000 then raise exception '作品データが不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_videos) v group by v->>'video_id' having count(*) > 1) then raise exception '作品IDが重複しています。'; end if;
  select count(*) into inserted from jsonb_array_elements(p_videos) v where not exists(select 1 from public.data_mad old where old.year = private.current_year() and old.video_id = v->>'video_id');
  updated := jsonb_array_length(p_videos) - inserted;
  insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,posted_at,is_active)
  select private.current_year(),v->>'video_id',(v->>'display_order')::integer,v->>'title',coalesce(nullif(ltrim(btrim(v->>'author_nico_user_id'),'0'),''),'0'),v->>'author_name',nullif(btrim(v->>'theme'),''),v->>'watch_url',(v->>'posted_at')::date,(v->>'is_active')::boolean from jsonb_array_elements(p_videos) v
  on conflict(year,video_id) do update set display_order = excluded.display_order,title = excluded.title,author_nico_user_id = excluded.author_nico_user_id,author_name = excluded.author_name,theme = excluded.theme,watch_url = excluded.watch_url,posted_at = excluded.posted_at,is_active = excluded.is_active,updated_at = now();
  for e in select b.voter_id, jsonb_agg(jsonb_build_object('award_code',be.award_code,'video_id',be.video_id,'comment',be.comment)) as entries from public.data_ballot b join public.data_ballots be on be.ballot_id = b.id where b.year = private.current_year() and b.status = 'submitted' group by b.id loop
    perform private.validate_entries(e.voter_id,e.entries,true);
  end loop;
  -- Advance draft revisions for every affected master update, so stale clients cannot restore invalid choices.
  update public.data_ballot set revision = revision + 1,updated_at = now() where year = private.current_year() and status = 'draft' and exists(select 1 from public.data_ballots be join jsonb_array_elements(p_videos) v on v->>'video_id' = be.video_id where be.ballot_id = data_ballot.id);
  delete from public.data_ballots be using public.data_ballot b,public.data_mad v,public.data_profiles p where be.ballot_id = b.id and b.year = private.current_year() and b.status = 'draft' and p.user_id = b.voter_id and be.year = v.year and be.video_id = v.video_id and (not v.is_active or v.author_nico_user_id = p.nico_user_id or (be.award_code = 'theme' and v.theme is null));
  get diagnostics removed = row_count;
  update public.master_poll_settings set master_revision = master_revision + 1 where year = private.current_year();
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'import',jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed));
  return jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed);
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_settings(p_start timestamp with time zone, p_end timestamp with time zone, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.master_poll_settings set starts_at = p_start,ends_at = p_end,is_published = p_published where year = private.current_year();
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'settings',jsonb_build_object('starts_at',p_start,'ends_at',p_end,'published',p_published));
end $function$
;

CREATE OR REPLACE FUNCTION private.save_profile(p_name text, p_nico text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; nico text; removed integer;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 100 or p_name ~ '^[[:space:]　]*$' or p_nico is null or btrim(p_nico) !~ '^[0-9]{1,30}$' then raise exception 'ユーザー名と半角数字のニコニコユーザーIDを入力してください。'; end if;
  nico := coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  if exists(select 1 from public.data_ballot where year = private.current_year() and voter_id = uid and status = 'submitted') and exists(select 1 from public.data_profiles where user_id = uid and nico_user_id <> nico) then raise exception '確定後はニコニコユーザーIDを変更できません。運営へお問い合わせください。'; end if;
  if exists(select 1 from public.data_profiles where nico_user_id = nico and user_id <> uid) then raise exception 'このニコニコユーザーIDは登録済みです。運営へお問い合わせください。'; end if;
  insert into public.data_profiles(user_id,display_name,nico_user_id) values(uid,btrim(p_name),nico) on conflict(user_id) do update set display_name = excluded.display_name, nico_user_id = excluded.nico_user_id, updated_at = now();
  insert into public.data_ballot(voter_id,year) values(uid,private.current_year()) on conflict(voter_id,year) do nothing;
  delete from public.data_ballots e using public.data_ballot b, public.data_mad v where e.ballot_id = b.id and b.year = private.current_year() and b.voter_id = uid and b.status = 'draft' and e.year = v.year and e.video_id = v.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.data_ballot set revision = revision + 1, updated_at = now() where year = private.current_year() and voter_id = uid and status = 'draft';
  return jsonb_build_object('removed',removed);
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_reopen(p_voter uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if char_length(btrim(p_reason)) not between 1 and 500 or p_reason is null then raise exception '再開理由を入力してください。'; end if;
  update public.data_ballot set status = 'draft',submitted_at = null,revision = revision + 1,updated_at = now() where year = private.current_year() and voter_id = p_voter and status = 'submitted';
  if not found then raise exception '確定済み投票が見つかりません。'; end if;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'reopen',p_voter::text,jsonb_build_object('reason',p_reason));
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_thumbnail(p_video text, p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.data_mad set thumbnail_url = p_url,updated_at = now() where year = private.current_year() and video_id = p_video;
  insert into public.audit_logs(actor,action,target) values(auth.uid(),'thumbnail',p_video);
end $function$
;

CREATE OR REPLACE FUNCTION private.save_draft(p_entries jsonb, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; b public.data_ballot;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1); perform private.require_open();
  insert into public.data_ballot(voter_id,year) select uid,private.current_year() where exists(select 1 from public.data_profiles where user_id=uid) on conflict(voter_id,year) do nothing;
  select * into b from public.data_ballot where year = private.current_year() and voter_id = uid for update;
  if b.id is null then raise exception 'プロフィールを登録してください。'; end if;
  if b.status <> 'draft' then raise exception '投票は確定済みです。'; end if;
  if p_revision is null or b.revision <> p_revision then raise exception '別の画面で内容が更新されました。再読み込みして確認してください。' using errcode = '40001'; end if;
  perform private.validate_entries(uid,p_entries,false);
  delete from public.data_ballots where ballot_id = b.id;
  insert into public.data_ballots(ballot_id,year,award_code,video_id,comment) select b.id,b.year,e->>'award_code',e->>'video_id',nullif(e->>'comment','') from jsonb_array_elements(p_entries) e;
  update public.data_ballot set revision = revision + 1, updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('revision',b.revision);
end $function$
;

CREATE OR REPLACE FUNCTION private.submit_ballot(p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; b public.data_ballot; entries jsonb;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1);
  select * into b from public.data_ballot where year = private.current_year() and voter_id = uid for update;
  if b.id is null then raise exception '投票内容がありません。'; end if;
  -- Idempotent retry returns the existing receipt without changing any data.
  if b.status = 'submitted' then return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision); end if;
  perform private.require_open();
  if p_revision is null or b.revision <> p_revision then raise exception '投票内容が更新されました。確認画面を開き直してください。' using errcode = '40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('award_code',award_code,'video_id',video_id,'comment',comment)),'[]') into entries from public.data_ballots where ballot_id = b.id;
  perform private.validate_entries(uid,entries,true);
  update public.data_ballot set status = 'submitted',submitted_at = now(),revision = revision + 1,updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision);
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_profile(p_voter uuid, p_nico text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare nico text; removed integer;
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if p_nico is null or btrim(p_nico) !~ '^[0-9]{1,30}$' or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception '正しいIDと修正理由を入力してください。'; end if;
  if exists(select 1 from public.data_ballot where year = private.current_year() and voter_id = p_voter and status = 'submitted') then raise exception '先に確定投票を再開してください。'; end if;
  nico := coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  update public.data_profiles set nico_user_id = nico,updated_at = now() where user_id = p_voter;
  if not found then raise exception 'プロフィールが見つかりません。'; end if;
  delete from public.data_ballots e using public.data_ballot b,public.data_mad v where e.ballot_id = b.id and b.year = private.current_year() and b.voter_id = p_voter and v.year = e.year and v.video_id = e.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.data_ballot set revision = revision + 1,updated_at = now() where year = private.current_year() and voter_id = p_voter;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'profile_correction',p_voter::text,jsonb_build_object('reason',p_reason,'removed_drafts',removed));
  return jsonb_build_object('removed',removed);
end $function$
;

drop function public.save_draft(jsonb,integer);
create function public.save_draft(p_entries jsonb,p_revision integer,p_year integer default 2026) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  return private.save_draft(p_entries,p_revision);
end $$;
revoke all on function public.save_draft(jsonb,integer,integer) from public,anon;
grant execute on function public.save_draft(jsonb,integer,integer) to authenticated;

drop function public.submit_ballot(integer);
create function public.submit_ballot(p_revision integer,p_year integer default 2026) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  return private.submit_ballot(p_revision);
end $$;
revoke all on function public.submit_ballot(integer,integer) from public,anon;
grant execute on function public.submit_ballot(integer,integer) to authenticated;

drop function public.admin_import(jsonb,integer);
create function public.admin_import(p_videos jsonb,p_expected integer,p_year integer default 2026) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  return private.admin_import(p_videos,p_expected);
end $$;
revoke all on function public.admin_import(jsonb,integer,integer) from public,anon;
grant execute on function public.admin_import(jsonb,integer,integer) to authenticated;

drop function public.admin_settings(timestamptz,timestamptz,boolean);
create function public.admin_settings(p_start timestamptz,p_end timestamptz,p_published boolean,p_year integer default 2026) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  perform private.admin_settings(p_start,p_end,p_published);
end $$;
revoke all on function public.admin_settings(timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.admin_settings(timestamptz,timestamptz,boolean,integer) to authenticated;

drop function public.admin_reopen(uuid,text);
create function public.admin_reopen(p_voter uuid,p_reason text,p_year integer default 2026) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  perform private.admin_reopen(p_voter,p_reason);
end $$;
revoke all on function public.admin_reopen(uuid,text,integer) from public,anon;
grant execute on function public.admin_reopen(uuid,text,integer) to authenticated;

drop function public.admin_profile(uuid,text,text);
create function public.admin_profile(p_voter uuid,p_nico text,p_reason text,p_year integer default 2026) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  return private.admin_profile(p_voter,p_nico,p_reason);
end $$;
revoke all on function public.admin_profile(uuid,text,text,integer) from public,anon;
grant execute on function public.admin_profile(uuid,text,text,integer) to authenticated;

drop function public.admin_thumbnail(text,text);
create function public.admin_thumbnail(p_video text,p_url text,p_year integer default 2026) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_year is distinct from private.current_year() then raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001'; end if;
  perform private.admin_thumbnail(p_video,p_url);
end $$;
revoke all on function public.admin_thumbnail(text,text,integer) from public,anon;
grant execute on function public.admin_thumbnail(text,text,integer) to authenticated;

-- Global profile identity is shared, while every ballot/master operation is annual.
alter table public.audit_logs add column year integer not null default 2026 references public.master_poll_settings(year);
alter table public.audit_logs alter column year set default private.current_year();
create index audit_logs_year_idx on public.audit_logs(year);

create function private.poll_header() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('year',p.year,'title',p.title) from public.master_poll_settings p
  join public.master_event_settings s on s.target_year=p.year where s.id=1
$$;
create function public.poll_header() returns jsonb language sql stable security invoker set search_path='' as $$
  select private.poll_header()
$$;
revoke all on function private.poll_header(),public.poll_header() from public;
-- USAGE alone exposes no tables or other helpers; only this header helper grants anon EXECUTE.
grant usage on schema private to anon;
grant execute on function private.poll_header(),public.poll_header() to anon,authenticated,service_role;

create function private.year_rankings(p_year integer) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.award_order,r.rank,r.display_order),'[]') from (
    select a.code as award_code,a.name as award_name,a.display_order as award_order,
      v.video_id,v.title,v.author_name,v.display_order,count(e.id)::integer as votes,
      rank() over(partition by a.code order by count(e.id) desc)::integer as rank
    from public.master_award_types a cross join public.data_mad v
    left join public.data_ballots e on e.year=v.year and e.video_id=v.video_id and e.award_code=a.code
      and exists(select 1 from public.data_ballot b where b.id=e.ballot_id and b.status='submitted')
    where v.year=p_year and v.is_active and (a.code<>'theme' or v.theme is not null)
    group by a.code,v.year,v.video_id
  ) r
$$;
revoke all on function private.year_rankings(integer) from public,anon,authenticated;

create or replace function private.admin_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare y integer; details jsonb;
begin
  perform private.require_admin(); y:=private.current_year();
  select coalesce(jsonb_agg(jsonb_build_object('award_name',a.name,'video_id',v.video_id,'title',v.title,
    'display_name',p.display_name,'nico_user_id',p.nico_user_id,'comment',e.comment,'submitted_at',b.submitted_at)
    order by a.display_order,v.display_order),'[]') into details
    from public.data_ballots e join public.data_ballot b on b.id=e.ballot_id and b.status='submitted'
    join public.data_profiles p on p.user_id=b.voter_id join public.data_mad v on v.year=e.year and v.video_id=e.video_id
    join public.master_award_types a on a.code=e.award_code where e.year=y;
  return jsonb_build_object('year',y,'stats',jsonb_build_object(
    'videos',(select count(*) from public.data_mad where year=y and is_active),
    'themed',(select count(*) from public.data_mad where year=y and is_active and theme is not null),
    'google_users',(select count(distinct user_id) from auth.identities where provider='google'),
    'drafts',(select count(*) from public.data_ballot where year=y and status='draft'),
    'submitted',(select count(*) from public.data_ballot where year=y and status='submitted')),
    'rankings',private.year_rankings(y),'details',details);
end $$;

create function private.manage_year(p_action text,p_year integer,p_title text,p_start timestamptz,p_end timestamptz,
  p_published boolean,p_results_public boolean,p_expected_year integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if p_expected_year is distinct from private.current_year() then
    raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001';
  end if;
  if p_action='create' then
    insert into public.master_poll_settings(id,year,title) values(p_year,p_year,btrim(p_title));
  elsif p_action='switch' then
    if not exists(select 1 from public.master_poll_settings where year=p_year) then raise exception '年度が見つかりません。'; end if;
    update public.master_event_settings set target_year=p_year where id=1;
    -- Invalidate every tab, including a switch away and back to the same year.
    update public.data_ballot set revision=revision+1 where year=p_year and status='draft';
    update public.master_poll_settings set master_revision=master_revision+1 where year=p_year;
  elsif p_action='settings' and p_year=private.current_year() then
    if p_results_public and (p_end is null or p_end>now()) then raise exception '投票終了後に結果を公開できます。'; end if;
    update public.master_poll_settings set title=btrim(p_title),starts_at=p_start,ends_at=p_end,
      is_published=p_published,results_public=p_results_public where year=p_year;
  else raise exception '年度の操作が不正です。'; end if;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'year_'||p_action,p_year::text,
    jsonb_build_object('year',p_year,'previous_year',p_expected_year,'title',p_title,'results_public',p_results_public));
end $$;
create function public.manage_year(p_action text,p_year integer,p_title text,p_start timestamptz,p_end timestamptz,
  p_published boolean,p_results_public boolean,p_expected_year integer) returns void
language sql security invoker set search_path='' as $$
  select private.manage_year(p_action,p_year,p_title,p_start,p_end,p_published,p_results_public,p_expected_year)
$$;
revoke all on function private.manage_year(text,integer,text,timestamptz,timestamptz,boolean,boolean,integer),
  public.manage_year(text,integer,text,timestamptz,timestamptz,boolean,boolean,integer) from public,anon;
grant execute on function private.manage_year(text,integer,text,timestamptz,timestamptz,boolean,boolean,integer),
  public.manage_year(text,integer,text,timestamptz,timestamptz,boolean,boolean,integer) to authenticated;

-- Only aggregate rankings are publishable. Individual comments and identities never leave the owner's history.
create function private.vote_history(p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid; years jsonb; poll public.master_poll_settings; ballot public.data_ballot; entries jsonb; visible boolean;
begin
  uid:=private.require_user();
  select coalesce(jsonb_agg(jsonb_build_object('year',p.year,'title',p.title,'ends_at',p.ends_at,
    'results_public',p.results_public and p.ends_at<=now(),'status',b.status,'submitted_at',b.submitted_at,
    'entry_count',(select count(*) from public.data_ballots e where e.ballot_id=b.id)) order by p.year desc),'[]')
    into years from public.master_poll_settings p left join public.data_ballot b on b.year=p.year and b.voter_id=uid
    where p.year<private.current_year();
  if p_year is null then return jsonb_build_object('years',years); end if;
  select * into poll from public.master_poll_settings where year=p_year and year<private.current_year();
  if poll.year is null then raise exception '過去年度が見つかりません。'; end if;
  select * into ballot from public.data_ballot where year=p_year and voter_id=uid;
  select coalesce(jsonb_agg(jsonb_build_object('award_code',e.award_code,'award_name',a.name,'video_id',e.video_id,
    'title',v.title,'author_name',v.author_name,'watch_url',v.watch_url,'comment',e.comment)
    order by a.display_order,v.display_order),'[]') into entries
    from public.data_ballots e join public.master_award_types a on a.code=e.award_code
    join public.data_mad v on v.year=e.year and v.video_id=e.video_id where e.ballot_id=ballot.id;
  visible:=coalesce(poll.results_public and poll.ends_at<=now(),false);
  return jsonb_build_object('years',years,'poll',to_jsonb(poll),'ballot',case when ballot.id is null then null else to_jsonb(ballot) end,'entries',entries,
    'rankings',case when visible then private.year_rankings(p_year) else '[]'::jsonb end,'results_public',visible);
end $$;
create function public.vote_history(p_year integer default null) returns jsonb language sql security invoker set search_path='' as $$
  select private.vote_history(p_year)
$$;
revoke all on function private.vote_history(integer),public.vote_history(integer) from public,anon;
grant execute on function private.vote_history(integer),public.vote_history(integer) to authenticated;

-- Bootstrap is exclusively for the first 2026 import; all later years use the administrator import.
create or replace function public.bootstrap_import(p_videos jsonb,p_initial boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(2026,1);
  if private.current_year()<>2026 or exists(select 1 from public.master_poll_settings where year<>2026) or exists(select 1 from public.data_ballots) then
    raise exception '投票が存在するため管理画面の確認付き再取込を使用してください。';
  end if;
  result:=private.import_master(p_videos,(select master_revision from public.master_poll_settings where year=2026));
  if p_initial and ((select count(*) from public.data_mad where year=2026 and is_active)<>107 or
    (select count(*) from public.data_mad where year=2026 and is_active and theme is not null)<>55) then
    raise exception '初期件数は107作品・テーマ55作品である必要があります。';
  end if;
  return result;
end $$;
do $verify$
begin
  if current_setting('anipafe.multi_year_before')::jsonb is distinct from jsonb_build_object(
    'videos',(select md5(coalesce(string_agg((to_jsonb(t)-'year')::text,'' order by video_id),'')) from public.data_mad t),
    'ballots',(select md5(coalesce(string_agg((to_jsonb(t)-'year')::text,'' order by id),'')) from public.data_ballot t),
    'entries',(select md5(coalesce(string_agg((to_jsonb(t)-'year')::text,'' order by id),'')) from public.data_ballots t),
    'settings',(select md5(coalesce(string_agg((to_jsonb(t)-'year'-'title')::text,'' order by id),'')) from public.master_poll_settings t),
    'audit',(select md5(coalesce(string_agg((to_jsonb(t)-'year')::text,'' order by id),'')) from public.audit_logs t)
  ) then raise exception 'Annual migration modified existing data; rolling back.'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;
