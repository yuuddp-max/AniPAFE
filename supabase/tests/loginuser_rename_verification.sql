-- Read-only verification after the login user table rename.
select jsonb_build_object(
  'physical_table',(select relkind='r' and relrowsecurity from pg_class where oid='public.data_login_user'::regclass),
  'legacy_invoker_view',(select relkind='v' and reloptions @> array['security_invoker=true'] from pg_class where oid='public.data_profiles'::regclass),
  'row_count',(select count(*) from public.data_login_user),
  'old_new_rows_equal',not exists((select * from public.data_login_user except select * from public.data_profiles)
    union all (select * from public.data_profiles except select * from public.data_login_user)),
  'old_function_references', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and (p.prosrc like '%data_profiles%' or p.prosrc like '%data_loginuser%')),
  'anon_denied',not has_table_privilege('anon','public.data_login_user','SELECT') and not has_table_privilege('anon','public.data_profiles','SELECT'),
  'authenticated_select',has_table_privilege('authenticated','public.data_login_user','SELECT') and has_table_privilege('authenticated','public.data_profiles','SELECT'),
  'direct_writes_denied',not has_table_privilege('authenticated','public.data_login_user','INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_table_privilege('authenticated','public.data_profiles','INSERT,UPDATE,DELETE,TRUNCATE')
) as verification;
