-- Explicit year-scoped admin operations. Legacy RPCs retain their active-year guards.
-- No existing data, voting/public-year rules, tables, or policies are changed.
begin;
create function private.require_admin_year(p_year integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin();
  perform pg_advisory_xact_lock(2026,1);
  if p_year is null or not exists(select 1 from public.master_poll_settings where year=p_year) then
    raise exception '年度が登録されていません。';
  end if;
end $$;
revoke all on function private.require_admin_year(integer) from public,anon,authenticated;
grant execute on function private.require_admin_year(integer) to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.validate_year_entries(p_uid uuid, p_entries jsonb, p_final boolean, p_year integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare nico text; award_row record; n integer;
begin
  perform private.require_admin_year(p_year);
  select nico_user_id into nico from public.data_profiles where user_id = p_uid;
  if nico is null then raise exception 'プロフィールを登録してください。'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception '投票形式が不正です。'; end if;
  -- Bound input by the number of possible active video/award pairs, not final votes.
  if jsonb_array_length(p_entries) > (select count(*) from public.data_mad where year = p_year and is_active) * (select count(*) from public.master_award_types where year=p_year) then raise exception '選択できる作品数を超えています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object' or e->>'video_id' is null or e->>'award_code' is null or (e ? 'comment' and jsonb_typeof(e->'comment') not in ('string','null')) or char_length(e->>'comment') > 1000) then raise exception '投票内容または感想が不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'award_code', e->>'video_id' having count(*) > 1) then raise exception '同じ部門で作品が重複しています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e left join public.master_award_types a on a.year=p_year and a.code = e->>'award_code' left join public.data_mad v on v.year = p_year and v.video_id = e->>'video_id' where a.code is null or v.video_id is null or not v.is_active or v.author_nico_user_id = nico or (a.code = 'theme' and nullif(btrim(v.theme),'') is null)) then raise exception '自薦・無効な作品・テーマ未記入の作品には投票できません。'; end if;
  for award_row in select * from public.master_award_types where year=p_year loop
    select count(*) into n from jsonb_array_elements(p_entries) e where e->>'award_code' = award_row.code;
    if p_final and (n > award_row.max_votes or n < award_row.min_votes) then raise exception '%は%～%作品選択してください。', award_row.name, award_row.min_votes, award_row.max_votes; end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_year_import(p_videos jsonb, p_expected integer, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer; updated integer; removed integer; e record;
begin
  perform private.require_admin_year(p_year);
  perform pg_advisory_xact_lock(2026,1);
  if p_expected is null or p_expected <> (select master_revision from public.master_poll_settings where year = p_year) then raise exception '作品マスターが更新されました。プレビューをやり直してください。' using errcode = '40001'; end if;
  if p_videos is null or jsonb_typeof(p_videos) <> 'array' or jsonb_array_length(p_videos) not between 1 and 2000 then raise exception '作品データが不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_videos) v group by v->>'video_id' having count(*) > 1) then raise exception '作品IDが重複しています。'; end if;
  select count(*) into inserted from jsonb_array_elements(p_videos) v where not exists(select 1 from public.data_mad old where old.year = p_year and old.video_id = v->>'video_id');
  updated := jsonb_array_length(p_videos) - inserted;
  insert into public.data_mad(year,video_id,display_order,title,author_nico_user_id,author_name,theme,watch_url,posted_at,is_active)
  select p_year,v->>'video_id',(v->>'display_order')::integer,v->>'title',coalesce(nullif(ltrim(btrim(v->>'author_nico_user_id'),'0'),''),'0'),v->>'author_name',nullif(btrim(v->>'theme'),''),v->>'watch_url',(v->>'posted_at')::date,(v->>'is_active')::boolean from jsonb_array_elements(p_videos) v
  on conflict(year,video_id) do update set display_order = excluded.display_order,title = excluded.title,author_nico_user_id = excluded.author_nico_user_id,author_name = excluded.author_name,theme = excluded.theme,watch_url = excluded.watch_url,posted_at = excluded.posted_at,is_active = excluded.is_active,updated_at = now();
  for e in select b.voter_id, jsonb_agg(jsonb_build_object('award_code',be.award_code,'video_id',be.video_id,'comment',be.comment)) as entries from public.data_ballot b join public.data_ballots be on be.ballot_id = b.id where b.year = p_year and b.status = 'submitted' group by b.id loop
    perform private.validate_year_entries(e.voter_id,e.entries,true,p_year);
  end loop;
  -- Advance draft revisions for every affected master update, so stale clients cannot restore invalid choices.
  update public.data_ballot set revision = revision + 1,updated_at = now() where year = p_year and status = 'draft' and exists(select 1 from public.data_ballots be join jsonb_array_elements(p_videos) v on v->>'video_id' = be.video_id where be.ballot_id = data_ballot.id);
  delete from public.data_ballots be using public.data_ballot b,public.data_mad v,public.data_profiles p where be.ballot_id = b.id and b.year = p_year and b.status = 'draft' and p.user_id = b.voter_id and be.year = v.year and be.video_id = v.video_id and (not v.is_active or v.author_nico_user_id = p.nico_user_id or (be.award_code = 'theme' and v.theme is null));
  get diagnostics removed = row_count;
  update public.master_poll_settings set master_revision = master_revision + 1 where year = p_year;
  insert into public.audit_logs(actor,year,action,summary) values(auth.uid(),p_year,'import',jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed));
  return jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed);
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_year_reopen(p_voter uuid, p_reason text, p_year integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin_year(p_year); perform pg_advisory_xact_lock(2026,1);
  if char_length(btrim(p_reason)) not between 1 and 500 or p_reason is null then raise exception '再開理由を入力してください。'; end if;
  update public.data_ballot set status = 'draft',submitted_at = null,revision = revision + 1,updated_at = now() where source = 'site' and year = p_year and voter_id = p_voter and status = 'submitted';
  if not found then raise exception '確定済み投票が見つかりません。'; end if;
  insert into public.audit_logs(actor,year,action,target,summary) values(auth.uid(),p_year,'reopen',p_voter::text,jsonb_build_object('reason',p_reason));
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_year_thumbnail(p_video text, p_url text, p_year integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin_year(p_year); perform pg_advisory_xact_lock(2026,1);
  update public.data_mad set thumbnail_url = p_url,updated_at = now() where year = p_year and video_id = p_video;
  if not found then raise exception '作品が見つかりません。'; end if;
  insert into public.audit_logs(actor,year,action,target) values(auth.uid(),p_year,'thumbnail',p_video);
end $function$
;
-- The identity is shared across years. Keep submitted ballots intact and clear
-- newly self-voting DRAFT choices in every year, never imported originals.
create function private.admin_year_profile(p_voter uuid,p_nico text,p_reason text,p_year integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare nico text; removed integer;
begin
  perform private.require_admin_year(p_year);
  if p_nico is null or btrim(p_nico) !~ '^[0-9]{1,30}$' or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception '正しいIDと修正理由を入力してください。';
  end if;
  if not exists(select 1 from public.data_ballot where year=p_year and source='site' and voter_id=p_voter) then
    raise exception '選択年度のサイト投票者が見つかりません。';
  end if;
  if exists(select 1 from public.data_ballot where source='site' and voter_id=p_voter and status='submitted') then
    raise exception 'ニコニコIDは全年度共通です。確定済み投票がある年度を先に再開してください。';
  end if;
  nico:=coalesce(nullif(ltrim(btrim(p_nico),'0'),''),'0');
  update public.data_profiles set nico_user_id=nico,updated_at=now() where user_id=p_voter;
  if not found then raise exception 'プロフィールが見つかりません。'; end if;
  delete from public.data_ballots e using public.data_ballot b,public.data_mad v
    where e.ballot_id=b.id and b.source='site' and b.status='draft' and b.voter_id=p_voter
      and v.year=e.year and v.video_id=e.video_id and v.author_nico_user_id=nico;
  get diagnostics removed=row_count;
  update public.data_ballot set revision=revision+1,updated_at=now()
    where source='site' and status='draft' and voter_id=p_voter;
  insert into public.audit_logs(actor,year,action,target,summary)
    values(auth.uid(),p_year,'profile_correction',p_voter::text,
      jsonb_build_object('reason',p_reason,'removed_drafts',removed,'profile_scope','all_years'));
  return jsonb_build_object('removed',removed);
end $$;

revoke all on function private.validate_year_entries(uuid,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function private.validate_year_entries(uuid,jsonb,boolean,integer) to authenticated,service_role;

revoke all on function private.admin_year_import(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function private.admin_year_import(jsonb,integer,integer) to authenticated,service_role;
create function public.admin_year_import(p_videos jsonb, p_expected integer, p_year integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_year_import(p_videos,p_expected,p_year) $$;
revoke all on function public.admin_year_import(jsonb,integer,integer) from public,anon;
grant execute on function public.admin_year_import(jsonb,integer,integer) to authenticated;

revoke all on function private.admin_year_reopen(uuid,text,integer) from public,anon,authenticated;
grant execute on function private.admin_year_reopen(uuid,text,integer) to authenticated,service_role;
create function public.admin_year_reopen(p_voter uuid, p_reason text, p_year integer) returns void
language sql security invoker set search_path='' as $$ select private.admin_year_reopen(p_voter,p_reason,p_year) $$;
revoke all on function public.admin_year_reopen(uuid,text,integer) from public,anon;
grant execute on function public.admin_year_reopen(uuid,text,integer) to authenticated;

revoke all on function private.admin_year_thumbnail(text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_year_thumbnail(text,text,integer) to authenticated,service_role;
create function public.admin_year_thumbnail(p_video text, p_url text, p_year integer) returns void
language sql security invoker set search_path='' as $$ select private.admin_year_thumbnail(p_video,p_url,p_year) $$;
revoke all on function public.admin_year_thumbnail(text,text,integer) from public,anon;
grant execute on function public.admin_year_thumbnail(text,text,integer) to authenticated;

revoke all on function private.admin_year_profile(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function private.admin_year_profile(uuid,text,text,integer) to authenticated,service_role;
create function public.admin_year_profile(p_voter uuid, p_nico text, p_reason text, p_year integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_year_profile(p_voter,p_nico,p_reason,p_year) $$;
revoke all on function public.admin_year_profile(uuid,text,text,integer) from public,anon;
grant execute on function public.admin_year_profile(uuid,text,text,integer) to authenticated;

commit;
