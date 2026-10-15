-- Rename physical tables in place: preserve rows, OIDs, keys, indexes and RLS.
-- Compatibility views keep existing deployed clients working under the same RLS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(2026,1);
lock table public.videos, public.ballots, public.ballot_entries in access exclusive mode;

do $preflight$
begin
  if to_regclass('public.data_mad') is not null
     or to_regclass('public.data_ballot') is not null
     or to_regclass('public.data_ballots') is not null then
    raise exception 'Rename target already exists; inspect the schema before retrying.';
  end if;
  if (select count(*) from pg_class where oid in (
    'public.videos'::regclass, 'public.ballots'::regclass, 'public.ballot_entries'::regclass
  ) and relkind = 'r' and relrowsecurity) <> 3 then
    raise exception 'Expected three physical tables with RLS enabled.';
  end if;
end
$preflight$;

alter table public.videos rename to data_mad;
alter table public.ballot_entries rename to data_ballots;
alter table public.ballots rename to data_ballot;

-- Recreate only the 10 functions that contain textual relation references.
-- CREATE OR REPLACE preserves function identity, ownership and EXECUTE grants.
-- RPC names, arguments and JSON response keys remain unchanged.
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
  if exists(select 1 from public.data_ballot where voter_id = p_voter and status = 'submitted') then raise exception '先に確定投票を再開してください。'; end if;
  nico := coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  update public.profiles set nico_user_id = nico,updated_at = now() where user_id = p_voter;
  if not found then raise exception 'プロフィールが見つかりません。'; end if;
  delete from public.data_ballots e using public.data_ballot b,public.data_mad v where e.ballot_id = b.id and b.voter_id = p_voter and v.video_id = e.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.data_ballot set revision = revision + 1,updated_at = now() where voter_id = p_voter;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'profile_correction',p_voter::text,jsonb_build_object('reason',p_reason,'removed_drafts',removed));
  return jsonb_build_object('removed',removed);
end $function$;

CREATE OR REPLACE FUNCTION private.admin_reopen(p_voter uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  if char_length(btrim(p_reason)) not between 1 and 500 or p_reason is null then raise exception '再開理由を入力してください。'; end if;
  update public.data_ballot set status = 'draft',submitted_at = null,revision = revision + 1,updated_at = now() where voter_id = p_voter and status = 'submitted';
  if not found then raise exception '確定済み投票が見つかりません。'; end if;
  insert into public.audit_logs(actor,action,target,summary) values(auth.uid(),'reopen',p_voter::text,jsonb_build_object('reason',p_reason));
end $function$;

CREATE OR REPLACE FUNCTION private.admin_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rankings jsonb; details jsonb;
begin
  perform private.require_admin();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.award_order,r.rank,r.display_order),'[]') into rankings from (
    select a.code as award_code,a.name as award_name,a.display_order as award_order,v.video_id,v.title,v.author_name,v.display_order,count(be.id)::integer as votes,
      rank() over(partition by a.code order by count(be.id) desc)::integer as rank
    from public.award_types a cross join public.data_mad v left join public.data_ballots be on be.award_code = a.code and be.video_id = v.video_id and exists(select 1 from public.data_ballot b where b.id = be.ballot_id and b.status = 'submitted')
    where v.is_active and (a.code <> 'theme' or v.theme is not null) group by a.code,v.video_id
  ) r;
  select coalesce(jsonb_agg(jsonb_build_object('award_name',a.name,'video_id',v.video_id,'title',v.title,'display_name',p.display_name,'nico_user_id',p.nico_user_id,'comment',e.comment,'submitted_at',b.submitted_at) order by a.display_order,v.display_order),'[]') into details from public.data_ballots e join public.data_ballot b on b.id = e.ballot_id and b.status = 'submitted' join public.profiles p on p.user_id = b.voter_id join public.data_mad v on v.video_id = e.video_id join public.award_types a on a.code = e.award_code;
  return jsonb_build_object('stats',jsonb_build_object('videos',(select count(*) from public.data_mad where is_active),'themed',(select count(*) from public.data_mad where is_active and theme is not null),'google_users',(select count(distinct user_id) from auth.identities where provider = 'google'),'drafts',(select count(*) from public.data_ballot where status = 'draft'),'submitted',(select count(*) from public.data_ballot where status = 'submitted')),'rankings',rankings,'details',details);
end $function$;

