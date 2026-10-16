begin;
set local lock_timeout='5s';

-- Keep original responses and site ballot ownership intact. Null links are
-- tombstones so unlink/relink cannot reset the optimistic concurrency revision.
create table public.data_historical_voter_links (
  ballot_id uuid primary key,
  year integer not null,
  source text not null default 'historical' check(source='historical'),
  user_id uuid references public.data_login_user(user_id),
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(ballot_id,year) references public.data_ballot(id,year) on delete cascade,
  foreign key(ballot_id,source) references public.data_ballot(id,source) on delete cascade
);
create index historical_voter_links_year_idx on public.data_historical_voter_links(year);
create index historical_voter_links_user_idx on public.data_historical_voter_links(user_id);
comment on table public.data_historical_voter_links is '運営者が確認した過去フォーム回答とログインユーザーの対応。原本・集計・本人の閲覧権限は変更しない。user_id=NULLは解除済み。';
alter table public.data_historical_voter_links enable row level security;
revoke all on public.data_historical_voter_links from public,anon,authenticated;
grant select on public.data_historical_voter_links to authenticated;
grant all on public.data_historical_voter_links to service_role;
create policy historical_voter_links_admin_read on public.data_historical_voter_links
  for select to authenticated using ((select private.is_admin()));

create function private.admin_link_historical_voter(
  p_ballot uuid,p_year integer,p_user uuid,p_revision integer,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.data_ballot%rowtype; previous_user uuid; previous_revision integer; next_revision integer;
begin
  perform private.require_admin_year(p_year);
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception '確認内容・変更理由を入力してください。';
  end if;
  -- Serialize even the first link, where there is no mapping row to lock yet.
  select * into b from public.data_ballot where id=p_ballot and year=p_year for update;
  if not found or b.source<>'historical' or b.status<>'imported' then
    raise exception '選択年度の過去フォーム原本が見つかりません。';
  end if;
  select user_id,revision into previous_user,previous_revision
    from public.data_historical_voter_links where ballot_id=b.id;
  if p_revision is null or p_revision<>coalesce(previous_revision,0) then
    raise exception '紐付けが更新されました。再読み込みして確認してください。' using errcode='40001';
  end if;
  if p_user is not null then
    perform 1 from public.data_login_user p where p.user_id=p_user
      and exists(select 1 from auth.identities i where i.user_id=p.user_id and i.provider='google') for key share;
    if not found then raise exception '紐付け先のログインユーザーが見つかりません。'; end if;
  end if;
  next_revision:=coalesce(previous_revision,0)+1;
  insert into public.data_historical_voter_links(ballot_id,year,user_id,revision)
    values(b.id,p_year,p_user,next_revision)
    on conflict(ballot_id) do update set user_id=excluded.user_id,
      revision=excluded.revision,updated_at=clock_timestamp();
  insert into public.audit_logs(actor,year,action,target,summary)
    values(auth.uid(),p_year,case when p_user is null then 'unlink_historical_voter' else 'link_historical_voter' end,
      b.id::text,jsonb_build_object('previous_user_id',previous_user,'user_id',p_user,
        'revision',next_revision,'reason',btrim(p_reason)));
  return jsonb_build_object('ballot_id',b.id,'user_id',p_user,'revision',next_revision);
end $$;
revoke all on function private.admin_link_historical_voter(uuid,integer,uuid,integer,text) from public,anon,authenticated;
grant execute on function private.admin_link_historical_voter(uuid,integer,uuid,integer,text) to authenticated;
create function public.admin_link_historical_voter(
  p_ballot uuid,p_year integer,p_user uuid,p_revision integer,p_reason text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_link_historical_voter(p_ballot,p_year,p_user,p_revision,p_reason)
$$;
revoke all on function public.admin_link_historical_voter(uuid,integer,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.admin_link_historical_voter(uuid,integer,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
