-- Preserve the award definitions and incoming ballot FK while renaming in place.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(2026,1);
lock table public.award_types in access exclusive mode;
do $preflight$
begin
  if to_regclass('public.master_award_types') is not null then
    raise exception 'master_award_types already exists; inspect the schema before retrying.';
  end if;
  if not exists(select 1 from pg_class where oid='public.award_types'::regclass and relkind='r' and relrowsecurity) then
    raise exception 'Expected a physical award table with RLS enabled.';
  end if;
end
$preflight$;
select set_config('anipafe.award_rename_before',(select jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.award_types),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by code),'')) from public.award_types t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid or confrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid))
from pg_class c where c.oid='public.award_types'::regclass)::text,true);
alter table public.award_types rename to master_award_types;

-- Preserve function OIDs, owners, EXECUTE grants and public RPC contracts.
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
    from public.master_award_types a cross join public.data_mad v left join public.data_ballots be on be.award_code = a.code and be.video_id = v.video_id and exists(select 1 from public.data_ballot b where b.id = be.ballot_id and b.status = 'submitted')
    where v.is_active and (a.code <> 'theme' or v.theme is not null) group by a.code,v.video_id
  ) r;
  select coalesce(jsonb_agg(jsonb_build_object('award_name',a.name,'video_id',v.video_id,'title',v.title,'display_name',p.display_name,'nico_user_id',p.nico_user_id,'comment',e.comment,'submitted_at',b.submitted_at) order by a.display_order,v.display_order),'[]') into details from public.data_ballots e join public.data_ballot b on b.id = e.ballot_id and b.status = 'submitted' join public.data_profiles p on p.user_id = b.voter_id join public.data_mad v on v.video_id = e.video_id join public.master_award_types a on a.code = e.award_code;
  return jsonb_build_object('stats',jsonb_build_object('videos',(select count(*) from public.data_mad where is_active),'themed',(select count(*) from public.data_mad where is_active and theme is not null),'google_users',(select count(distinct user_id) from auth.identities where provider = 'google'),'drafts',(select count(*) from public.data_ballot where status = 'draft'),'submitted',(select count(*) from public.data_ballot where status = 'submitted')),'rankings',rankings,'details',details);
end $function$;

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
  if jsonb_array_length(p_entries) > (select count(*) from public.data_mad where is_active) * (select count(*) from public.master_award_types) then raise exception '選択できる作品数を超えています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object' or e->>'video_id' is null or e->>'award_code' is null or (e ? 'comment' and jsonb_typeof(e->'comment') not in ('string','null')) or char_length(e->>'comment') > 1000) then raise exception '投票内容または感想が不正です。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e group by e->>'award_code', e->>'video_id' having count(*) > 1) then raise exception '同じ部門で作品が重複しています。'; end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e left join public.master_award_types a on a.code = e->>'award_code' left join public.data_mad v on v.video_id = e->>'video_id' where a.code is null or v.video_id is null or not v.is_active or v.author_nico_user_id = nico or (a.code = 'theme' and nullif(btrim(v.theme),'') is null)) then raise exception '自薦・無効な作品・テーマ未記入の作品には投票できません。'; end if;
  for award_row in select * from public.master_award_types loop
    select count(*) into n from jsonb_array_elements(p_entries) e where e->>'award_code' = award_row.code;
    if p_final and (n > award_row.max_votes or n < award_row.min_votes) then raise exception '%は%～%作品選択してください。', award_row.name, award_row.min_votes, award_row.max_votes; end if;
  end loop;
end $function$;

create view public.award_types with (security_invoker = true) as select * from public.master_award_types;
revoke all on public.award_types from public, anon, authenticated, service_role;
grant select on public.award_types to authenticated;
grant all on public.award_types to service_role;
comment on view public.award_types is 'Compatibility view for public.master_award_types; security_invoker preserves RLS.';
do $verify$
begin
  if (select jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.master_award_types),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by code),'')) from public.master_award_types t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid or confrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid))
from pg_class c where c.oid='public.master_award_types'::regclass) is distinct from current_setting('anipafe.award_rename_before')::jsonb then
    raise exception 'Award rename changed data, privileges or constraints; rolling back.';
  end if;
end
$verify$;
notify pgrst, 'reload schema';
commit;
