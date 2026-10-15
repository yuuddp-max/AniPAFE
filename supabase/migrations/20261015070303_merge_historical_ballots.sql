-- Consolidate stored form responses without adopting them as live submitted votes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(2026,1);
lock table public.data_ballot,public.data_ballots,public.data_historical_ballot,
  public.data_historical_ballots,public.data_historical_imports in access exclusive mode;

do $preflight$
begin
  if exists(select 1 from public.data_historical_imports where status<>'complete') then
    raise exception 'An incomplete historical import must be reconciled first';
  end if;
  if exists(select 1 from public.data_historical_ballot h join public.data_ballot b using(id))
    or exists(select 1 from public.data_historical_ballots h join public.data_ballots e using(id)) then
    raise exception 'ID collision; no data was merged';
  end if;
end $preflight$;

-- Compare the entire original rows, including IDs and original response JSON.
select set_config('anipafe.merge_before',jsonb_build_object(
  'site_ballots',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.data_ballot t),
  'site_entries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.data_ballots t),
  'historical_ballots',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.data_historical_ballot t),
  'historical_entries',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.data_historical_ballots t),
  'other_data',jsonb_build_object(
    'videos',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,video_id),'')) from public.data_mad t),
    'profiles',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),'')) from public.data_profiles t),
    'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
    'awards',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,code),'')) from public.master_award_types t),
    'event',(select to_jsonb(t) from public.master_event_settings t where id=1)
  ))::text,true);

alter table public.data_ballot
  alter column voter_id drop not null,
  drop constraint ballots_status_check,
  add column source text not null default 'site',
  add column source_row integer,
  add column display_name text,
  add column nico_user_id text,
  add column source_timestamp text,
  add column raw_response jsonb,
  add constraint data_ballot_source_key unique(id,source),
  add constraint data_ballot_source_check check (
    (source='site' and voter_id is not null and status in ('draft','submitted')
      and source_row is null and display_name is null and nico_user_id is null
      and source_timestamp is null and raw_response is null)
    or
    (source='historical' and status='imported' and submitted_at is null
      and source_row is not null and source_row>=2
      and display_name is not null and char_length(btrim(display_name)) between 1 and 500
      and (nico_user_id is null or nico_user_id ~ '^(0|[1-9][0-9]{0,29})$')
      and source_timestamp is not null and raw_response is not null
      and jsonb_typeof(raw_response)='object')
  );

alter table public.data_ballots
  alter column video_id drop not null,
  drop constraint ballot_entries_comment_check,
  drop constraint ballot_entries_ballot_id_award_code_video_id_key,
  add column source text not null default 'site',
  add column slot integer,
  add column source_video_number integer,
  add column source_video_label text,
  add column selection_column text,
  add column comment_column text,
  add constraint data_ballots_source_fkey foreign key(ballot_id,source)
    references public.data_ballot(id,source) on delete cascade,
  add constraint data_ballots_slot_key unique(ballot_id,award_code,slot),
  add constraint data_ballots_source_check check (
    (source='site' and video_id is not null and (comment is null or char_length(comment)<=1000)
      and slot is null and source_video_number is null and source_video_label is null
      and selection_column is null and comment_column is null)
    or
    (source='historical' and slot is not null
      and slot between 1 and case when award_code='overall' then 10 else 3 end
      and (source_video_number is null or source_video_number>0)
      and ((source_video_number is null)=(source_video_label is null))
      and (source_video_number is not null or comment is not null)
      and (video_id is null or source_video_number is not null)
      and selection_column is not null and comment_column is not null)
  );

-- Historical duplicate selections, unknown works and comment-only entries survive.
create unique index ballot_entries_site_video_key
  on public.data_ballots(ballot_id,award_code,video_id) where source='site';
create index ballot_entries_ballot_source_idx on public.data_ballots(ballot_id,source);
create index ballots_source_year_idx on public.data_ballot(source,year);

insert into public.data_ballot(id,year,voter_id,status,revision,submitted_at,
  created_at,updated_at,source,source_row,display_name,nico_user_id,source_timestamp,raw_response)
select id,year,null,'imported',0,null,created_at,created_at,'historical',
  source_row,display_name,nico_user_id,source_timestamp,raw_response
from public.data_historical_ballot;

insert into public.data_ballots(id,ballot_id,year,award_code,video_id,comment,
  source,slot,source_video_number,source_video_label,selection_column,comment_column,
  created_at,updated_at)
select e.id,e.ballot_id,e.year,e.award_code,e.video_id,e.comment,'historical',
  e.slot,e.source_video_number,e.source_video_label,e.selection_column,e.comment_column,
  b.created_at,b.created_at
