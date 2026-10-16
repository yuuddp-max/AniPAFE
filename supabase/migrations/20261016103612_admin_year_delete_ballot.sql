begin;

-- Match the existing admin RPC boundary: privileged implementation stays private.
create function private.admin_year_delete_ballot(
  p_ballot uuid,p_revision integer,p_reason text,p_year integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.data_ballot%rowtype; entries integer;
begin
  perform private.require_admin_year(p_year);
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception '削除理由を入力してください。';
  end if;
  select * into b from public.data_ballot where id=p_ballot and year=p_year for update;
  if not found then raise exception '選択年度の投票データが見つかりません。削除済みの場合は再読み込みしてください。'; end if;
  if p_revision is null or b.revision<>p_revision then
    raise exception '投票データが更新されました。再読み込みして確認してください。' using errcode='40001';
  end if;
  select count(*) into entries from public.data_ballots where ballot_id=b.id;
  -- The existing FK cascades only this ballot's entries. Profiles/Auth are untouched.
  delete from public.data_ballot where id=b.id and year=p_year;
  insert into public.audit_logs(actor,year,action,target,summary)
    values(auth.uid(),p_year,'delete_ballot',b.id::text,jsonb_build_object(
      'reason',btrim(p_reason),'source',b.source,'status',b.status,
      'voter_id',b.voter_id,'deleted_entries',entries));
  return jsonb_build_object('deleted_ballots',1,'deleted_entries',entries);
end $$;
revoke all on function private.admin_year_delete_ballot(uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function private.admin_year_delete_ballot(uuid,integer,text,integer) to authenticated;

create function public.admin_year_delete_ballot(
  p_ballot uuid,p_revision integer,p_reason text,p_year integer
) returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_year_delete_ballot(p_ballot,p_revision,p_reason,p_year)
$$;
revoke all on function public.admin_year_delete_ballot(uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.admin_year_delete_ballot(uuid,integer,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
