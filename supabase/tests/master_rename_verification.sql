-- Dedicated AniPAFE project only. Fixtures and temporary settings all roll back.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $verification$
declare
  test_user uuid := gen_random_uuid();
  test_nico text := '999999999999999999999999999999';
  entries jsonb;
  result jsonb := '{}';
  receipt jsonb;
  revision integer;
  denied boolean;
  relation_name text;
  before_state jsonb;
  after_state jsonb;
begin
  perform pg_advisory_xact_lock(2026,1);
  select jsonb_build_object(
    'settings',(select to_jsonb(t) from public.master_poll_settings t where id=1),
    'admins',(select jsonb_agg(to_jsonb(t) order by auth_user_id) from public.master_admin_users t),
    'users',(select count(*) from auth.users),
    'profiles',(select count(*) from public.data_profiles),
    'ballots',(select count(*) from public.data_ballot),
    'entries',(select count(*) from public.data_ballots),
    'audit_logs',(select count(*) from public.audit_logs)) into before_state;
  begin
    while exists(select 1 from public.data_profiles where nico_user_id=test_nico)
       or exists(select 1 from public.data_mad where author_nico_user_id=test_nico) loop
      test_nico := (test_nico::numeric - 1)::text;
    end loop;
    insert into auth.users(id,aud,role,email,created_at,updated_at)
      values(test_user,'authenticated','authenticated','anipafe-master-rename-test-'||test_user||'@example.invalid',now(),now());
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      values(test_user::text,test_user,jsonb_build_object('sub',test_user::text),'google',now(),now());
    update public.master_poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where id=1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',test_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
    perform public.save_profile('マスター改名検証',test_nico);
    result := result || jsonb_build_object(
      'settings_names_match',(select to_jsonb(t) from public.master_poll_settings t)=(select to_jsonb(t) from public.poll_settings t),
      'old_admin_hidden',(select count(*)=0 from public.admin_users),
      'new_admin_hidden',(select count(*)=0 from public.master_admin_users));
    foreach relation_name in array array['poll_settings','master_poll_settings','admin_users','master_admin_users'] loop
      denied := false;
      begin execute format('delete from public.%I where false',relation_name);
      exception when insufficient_privilege then denied := true;
      end;
      result := result || jsonb_build_object(relation_name||'_direct_write_denied',denied);
    end loop;
    denied := false;
    begin perform public.admin_settings(now()-interval '1 day',now()+interval '1 day',false);
    exception when insufficient_privilege then denied := true;
    end;
    result := result || jsonb_build_object('nonadmin_settings_denied',denied);
    denied := false;
    begin perform public.admin_report(); exception when insufficient_privilege then denied := true; end;
    result := result || jsonb_build_object('nonadmin_report_denied',denied);
    select jsonb_agg(chosen.entry) into entries from (
      select jsonb_build_object('award_code','overall','video_id',v.video_id,'comment','マスター改名検証') as entry
        from (select video_id from public.data_mad where is_active order by display_order limit 5) v
      union all
      select jsonb_build_object('award_code',award.code,'video_id',v.video_id,'comment','')
        from public.award_types award cross join lateral (select video_id from public.data_mad where is_active order by display_order limit 1) v
        where award.code in ('music','composition','creative','humor')
      union all
      select jsonb_build_object('award_code','theme','video_id',v.video_id,'comment','')
        from (select video_id from public.data_mad where is_active and theme is not null order by display_order limit 1) v
    ) chosen;
    select b.revision into revision from public.data_ballot b where b.voter_id=test_user;
    perform public.save_draft(entries,revision);
    select b.revision into revision from public.data_ballot b where b.voter_id=test_user;
    execute 'reset role';
    insert into public.master_admin_users values(test_user);
    execute 'set local role authenticated';
    result := result || jsonb_build_object(
      'old_admin_self_visible',(select count(*)=1 from public.admin_users),
      'new_admin_self_visible',(select count(*)=1 from public.master_admin_users),
      'admin_report_works',jsonb_typeof(public.admin_report()->'stats')='object');
    perform public.admin_settings(now()-interval '1 day',now()+interval '1 day',false);
    result := result || jsonb_build_object('closed_settings_match',
      (select not is_published from public.master_poll_settings) and (select not is_published from public.poll_settings));
    denied := false;
    begin perform public.save_draft(entries,revision);
    exception when sqlstate 'P0001' then denied := position('期間外' in sqlerrm)>0;
    end;
    result := result || jsonb_build_object('closed_save_denied',denied);
    perform public.admin_settings(now()-interval '1 day',now()+interval '1 day',true);
    result := result || jsonb_build_object('open_settings_match',
      (select is_published from public.master_poll_settings) and (select is_published from public.poll_settings));
    perform public.save_draft(entries,revision);
    select b.revision into revision from public.data_ballot b where b.voter_id=test_user;
    receipt := public.submit_ballot(revision);
    result := result || jsonb_build_object('submitted',receipt->>'submitted_at' is not null,'idempotent_submit',receipt=public.submit_ballot(revision));
    execute 'reset role';
    execute 'set local role anon';
    foreach relation_name in array array['poll_settings','master_poll_settings','admin_users','master_admin_users'] loop
      denied := false;
      begin execute format('select 1 from public.%I limit 1',relation_name);
      exception when insufficient_privilege then denied := true;
      end;
      result := result || jsonb_build_object(relation_name||'_anon_denied',denied);
    end loop;
    if exists(select 1 from jsonb_each(result) r where r.value is distinct from 'true'::jsonb) then
      raise exception 'Master rename verification failed: %',result;
    end if;
    raise exception using errcode='ZX001',message='Rollback master rename fixtures';
  exception when sqlstate 'ZX001' then null;
  end;
  select jsonb_build_object(
    'settings',(select to_jsonb(t) from public.master_poll_settings t where id=1),
    'admins',(select jsonb_agg(to_jsonb(t) order by auth_user_id) from public.master_admin_users t),
    'users',(select count(*) from auth.users),
    'profiles',(select count(*) from public.data_profiles),
    'ballots',(select count(*) from public.data_ballot),
    'entries',(select count(*) from public.data_ballots),
    'audit_logs',(select count(*) from public.audit_logs)) into after_state;
  if after_state is distinct from before_state then raise exception 'Master verification fixtures were not fully rolled back'; end if;
  result := result || jsonb_build_object('fixtures_rolled_back',true);
  perform set_config('anipafe.master_verification',result::text,true);
end
$verification$;
select current_setting('anipafe.master_verification',true)::jsonb as verification;
