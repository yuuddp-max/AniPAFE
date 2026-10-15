begin;
set local lock_timeout = '5s';

-- Full admin-only snapshots, including details. No original responses are copied.
create table public.data_tally_results (
  year integer not null references public.master_poll_settings(year) on delete cascade,
  source text not null check (source in ('site','historical')),
  score_denominator integer not null check (score_denominator between 1 and 100000),
  calculation_version integer not null check (calculation_version > 0),
  input_revision bigint not null,
  calculated_at timestamptz not null default clock_timestamp(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  primary key (year,source,score_denominator,calculation_version)
);
comment on table public.data_tally_results is '年度・集計元・スコア分母・計算版ごとの運営用集計結果。明細を含むため公開禁止。';
alter table public.data_tally_results enable row level security;
revoke all on public.data_tally_results from public,anon,authenticated;
grant select on public.data_tally_results to authenticated;
grant all on public.data_tally_results to service_role;
create policy tally_results_admin_read on public.data_tally_results
  for select to authenticated using ((select private.is_admin()));

create table private.tally_input_revisions (
  year integer primary key references public.master_poll_settings(year) on delete cascade,
  revision bigint not null default 0
);
alter table private.tally_input_revisions enable row level security;
revoke all on private.tally_input_revisions from public,anon,authenticated;
insert into private.tally_input_revisions(year) select year from public.master_poll_settings;

-- Trigger-only privilege: input writes may be voters, admins or imports. No direct
-- EXECUTE grants. Transition tables bump each affected year once per statement,
-- even when importing thousands of selections. Cascaded year deletes are safe.
create function private.invalidate_tally_results() returns trigger
language plpgsql security definer set search_path='' as $$
declare affected integer[]; y integer;
begin
  if tg_op = 'TRUNCATE' then
    update private.tally_input_revisions set revision=revision+1;
    return null;
  elsif tg_table_name = 'data_profiles' then
    if tg_op = 'INSERT' then
      select array_agg(distinct b.year order by b.year) into affected
        from public.data_ballot b join new_tally_rows p on p.user_id=b.voter_id where b.source='site';
    elsif tg_op = 'DELETE' then
      select array_agg(distinct b.year order by b.year) into affected
        from public.data_ballot b join old_tally_rows p on p.user_id=b.voter_id where b.source='site';
    else
      select array_agg(distinct b.year order by b.year) into affected
        from public.data_ballot b join (select user_id from old_tally_rows union select user_id from new_tally_rows) p
        on p.user_id=b.voter_id where b.source='site';
    end if;
  elsif tg_op = 'INSERT' then
    select array_agg(distinct year order by year) into affected from new_tally_rows;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct year order by year) into affected from old_tally_rows;
  else
    select array_agg(year order by year) into affected
      from (select year from old_tally_rows union select year from new_tally_rows) years;
  end if;
  foreach y in array coalesce(affected,'{}'::integer[]) loop
    insert into private.tally_input_revisions(year,revision)
      select y,1 where exists(select 1 from public.master_poll_settings where year=y)
      on conflict(year) do update set revision=tally_input_revisions.revision+1;
  end loop;
  return null;
end $$;
revoke all on function private.invalidate_tally_results() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['data_mad','data_ballot','data_ballots','data_profiles','master_poll_settings'] loop
    execute format('create trigger tally_inputs_insert after insert on public.%I referencing new table as new_tally_rows for each statement execute function private.invalidate_tally_results()',t);
    execute format('create trigger tally_inputs_update after update on public.%I referencing old table as old_tally_rows new table as new_tally_rows for each statement execute function private.invalidate_tally_results()',t);
    execute format('create trigger tally_inputs_delete after delete on public.%I referencing old table as old_tally_rows for each statement execute function private.invalidate_tally_results()',t);
    execute format('create trigger tally_inputs_truncate after truncate on public.%I for each statement execute function private.invalidate_tally_results()',t);
  end loop;
end $$;

