-- Dedicated AniPAFE project only. Existing users/votes remain untouched.
-- All temporary identities, votes and settings roll back in the nested block.
do $verification$
declare
  test_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  test_nico text := '999999999999999999999999999999';
  entries jsonb;
  result jsonb := '{}';
  receipt jsonb;
  revision integer;
  denied boolean;
  relation_name text;
begin
  begin
    perform pg_advisory_xact_lock(2026,1);
    while exists(select 1 from public.profiles where nico_user_id=test_nico)
       or exists(select 1 from public.data_mad where author_nico_user_id=test_nico) loop
      test_nico := (test_nico::numeric - 1)::text;
    end loop;
    insert into auth.users(id,aud,role,email,created_at,updated_at)
      values(test_user,'authenticated','authenticated','anipafe-rename-test-'||test_user||'@example.invalid',now(),now()),
            (other_user,'authenticated','authenticated','anipafe-rename-test-'||other_user||'@example.invalid',now(),now());
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      values(test_user::text,test_user,jsonb_build_object('sub',test_user::text),'google',now(),now()),
            (other_user::text,other_user,jsonb_build_object('sub',other_user::text),'google',now(),now());
    update public.poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where id=1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',test_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
    perform public.save_profile('テーブル改名検証',test_nico);
    select b.revision into revision from public.data_ballot b where b.voter_id=test_user;
    select jsonb_agg(chosen.entry) into entries from (
      select jsonb_build_object('award_code','overall','video_id',v.video_id,'comment','改名検証用感想') as entry
        from (select video_id from public.data_mad where is_active order by display_order limit 5) v
      union all
      select jsonb_build_object('award_code',award.code,'video_id',v.video_id,'comment','')
        from public.award_types award cross join lateral (select video_id from public.data_mad where is_active order by display_order limit 1) v
        where award.code in ('music','composition','creative','humor')
      union all
      select jsonb_build_object('award_code','theme','video_id',v.video_id,'comment','')
        from (select video_id from public.data_mad where is_active and theme is not null order by display_order limit 1) v
    ) chosen;
    perform public.save_draft(entries,revision);
    result := result || jsonb_build_object(
      'new_entries_saved',(select count(*)=10 from public.data_ballots),
      'old_entries_match',(select count(*)=10 from public.ballot_entries),
      'old_ballot_matches',(select count(*)=1 from public.ballots),
      'video_names_match',(select count(*) from public.data_mad)=(select count(*) from public.videos));
    foreach relation_name in array array['videos','data_mad','ballots','data_ballot','ballot_entries','data_ballots'] loop
      denied := false;
      begin execute format('delete from public.%I where false',relation_name);
      exception when insufficient_privilege then denied := true;
      end;
      result := result || jsonb_build_object(relation_name||'_direct_write_denied',denied);
    end loop;
    select b.revision into revision from public.data_ballot b where b.voter_id=test_user;
    receipt := public.submit_ballot(revision);
    result := result || jsonb_build_object('submitted',receipt->>'submitted_at' is not null,'idempotent_submit',receipt=public.submit_ballot(revision));
    denied := false;
    begin perform public.admin_report(); exception when insufficient_privilege then denied := true; end;
    result := result || jsonb_build_object('admin_denied',denied);
    perform set_config('request.jwt.claim.sub',other_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
    result := result || jsonb_build_object(
      'other_new_ballot_hidden',(select count(*)=0 from public.data_ballot),
      'other_old_ballot_hidden',(select count(*)=0 from public.ballots),
      'other_new_entries_hidden',(select count(*)=0 from public.data_ballots),
      'other_old_entries_hidden',(select count(*)=0 from public.ballot_entries));
    execute 'reset role';
    insert into public.admin_users values(test_user);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',test_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
    result := result || jsonb_build_object('admin_report_works',(public.admin_report()->'stats'->>'videos')::integer=107);
    execute 'reset role';
    execute 'set local role anon';
    foreach relation_name in array array['videos','data_mad','ballots','data_ballot','ballot_entries','data_ballots'] loop
      denied := false;
      begin execute format('select 1 from public.%I limit 1',relation_name);
      exception when insufficient_privilege then denied := true;
      end;
      result := result || jsonb_build_object(relation_name||'_anon_denied',denied);
    end loop;
    if exists(select 1 from jsonb_each(result) r where r.value <> 'true'::jsonb) then
      raise exception 'Table rename verification failed: %',result;
    end if;
    raise exception using errcode='ZX001',message='Rollback rename verification fixtures';
  exception when sqlstate 'ZX001' then
    perform set_config('anipafe.rename_verification',result::text,true);
  end;
end
$verification$;
select current_setting('anipafe.rename_verification',true)::jsonb as verification;