CREATE OR REPLACE FUNCTION private.admin_thumbnail(p_video text, p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.data_mad set thumbnail_url = p_url,updated_at = now() where video_id = p_video;
  insert into public.audit_logs(actor,action,target) values(auth.uid(),'thumbnail',p_video);
end $function$;

CREATE OR REPLACE FUNCTION private.import_master(p_videos jsonb, p_expected integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer; updated integer; removed integer; e record;
begin
  perform pg_advisory_xact_lock(2026,1);
  if p_expected is null or p_expected <> (select master_revision from public.poll_settings where id = 1) then raise exception '作品マスターが更新されました。プレビューをやり直してください。' using errcode = '40001'; end if;
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' or jsonb_array_length(p_videos) not between 1 and 2000 then raise exception '作品データが不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_videos) v group by v->>'video_id' having count(*) > 1) then raise exception '作品IDが重複しています。'; end if;
  select count(*) into inserted from jsonb_array_elements(p_videos) v where not exists(select 1 from public.data_mad old where old.video_id = v->>'video_id');
  updated := jsonb_array_length(p_videos) - inserted;
  insert into public.data_mad(video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,posted_at,is_active)
  select v->>'video_id',(v->>'display_order')::integer,v->>'title',coalesce(nullif(ltrim(btrim(v->>'author_nico_user_id'),'0'),''),'0'),v->>'author_name',nullif(btrim(v->>'theme'),''),v->>'watch_url',(v->>'posted_at')::date,(v->>'is_active')::boolean from jsonb_array_elements(p_videos) v
  on conflict(video_id) do update set display_order = excluded.display_order,title = excluded.title,author_nico_user_id = excluded.author_nico_user_id,author_name = excluded.author_name,theme = excluded.theme,watch_url = excluded.watch_url,posted_at = excluded.posted_at,is_active = excluded.is_active,updated_at = now();
  for e in select b.voter_id, jsonb_agg(jsonb_build_object('award_code',be.award_code,'video_id',be.video_id,'comment',be.comment)) as entries from public.data_ballot b join public.data_ballots be on be.ballot_id = b.id where b.status = 'submitted' group by b.id loop
    perform private.validate_entries(e.voter_id,e.entries,true);
  end loop;
  -- Advance draft revisions for every affected master update, so stale clients cannot restore invalid choices.
  update public.data_ballot set revision = revision + 1,updated_at = now() where status = 'draft' and exists(select 1 from public.data_ballots be join jsonb_array_elements(p_videos) v on v->>'video_id' = be.video_id where be.ballot_id = data_ballot.id);
  delete from public.data_ballots be using public.data_ballot b,public.data_mad v,public.profiles p where be.ballot_id = b.id and b.status = 'draft' and p.user_id = b.voter_id and be.video_id = v.video_id and (not v.is_active or v.author_nico_user_id = p.nico_user_id or (be.award_code = 'theme' and v.theme is null));
  get diagnostics removed = row_count;
  update public.poll_settings set master_revision = master_revision + 1 where id = 1;
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'import',jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed));
  return jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed);
end $function$;

CREATE OR REPLACE FUNCTION private.save_draft(p_entries jsonb, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; b public.data_ballot;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1); perform private.require_open();
  select * into b from public.data_ballot where voter_id = uid for update;
  if b.id is null then raise exception 'プロフィールを登録してください。'; end if;
  if b.status <> 'draft' then raise exception '投票は確定済みです。'; end if;
  if p_revision is null or b.revision <> p_revision then raise exception '別の画面で内容が更新されました。再読み込みして確認してください。' using errcode = '40001'; end if;
  perform private.validate_entries(uid,p_entries,false);
  delete from public.data_ballots where ballot_id = b.id;
  insert into public.data_ballots(ballot_id,award_code,video_id,comment) select b.id,e->>'award_code',e->>'video_id',nullif(e->>'comment','') from jsonb_array_elements(p_entries) e;
  update public.data_ballot set revision = revision + 1, updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('revision',b.revision);
end $function$;

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
  if exists(select 1 from public.data_ballot where voter_id = uid and status = 'submitted') and exists(select 1 from public.profiles where user_id = uid and nico_user_id <> nico) then raise exception '確定後はニコニコユーザーIDを変更できません。運営へお問い合わせください。'; end if;
  if exists(select 1 from public.profiles where nico_user_id = nico and user_id <> uid) then raise exception 'このニコニコユーザーIDは登録済みです。運営へお問い合わせください。'; end if;
  insert into public.profiles(user_id,display_name,nico_user_id) values(uid,btrim(p_name),nico) on conflict(user_id) do update set display_name = excluded.display_name, nico_user_id = excluded.nico_user_id, updated_at = now();
  insert into public.data_ballot(voter_id) values(uid) on conflict(voter_id) do nothing;
  delete from public.data_ballots e using public.data_ballot b, public.data_mad v where e.ballot_id = b.id and b.voter_id = uid and b.status = 'draft' and e.video_id = v.video_id and v.author_nico_user_id = nico;
  get diagnostics removed = row_count;
  update public.data_ballot set revision = revision + 1, updated_at = now() where voter_id = uid and status = 'draft';
  return jsonb_build_object('removed',removed);
