-- Rename in place; old application versions keep a read-compatible RLS view.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(2026,1);
lock table public.data_profiles in access exclusive mode;

do $preflight$
begin
  if to_regclass('public.data_loginuser') is not null then
    raise exception 'data_loginuser already exists; inspect before retrying';
  end if;
  if not exists(select 1 from pg_class where oid='public.data_profiles'::regclass and relkind='r' and relrowsecurity) then
    raise exception 'Expected data_profiles to be a physical RLS table';
  end if;
end $preflight$;

select set_config('anipafe.loginuser_before',(select jsonb_build_object(
  'oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
  'force_rls',c.relforcerowsecurity,'replica_identity',c.relreplident,
  'rows',(select count(*) from public.data_profiles),
  'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),'')) from public.data_profiles t),
  'constraints',(select jsonb_agg(to_jsonb(t) order by oid) from pg_constraint t where conrelid=c.oid or confrelid=c.oid),
  'indexes',(select jsonb_agg(to_jsonb(t) order by indexrelid) from pg_index t where indrelid=c.oid),
  'policies',(select jsonb_agg(to_jsonb(t) order by oid) from pg_policy t where polrelid=c.oid),
  'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where tgrelid=c.oid),
  'columns',(select jsonb_agg(to_jsonb(t) order by attnum) from pg_attribute t where attrelid=c.oid),
  'publications',(select jsonb_agg(to_jsonb(t) order by oid) from pg_publication_rel t where prrelid=c.oid)
) from pg_class c where c.oid='public.data_profiles'::regclass)::text,true);

select set_config('anipafe.loginuser_functions_before',coalesce((select jsonb_agg(
  jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,
    'config',p.proconfig,'returns',p.prorettype,'args',p.proargtypes::text,'argnames',p.proargnames,
    'defaults',p.proargdefaults::text,'volatility',p.provolatile) order by p.oid)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'),'[]')::text,true);

alter table public.data_profiles rename to data_loginuser;

-- Use the installed definitions so current RPC behavior and grants remain intact.
-- Recreating functions with the same signatures preserves their OIDs and ACLs.
do $functions$
declare f record; definition text; changed integer:=0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and p.prosrc like '%data_profiles%'
    order by p.oid
  loop
    definition:=replace(pg_get_functiondef(f.oid),'public.data_profiles','public.data_loginuser');
    definition:=replace(definition,'tg_table_name = ''data_profiles''','tg_table_name = ''data_loginuser''');
    if definition like '%data_profiles%' then
      raise exception 'Unrecognized old-table reference in function %',f.oid::regprocedure;
    end if;
    execute definition;
    changed:=changed+1;
  end loop;
  if changed<1 then raise exception 'Expected dependent functions'; end if;
end $functions$;

create view public.data_profiles with (security_invoker=true) as select * from public.data_loginuser;
revoke all on public.data_profiles from public,anon,authenticated,service_role;
grant select on public.data_profiles to authenticated;
grant all on public.data_profiles to service_role;
comment on view public.data_profiles is 'Compatibility view for public.data_loginuser; security_invoker preserves RLS.';

do $verify$
declare after_state jsonb; functions_after jsonb;
begin
  select jsonb_build_object(
    'oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,'replica_identity',c.relreplident,
    'rows',(select count(*) from public.data_loginuser),
    'checksum',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),'')) from public.data_loginuser t),
    'constraints',(select jsonb_agg(to_jsonb(t) order by oid) from pg_constraint t where conrelid=c.oid or confrelid=c.oid),
    'indexes',(select jsonb_agg(to_jsonb(t) order by indexrelid) from pg_index t where indrelid=c.oid),
    'policies',(select jsonb_agg(to_jsonb(t) order by oid) from pg_policy t where polrelid=c.oid),
    'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where tgrelid=c.oid),
    'columns',(select jsonb_agg(to_jsonb(t) order by attnum) from pg_attribute t where attrelid=c.oid),
    'publications',(select jsonb_agg(to_jsonb(t) order by oid) from pg_publication_rel t where prrelid=c.oid)
  ) into after_state from pg_class c where c.oid='public.data_loginuser'::regclass;
  if after_state is distinct from current_setting('anipafe.loginuser_before')::jsonb then
    raise exception 'Login user rows or table metadata changed';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
    'definer',p.prosecdef,'config',p.proconfig,'returns',p.prorettype,'args',p.proargtypes::text,
    'argnames',p.proargnames,'defaults',p.proargdefaults::text,'volatility',p.provolatile) order by p.oid),'[]')
    into functions_after from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f';
  if functions_after is distinct from current_setting('anipafe.loginuser_functions_before')::jsonb then
    raise exception 'Function signature, ownership or privileges changed';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and p.prosrc like '%data_profiles%') then
    raise exception 'Old function references remain';
  end if;
end $verify$;
notify pgrst,'reload schema';
commit;
