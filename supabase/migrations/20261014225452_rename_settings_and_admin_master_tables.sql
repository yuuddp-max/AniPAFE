-- Rename both master tables atomically while retaining data and authorization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(2026,1);
lock table public.poll_settings, public.admin_users in access exclusive mode;
do $preflight$
begin
  if to_regclass('public.master_poll_settings') is not null or to_regclass('public.master_admin_users') is not null then
    raise exception 'Master rename target already exists; inspect the schema before retrying.';
  end if;
  if (select count(*) from pg_class where oid in ('public.poll_settings'::regclass,'public.admin_users'::regclass) and relkind='r' and relrowsecurity) <> 2 then
    raise exception 'Expected two physical master tables with RLS enabled.';
  end if;
end
$preflight$;
select set_config('anipafe.master_rename_before',(select jsonb_object_agg(name,metadata) from (select 'master_poll_settings' as name,jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.poll_settings),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.poll_settings t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid)) as metadata
from pg_class c where c.oid='public.poll_settings'::regclass union all select 'master_admin_users' as name,jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.admin_users),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by auth_user_id),'')) from public.admin_users t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid)) as metadata
from pg_class c where c.oid='public.admin_users'::regclass) s)::text,true);
alter table public.poll_settings rename to master_poll_settings;
alter table public.admin_users rename to master_admin_users;

-- Preserve function OIDs, owners, search_path and EXECUTE grants.
-- Public RPC names, arguments and JSON responses remain unchanged.
CREATE OR REPLACE FUNCTION private.admin_settings(p_start timestamp with time zone, p_end timestamp with time zone, p_published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin(); perform pg_advisory_xact_lock(2026,1);
  update public.master_poll_settings set starts_at = p_start,ends_at = p_end,is_published = p_published where id = 1;
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'settings',jsonb_build_object('starts_at',p_start,'ends_at',p_end,'published',p_published));
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
  if p_expected is null or p_expected <> (select master_revision from public.master_poll_settings where id = 1) then raise exception '作品マスターが更新されました。プレビューをやり直してください。' using errcode = '40001'; end if;
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
  delete from public.data_ballots be using public.data_ballot b,public.data_mad v,public.data_profiles p where be.ballot_id = b.id and b.status = 'draft' and p.user_id = b.voter_id and be.video_id = v.video_id and (not v.is_active or v.author_nico_user_id = p.nico_user_id or (be.award_code = 'theme' and v.theme is null));
  get diagnostics removed = row_count;
  update public.master_poll_settings set master_revision = master_revision + 1 where id = 1;
  insert into public.audit_logs(actor,action,summary) values(auth.uid(),'import',jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed));
  return jsonb_build_object('inserted',inserted,'updated',updated,'removed_drafts',removed);
end $function$;

CREATE OR REPLACE FUNCTION private.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.is_google() and exists(select 1 from public.master_admin_users where auth_user_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION private.require_open()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.master_poll_settings where id = 1 and is_published and starts_at <= now() and now() < ends_at)
  then raise exception '現在は投票期間外です。'; end if;
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
  result := private.import_master(p_videos,(select master_revision from public.master_poll_settings where id = 1));
  if p_initial and ((select count(*) from public.data_mad where is_active) <> 107 or (select count(*) from public.data_mad where is_active and theme is not null) <> 55) then raise exception '初期件数は107作品・テーマ55作品である必要があります。'; end if;
  return result;
end $function$;

create view public.poll_settings with (security_invoker = true) as select * from public.master_poll_settings;
create view public.admin_users with (security_invoker = true) as select * from public.master_admin_users;
revoke all on public.poll_settings, public.admin_users from public, anon, authenticated, service_role;
grant select on public.poll_settings, public.admin_users to authenticated;
grant all on public.poll_settings, public.admin_users to service_role;
comment on view public.poll_settings is 'Compatibility view for public.master_poll_settings; security_invoker preserves RLS.';
comment on view public.admin_users is 'Compatibility view for public.master_admin_users; security_invoker preserves RLS.';

do $verify$
begin
  if (select jsonb_object_agg(name,metadata) from (select 'master_poll_settings' as name,jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.master_poll_settings),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.master_poll_settings t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid)) as metadata
from pg_class c where c.oid='public.master_poll_settings'::regclass union all select 'master_admin_users' as name,jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
'rows',(select count(*) from public.master_admin_users),
'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by auth_user_id),'')) from public.master_admin_users t),
'constraints',(select jsonb_agg(to_jsonb(k) order by oid) from pg_constraint k where conrelid=c.oid),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid=c.oid),
'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid=c.oid)) as metadata
from pg_class c where c.oid='public.master_admin_users'::regclass) s) is distinct from current_setting('anipafe.master_rename_before')::jsonb then
    raise exception 'Master rename changed data or privileges; rolling back.';
  end if;
end
$verify$;
notify pgrst, 'reload schema';
commit;
