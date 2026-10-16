begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(2026,1);
lock table public.data_ballot,public.data_historical_voter_links in access exclusive mode;

-- Only site ballots are unique per user/year. Original responses remain
-- separate, including multiple responses by one person in the same year.
alter table public.data_ballot drop constraint data_ballot_voter_id_year_key;
create unique index data_ballot_site_voter_year_key
  on public.data_ballot(voter_id,year) where source='site';
-- Keep the full voter lookup/index coverage of the former unique constraint.
create index data_ballot_voter_year_idx on public.data_ballot(voter_id,year);

-- Preserve installed validation, signatures and ACLs. PostgreSQL must infer
-- the new partial index for both existing site-ballot creation paths.
do $functions$
declare f regprocedure; definition text;
begin
  foreach f in array array['private.save_profile(text,text)'::regprocedure,'private.save_draft(jsonb,integer)'::regprocedure] loop
    definition:=pg_get_functiondef(f);
    if position('on conflict(voter_id,year) do nothing' in definition)=0 then
      raise exception 'Unexpected site ballot insert in %',f;
    end if;
    execute replace(definition,'on conflict(voter_id,year) do nothing',
      'on conflict(voter_id,year) where source=''site'' do nothing');
  end loop;
end $functions$;

-- Trigger-only privilege, no callable API. Mapping and ballot change together
-- in the same transaction, including old deployed clients and service imports.
create function private.sync_historical_ballot_voter() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    update public.data_ballot set voter_id=null,revision=revision+1,updated_at=clock_timestamp()
      where id=old.ballot_id and year=old.year and source='historical' and voter_id is not null;
    return old;
  end if;
  if tg_op='UPDATE' and (new.ballot_id,new.year) is distinct from (old.ballot_id,old.year) then
    raise exception '紐付け対象の原本は変更できません。';
  end if;
  update public.data_ballot set voter_id=new.user_id,revision=revision+1,updated_at=clock_timestamp()
    where id=new.ballot_id and year=new.year and source='historical'
      and voter_id is distinct from new.user_id;
  return new;
end $$;
revoke all on function private.sync_historical_ballot_voter() from public,anon,authenticated,service_role;
create trigger historical_ballot_voter_sync
  after insert or update or delete on public.data_historical_voter_links
  for each row execute function private.sync_historical_ballot_voter();

-- Backfill already confirmed mappings only; original names, IDs, answers,
-- source/status and entries are retained. The normal tally invalidation runs.
update public.data_ballot b set voter_id=l.user_id,revision=b.revision+1,updated_at=clock_timestamp()
  from public.data_historical_voter_links l
  where b.id=l.ballot_id and b.year=l.year and b.source='historical'
    and b.voter_id is distinct from l.user_id;
comment on column public.data_ballot.voter_id is 'Googleログイン利用者のUUID。過去フォーム原本は確認済みの紐付け先を同期し、未紐付け・解除済みはNULL。';
comment on table public.data_historical_voter_links is '運営者が確認した過去フォーム回答とログインユーザーの対応。data_ballot.voter_idと同期。原本の名前・ニコニコID・票と閲覧権限は保持。user_id=NULLは解除済み。';

do $verify$
begin
  if exists(select 1 from public.data_historical_voter_links l join public.data_ballot b on b.id=l.ballot_id
    where b.voter_id is distinct from l.user_id) then raise exception 'Ballot link synchronization failed'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;