create function private.admin_tally_state(p_year integer,p_source text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rev bigint; selected_source text;
begin
  perform private.require_admin();
  if p_source is null or p_source not in ('auto','site','historical') then raise exception '集計元が不正です。'; end if;
  select revision into rev from private.tally_input_revisions where year=p_year;
  if rev is null then raise exception '年度が登録されていません。'; end if;
  selected_source := case when p_source='auto' then
    case when exists(select 1 from public.data_ballot where year=p_year and source='historical' and status='imported') then 'historical' else 'site' end
    else p_source end;
  return jsonb_build_object('revision',rev::text,'source',selected_source);
end $$;

create function private.admin_save_tally_result(
  p_year integer,p_source text,p_denominator integer,p_version integer,p_revision bigint,p_result jsonb
) returns timestamptz language plpgsql security definer set search_path='' as $$
declare current_revision bigint; saved_at timestamptz;
begin
  perform private.require_admin();
  -- Serialize publication against invalidation. Never label an old calculation
  -- with a new revision when a vote/import changes during paginated loading.
  select revision into current_revision from private.tally_input_revisions where year=p_year for share;
  if current_revision is distinct from p_revision then return null; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object'
    or (p_result->>'year')::integer is distinct from p_year
    or p_result->>'source' is distinct from p_source
    or (p_result->>'score_denominator')::integer is distinct from p_denominator
    or jsonb_typeof(p_result->'rankings') is distinct from 'array'
    or jsonb_typeof(p_result->'scores') is distinct from 'array'
    or jsonb_typeof(p_result->'details') is distinct from 'array'
    or p_result ? 'raw_response'
    then raise exception '集計結果の形式が不正です。'; end if;
  insert into public.data_tally_results(year,source,score_denominator,calculation_version,input_revision,result)
    values(p_year,p_source,p_denominator,p_version,p_revision,p_result)
    on conflict(year,source,score_denominator,calculation_version) do update
      set input_revision=excluded.input_revision,result=excluded.result,calculated_at=clock_timestamp()
    returning calculated_at into saved_at;
  return saved_at;
end $$;

revoke all on function private.admin_tally_state(integer,text) from public,anon,authenticated;
revoke all on function private.admin_save_tally_result(integer,text,integer,integer,bigint,jsonb) from public,anon,authenticated;
grant execute on function private.admin_tally_state(integer,text) to authenticated;
grant execute on function private.admin_save_tally_result(integer,text,integer,integer,bigint,jsonb) to authenticated;

create function public.admin_tally_state(p_year integer,p_source text) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_tally_state(p_year,p_source) $$;
create function public.admin_save_tally_result(
  p_year integer,p_source text,p_denominator integer,p_version integer,p_revision bigint,p_result jsonb
) returns timestamptz language sql security invoker set search_path='' as $$
  select private.admin_save_tally_result(p_year,p_source,p_denominator,p_version,p_revision,p_result)
$$;
revoke all on function public.admin_tally_state(integer,text) from public,anon,authenticated;
revoke all on function public.admin_save_tally_result(integer,text,integer,integer,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.admin_tally_state(integer,text) to authenticated;
grant execute on function public.admin_save_tally_result(integer,text,integer,integer,bigint,jsonb) to authenticated;

-- Registration counters do not need the legacy admin_report's unused rankings
-- and details. Keep that RPC's contract intact for older deployments.
create function private.admin_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare y integer;
begin
  perform private.require_admin(); y:=private.current_year();
  return jsonb_build_object('year',y,'stats',jsonb_build_object(
    'videos',(select count(*) from public.data_mad where year=y and is_active),
    'themed',(select count(*) from public.data_mad where year=y and is_active and theme is not null),
    'google_users',(select count(distinct user_id) from auth.identities where provider='google'),
    'drafts',(select count(*) from public.data_ballot where year=y and status='draft'),
    'submitted',(select count(*) from public.data_ballot where year=y and status='submitted')));
end $$;
revoke all on function private.admin_summary() from public,anon,authenticated;
grant execute on function private.admin_summary() to authenticated;
create function public.admin_summary() returns jsonb language sql security invoker set search_path='' as $$ select private.admin_summary() $$;
revoke all on function public.admin_summary() from public,anon,authenticated;
grant execute on function public.admin_summary() to authenticated;
notify pgrst,'reload schema';
commit;
