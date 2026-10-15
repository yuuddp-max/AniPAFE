-- Remove only the requested historical import metadata. All surviving fields
-- and live voting records must remain identical within this transaction.
do $remove_metadata$
declare before_history jsonb; after_history jsonb; before_live jsonb; after_live jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(2026,1);
  lock table public.data_historical_imports,public.data_historical_ballot,
    public.data_historical_ballots in access exclusive mode;
  select jsonb_build_object(
'imports',(select md5(coalesce(string_agg((to_jsonb(t)-'imported_at')::text,'' order by id),'')) from public.data_historical_imports t),
'ballot',(select md5(coalesce(string_agg((to_jsonb(t)-'import_id'-'imported_at')::text,'' order by id),'')) from public.data_historical_ballot t),
'entries',(select md5(coalesce(string_agg((to_jsonb(t)-'imported_at')::text,'' order by id),'')) from public.data_historical_ballots t)) into before_history;
  select jsonb_build_object(
'videos',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,video_id),'')) from public.data_mad t),
'ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballot t),
'entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballots t),
'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
'event',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.master_event_settings t)) into before_live;
  -- Keep the year valid after removing the import/year foreign key.
  alter table public.data_historical_ballot add constraint data_historical_ballot_year_fkey
    foreign key (year) references public.master_poll_settings(year);
  alter table public.data_historical_ballot
    drop constraint data_historical_ballot_import_id_year_fkey,
    drop constraint data_historical_ballot_import_id_source_row_key;
  drop index public.historical_ballot_import_year_idx;
  alter table public.data_historical_ballot drop column import_id,drop column imported_at;
  alter table public.data_historical_ballots drop column imported_at;
  alter table public.data_historical_imports drop column imported_at;
  comment on column public.data_historical_ballot.created_at is '元フォームのタイムスタンプ。日本時間からUTCへ変換。';
  select jsonb_build_object(
'imports',(select md5(coalesce(string_agg((to_jsonb(t)-'imported_at')::text,'' order by id),'')) from public.data_historical_imports t),
'ballot',(select md5(coalesce(string_agg((to_jsonb(t)-'import_id'-'imported_at')::text,'' order by id),'')) from public.data_historical_ballot t),
'entries',(select md5(coalesce(string_agg((to_jsonb(t)-'imported_at')::text,'' order by id),'')) from public.data_historical_ballots t)) into after_history;
  select jsonb_build_object(
'videos',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year,video_id),'')) from public.data_mad t),
'ballots',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballot t),
'entries',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.data_ballots t),
'settings',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by year),'')) from public.master_poll_settings t),
'event',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.master_event_settings t)) into after_live;
  if before_history is distinct from after_history or before_live is distinct from after_live then
    raise exception 'Unexpected data change while removing metadata; rollback';
  end if;
end $remove_metadata$;
