-- Scope award definitions, validation, and reports to the ballot year.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(2026,1);
lock table public.master_award_types,public.master_poll_settings,
  public.data_ballots,public.data_historical_ballots in access exclusive mode;

select set_config('anipafe.yearly_awards_before',jsonb_build_object(
  'awards',(select jsonb_agg(to_jsonb(t) order by code) from public.master_award_types t),
  'live_entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballots t),
  'historical_entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_historical_ballots t),
  'ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballot t),
  'historical_ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_historical_ballot t),
  'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
  'event',(select to_jsonb(t) from public.master_event_settings t where id=1)
)::text,true);

alter table public.data_ballots drop constraint ballot_entries_award_code_fkey;
alter table public.data_historical_ballots drop constraint data_historical_ballots_award_code_fkey;
alter table public.master_award_types add column year integer not null default 2026
  references public.master_poll_settings(year);
alter table public.master_award_types drop constraint award_types_pkey,
  drop constraint award_types_display_order_key;
alter table public.master_award_types add constraint award_types_pkey primary key(year,code),
  add constraint award_types_year_display_order_key unique(year,display_order);

insert into public.master_award_types(year,code,name,min_votes,max_votes,display_order)
select p.year,a.code,a.name,a.min_votes,a.max_votes,a.display_order
from public.master_poll_settings p cross join public.master_award_types a
where a.year=2026 and p.year<>2026;

alter table public.data_ballots add constraint ballot_entries_award_code_fkey
  foreign key(year,award_code) references public.master_award_types(year,code);
alter table public.data_historical_ballots add constraint data_historical_ballots_award_code_fkey
  foreign key(year,award_code) references public.master_award_types(year,code);
create index ballot_entries_year_award_idx on public.data_ballots(year,award_code);
create index historical_entries_year_award_idx on public.data_historical_ballots(year,award_code);

-- Unfiltered deployed clients must still receive only the current six awards.
-- Past-year names and rules are resolved inside the authorized history RPCs.
alter policy awards_read on public.master_award_types using
  (private.is_google() and year=(select private.current_year()));

do $functions$
declare definition text;
begin
  definition:=pg_get_functiondef('private.validate_entries(uuid,jsonb,boolean)'::regprocedure);
  definition:=replace(definition,'(select count(*) from public.master_award_types)',
    '(select count(*) from public.master_award_types where year=private.current_year())');
  definition:=replace(definition,'a on a.code = e->>''award_code''',
    'a on a.year=private.current_year() and a.code = e->>''award_code''');
  definition:=replace(definition,'select * from public.master_award_types loop',
    'select * from public.master_award_types where year=private.current_year() loop');
  execute definition;

  definition:=pg_get_functiondef('private.year_rankings(integer)'::regprocedure);
  definition:=replace(definition,'where v.year=p_year and v.is_active',
    'where a.year=p_year and v.year=p_year and v.is_active');
  definition:=replace(definition,'group by a.code,v.year,v.video_id',
    'group by a.year,a.code,v.year,v.video_id');
  execute definition;

  definition:=pg_get_functiondef('private.admin_report()'::regprocedure);
  definition:=replace(definition,'join public.master_award_types a on a.code=e.award_code',
    'join public.master_award_types a on a.year=e.year and a.code=e.award_code');
  execute definition;
  definition:=pg_get_functiondef('private.vote_history(integer)'::regprocedure);
  definition:=replace(definition,'join public.master_award_types a on a.code=e.award_code',
    'join public.master_award_types a on a.year=e.year and a.code=e.award_code');
  execute definition;

  if to_regclass('public.award_types') is not null then
    execute 'create or replace view public.award_types with(security_invoker=true) as
      select code,name,min_votes,max_votes,display_order from public.master_award_types
      where year=private.current_year()';
  end if;
end $functions$;

create function private.seed_year_award_types() returns trigger
language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
  insert into public.master_award_types(year,code,name,min_votes,max_votes,display_order)
  select new.year,code,name,min_votes,max_votes,display_order
  from public.master_award_types where year=private.current_year();
  get diagnostics inserted=row_count;
  if inserted=0 then raise exception 'コピー元年度の部門設定がありません。'; end if;
  return new;
end $$;
revoke all on function private.seed_year_award_types() from public,anon,authenticated;
grant execute on function private.seed_year_award_types() to service_role;
create trigger seed_year_award_types after insert on public.master_poll_settings
  for each row execute function private.seed_year_award_types();

do $verify$
declare before_state jsonb; after_state jsonb;
begin
  before_state:=current_setting('anipafe.yearly_awards_before')::jsonb;
  select jsonb_build_object(
    'awards',(select jsonb_agg(to_jsonb(t)-'year' order by code) from public.master_award_types t where year=2026),
    'live_entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballots t),
    'historical_entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_historical_ballots t),
    'ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballot t),
    'historical_ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_historical_ballot t),
    'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
    'event',(select to_jsonb(t) from public.master_event_settings t where id=1)
  ) into after_state;
  if before_state is distinct from after_state then raise exception 'Existing awards or votes changed; rollback'; end if;
  if exists(select 1 from public.master_poll_settings p where
    (select count(*) from public.master_award_types a where a.year=p.year)<>
    (select count(*) from public.master_award_types where year=2026)) then
    raise exception 'Award year copy mismatch';
  end if;
end $verify$;
commit;