from public.data_historical_ballots e join public.data_historical_ballot b on b.id=e.ballot_id;

-- Ownership of an imported form is not inferred from a self-declared Nico ID.
alter policy ballots_read on public.data_ballot using (
  private.is_google() and (private.is_admin() or (source='site' and voter_id=(select auth.uid())))
);
alter policy entries_read on public.data_ballots using (
  private.is_google() and exists(select 1 from public.data_ballot b where b.id=ballot_id
    and (private.is_admin() or (b.source='site' and b.voter_id=(select auth.uid()))))
);

-- Scope legacy authenticated writers and history to online ballots. Keep RPC
-- identity/arguments/grants intact, so deployed clients continue to work.
do $functions$
declare definition text; signature text;
begin
  foreach signature in array array[
    'private.save_profile(text,text)', 'private.save_draft(jsonb,integer)',
    'private.submit_ballot(integer)', 'private.admin_profile(uuid,text,text)',
    'private.admin_reopen(uuid,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'where year = private.current_year() and voter_id =',
      'where source = ''site'' and year = private.current_year() and voter_id =');
    definition:=replace(definition,'b.year = private.current_year() and b.voter_id =',
      'b.source = ''site'' and b.year = private.current_year() and b.voter_id =');
    execute definition;
  end loop;
  definition:=pg_get_functiondef('private.vote_history(integer)'::regprocedure);
  if position('b.year=p.year and b.voter_id=uid' in definition)=0
    or position('where year=p_year and voter_id=uid' in definition)=0 then
    raise exception 'Unexpected vote_history definition; review before merging';
  end if;
  definition:=replace(definition,'b.year=p.year and b.voter_id=uid',
    'b.source=''site'' and b.year=p.year and b.voter_id=uid');
  definition:=replace(definition,'where year=p_year and voter_id=uid',
    'where source=''site'' and year=p_year and voter_id=uid');
  execute definition;
end $functions$;

do $verify$
declare before_state jsonb; after_state jsonb;
begin
  before_state:=current_setting('anipafe.merge_before')::jsonb;
  select jsonb_build_object(
    'site_ballots',(select coalesce(jsonb_agg(to_jsonb(t)-array['source','source_row','display_name','nico_user_id','source_timestamp','raw_response'] order by id),'[]') from public.data_ballot t where source='site'),
    'site_entries',(select coalesce(jsonb_agg(to_jsonb(t)-array['source','slot','source_video_number','source_video_label','selection_column','comment_column'] order by id),'[]') from public.data_ballots t where source='site'),
    'historical_ballots',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'year',year,'source_row',source_row,'display_name',display_name,'nico_user_id',nico_user_id,
      'created_at',created_at,'source_timestamp',source_timestamp,'raw_response',raw_response) order by id),'[]') from public.data_ballot where source='historical'),
    'historical_entries',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'ballot_id',ballot_id,'year',year,'award_code',award_code,'slot',slot,
      'source_video_number',source_video_number,'source_video_label',source_video_label,'video_id',video_id,
      'comment',comment,'selection_column',selection_column,'comment_column',comment_column) order by id),'[]') from public.data_ballots where source='historical'),
    'other_data',jsonb_build_object(
      'videos',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,video_id),'')) from public.data_mad t),
      'profiles',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by user_id),'')) from public.data_profiles t),
      'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
      'awards',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,code),'')) from public.master_award_types t),
      'event',(select to_jsonb(t) from public.master_event_settings t where id=1)
    )) into after_state;
  if before_state is distinct from after_state then
    raise exception 'Consolidation changed existing fields; rollback';
  end if;
end $verify$;

-- No CASCADE: any unreviewed dependency blocks deletion and rolls back the merge.
drop table public.data_historical_ballots;
drop table public.data_historical_ballot;
drop table public.data_historical_imports;

comment on column public.data_ballot.source is 'site: サイト上の投票。historical: 未採用の外部フォーム原本。';
comment on column public.data_ballot.status is 'draft/submittedはサイト票。importedは原本保存であり集計採用・本人確認を意味しない。';
comment on column public.data_ballot.voter_id is 'Googleログイン利用者のUUID。外部原本は未紐付けのためNULL。';
comment on column public.data_ballots.source is '親投票と一致する。historicalは作品未対応・感想のみ・長文も原本どおり保持。';
insert into public.audit_logs(action,target,summary,year)
values('merge_historical_ballots','data_ballot/data_ballots',jsonb_build_object(
  'historical_ballots',(select count(*) from public.data_ballot where source='historical'),
  'historical_entries',(select count(*) from public.data_ballots where source='historical'),
  'import_table_removed',true,'auto_linked_users',false,'adopted_for_rankings',false),
  private.current_year());
commit;
