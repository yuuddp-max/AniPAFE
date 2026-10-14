-- Run only on a newly initialized dedicated AniPAFE project with imported video data.
-- The nested block deliberately rolls back every temporary identity/profile/vote/settings change.
do $verification$
declare
  test_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  test_video text;
  test_nico text;
  entries jsonb;
  result jsonb := '{}';
  receipt jsonb;
  revision integer;
  denied boolean;
begin
  if exists(select 1 from public.profiles) or exists(select 1 from public.ballots) then
    raise exception 'Run cloud verification only before real voting starts';
  end if;
  begin
    perform pg_advisory_xact_lock(2026,1);
    insert into auth.users(id,aud,role,email,created_at,updated_at)
      values(test_user,'authenticated','authenticated','anipafe-db-test-'||test_user||'@example.invalid',now(),now()),
            (other_user,'authenticated','authenticated','anipafe-db-test-'||other_user||'@example.invalid',now(),now());
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      values(test_user::text,test_user,jsonb_build_object('sub',test_user::text),'google',now(),now()),
            (other_user::text,other_user,jsonb_build_object('sub',other_user::text),'google',now(),now());
    update public.poll_settings set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day',is_published=true where id=1;
    select video_id,author_nico_user_id into test_video,test_nico from public.videos where is_active order by display_order limit 1;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',test_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
    perform public.save_profile('DB検証用',test_nico);
    select b.revision into revision from public.ballots b where b.voter_id=test_user;
    denied := false;
    begin
      perform public.save_draft(jsonb_build_array(jsonb_build_object('award_code','overall','video_id',test_video,'comment','')),revision);
    exception when sqlstate 'P0001' then denied := position('自薦' in sqlerrm)>0;
    end;
    result := result || jsonb_build_object('self_vote_rejected',denied);
    select jsonb_agg(chosen.entry) into entries from (
      select jsonb_build_object('award_code','overall','video_id',v.video_id,'comment','DB検証用感想') as entry
        from (select video_id from public.videos where is_active and author_nico_user_id<>test_nico order by display_order limit 5) v
      union all
      select jsonb_build_object('award_code',award.code,'video_id',v.video_id,'comment','')
        from public.award_types award cross join lateral (select video_id from public.videos where is_active and author_nico_user_id<>test_nico order by display_order limit 1) v
        where award.code in ('music','composition','creative','humor')
      union all
      select jsonb_build_object('award_code','theme','video_id',v.video_id,'comment','')
        from (select video_id from public.videos where is_active and theme is not null and author_nico_user_id<>test_nico order by display_order limit 1) v
    ) chosen;
    perform public.save_draft(entries,revision);
    select b.revision into revision from public.ballots b where b.voter_id=test_user;
    result := result || jsonb_build_object('draft_persisted', (select count(*)=10 from public.ballot_entries));
    receipt := public.submit_ballot(revision);
    result := result || jsonb_build_object('submitted',receipt->>'submitted_at' is not null,'idempotent_submit',receipt=public.submit_ballot(revision));
    denied := false;
    begin perform public.save_profile('DB検証用','999999999999999999999999999');
    exception when sqlstate 'P0001' then denied := position('確定後' in sqlerrm)>0;
    end;
    result := result || jsonb_build_object('submitted_id_locked',denied);
    denied := false;
    begin perform public.admin_report(); exception when insufficient_privilege then denied := true; end;
    result := result || jsonb_build_object('admin_denied',denied);
    perform set_config('request.jwt.claim.sub',other_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
    result := result || jsonb_build_object('other_ballot_hidden',(select count(*)=0 from public.ballots),'other_entries_hidden',(select count(*)=0 from public.ballot_entries));
    if exists(select 1 from jsonb_each(result) r where r.value <> 'true'::jsonb) then raise exception 'DB verification failed: %',result; end if;
    raise exception using errcode='ZX001',message='Rollback test fixtures';
  exception when sqlstate 'ZX001' then
    perform set_config('anipafe.verification',result::text,true);
  end;
end
$verification$;
select current_setting('anipafe.verification',true)::jsonb as verification;