end $function$;

CREATE OR REPLACE FUNCTION private.submit_ballot(p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid; b public.data_ballot; entries jsonb;
begin
  uid := private.require_user(); perform pg_advisory_xact_lock(2026,1);
  select * into b from public.data_ballot where voter_id = uid for update;
  if b.id is null then raise exception '投票内容がありません。'; end if;
  -- Idempotent retry returns the existing receipt without changing any data.
  if b.status = 'submitted' then return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision); end if;
  perform private.require_open();
  if p_revision is null or b.revision <> p_revision then raise exception '投票内容が更新されました。確認画面を開き直してください。' using errcode = '40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('award_code',award_code,'video_id',video_id,'comment',comment)),'[]') into entries from public.data_ballots where ballot_id = b.id;
  perform private.validate_entries(uid,entries,true);
  update public.data_ballot set status = 'submitted',submitted_at = now(),revision = revision + 1,updated_at = now() where id = b.id returning * into b;
  return jsonb_build_object('submitted_at',b.submitted_at,'revision',b.revision);
end $function$;

CREATE OR REPLACE FUNCTION private.validate_entries(p_uid uuid, p_entries jsonb, p_final boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare nico text; award_row record; n integer;
begin
  select nico_user_id into nico from public.profiles where user_id = p_uid;
  if nico is null then raise exception 'プロフィールを登録してください。'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception '投票形式が不正です。'; end if;
  -- Bound input by the number of possible active video/award pairs, not final votes.
  if jsonb_array_length(p_entries) > (select count(*) from public.data_mad where is_active) * (select count(*) from public.award_types) then raise exception '選択できる作品数を超えています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object' or e->>'video_id' is null or e->>'award_code' is null or (e ? 'comment' and jsonb_typeof(e->'comment') not in ('string','null')) or char_length(e->>'comment') > 1000) then raise exception '投票内容または感想が不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'award_code', e->>'video_id' having count(*) > 1) then raise exception '同じ部門で作品が重複しています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e left join public.award_types a on a.code = e->>'award_code' left join public.data_mad v on v.video_id = e->>'video_id' where a.code is null or v.video_id is null or not v.is_active or v.author_nico_user_id = nico or (a.code = 'theme' and nullif(btrim(v.theme),'') is null)) then raise exception '自薦・無効な作品・テーマ未記入の作品には投票できません。'; end if;
  for award_row in select * from public.award_types loop
    select count(*) into n from jsonb_array_elements(p_entries) e where e->>'award_code' = award_row.code;
    if p_final and (n > award_row.max_votes or n < award_row.min_votes) then raise exception '%は%～%作品選択してください。', award_row.name, award_row.min_votes, award_row.max_votes; end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.bootstrap_import(p_videos jsonb, p_initial boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(2026,1);
  if exists(select 1 from public.data_ballots) then raise exception '投票が存在するため管理画面の確認付き再取込を使用してください。'; end if;
  result := private.import_master(p_videos,(select master_revision from public.poll_settings where id = 1));
  if p_initial and ((select count(*) from public.data_mad where is_active) <> 107 or (select count(*) from public.data_mad where is_active and theme is not null) <> 55) then raise exception '初期件数は107作品・テーマ55作品である必要があります。'; end if;
  return result;
end $function$;


create view public.videos with (security_invoker = true) as select * from public.data_mad;
create view public.ballot_entries with (security_invoker = true) as select * from public.data_ballots;
create view public.ballots with (security_invoker = true) as select * from public.data_ballot;

-- New views can inherit Supabase default grants. Restrict them explicitly.
revoke all on public.videos, public.ballot_entries, public.ballots from public, anon, authenticated, service_role;
grant select on public.videos, public.ballot_entries, public.ballots to authenticated;
grant all on public.videos, public.ballot_entries, public.ballots to service_role;
comment on view public.videos is 'Compatibility view for public.data_mad; security_invoker preserves RLS.';
comment on view public.ballot_entries is 'Compatibility view for public.data_ballots; security_invoker preserves RLS.';
comment on view public.ballots is 'Compatibility view for public.data_ballot; security_invoker preserves RLS.';

notify pgrst, 'reload schema';
commit;
