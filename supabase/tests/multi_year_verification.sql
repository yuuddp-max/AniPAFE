-- Dedicated AniPAFE project only. All test writes are rolled back.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $verify$
declare administrator uuid; payload jsonb; original_entries text; original_videos text; h jsonb;
begin
  select a.auth_user_id into administrator from public.master_admin_users a
    join public.data_profiles p on p.user_id=a.auth_user_id
    where exists(select 1 from auth.identities i where i.user_id=a.auth_user_id and i.provider='google') limit 1;
  if administrator is null then raise exception 'A registered Google administrator is required for verification.'; end if;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  select md5(coalesce(string_agg(to_jsonb(e)::text,'' order by id),'')) into original_entries from public.data_ballots e where year=2026;
  select md5(coalesce(string_agg(to_jsonb(v)::text,'' order by video_id),'')) into original_videos from public.data_mad v where year=2026;
  perform public.manage_year('create',2099,'年度分離の検証',null,null,false,false,2026);
  perform public.manage_year('switch',2099,'',null,null,false,false,2026);
  if (public.poll_header()->>'year')::integer<>2099 then raise exception 'Header did not switch.'; end if;
  if exists(select 1 from public.data_mad where year=2099) then raise exception 'New year contains previous videos.'; end if;
  begin
    perform public.save_draft('[]',0,2026);
    raise exception 'Stale-year write was accepted.';
  exception when serialization_failure then null; end;
  select jsonb_agg(to_jsonb(v)) into payload from public.data_mad v where year=2026 and display_order=1;
  perform public.admin_import(payload,1,2099);
  perform public.manage_year('settings',2099,'年度分離の検証',now()-interval '1 hour',now()+interval '1 hour',true,false,2099);
  perform public.save_draft('[]',0,2099);
  if not exists(select 1 from public.data_ballot where year=2099 and voter_id=administrator and status='draft') then
    raise exception 'New-year ballot was not created.';
  end if;
  h:=public.vote_history(2026);
  if h->>'results_public'<>'false' or h->'rankings'<>'[]'::jsonb then raise exception 'Unpublished rankings were exposed.'; end if;
  if exists(select 1 from jsonb_array_elements(h->'entries') e where not exists(
    select 1 from public.data_ballots be join public.data_ballot b on b.id=be.ballot_id
    where b.voter_id=administrator and b.year=2026 and be.video_id=e->>'video_id' and be.award_code=e->>'award_code'
  )) then raise exception 'History contains another voter.'; end if;
  if (select md5(coalesce(string_agg(to_jsonb(e)::text,'' order by id),'')) from public.data_ballots e where year=2026) is distinct from original_entries
    or (select md5(coalesce(string_agg(to_jsonb(v)::text,'' order by video_id),'')) from public.data_mad v where year=2026) is distinct from original_videos then
    raise exception 'New-year operations modified the original year.';
  end if;
end $verify$;
rollback;
select jsonb_build_object('verification','passed; all test writes rolled back','header',public.poll_header(),
  'years',(select count(*) from public.master_poll_settings),
  'videos',(select count(*) from public.data_mad),'ballots',(select count(*) from public.data_ballot),
  'entries',(select count(*) from public.data_ballots)) as verification;
