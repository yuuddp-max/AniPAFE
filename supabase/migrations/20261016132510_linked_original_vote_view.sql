begin;
set local lock_timeout='5s';

-- Curated owner-only read. The underlying original tables stay admin-only;
-- raw responses, identities and other voters' answers never leave this RPC.
create function private.linked_original_votes(p_year integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid;
begin
  uid:=private.require_user();
  if p_year is null or p_year<>private.current_year() then
    raise exception '対象年度が変更されました。再読み込みしてください。' using errcode='40001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',b.id,'year',b.year,'revision',b.revision,'source_row',b.source_row,
    'source_timestamp',b.source_timestamp,
    'entries',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'award_code',e.award_code,'video_id',e.video_id,
      'source_video_number',e.source_video_number,'source_video_label',e.source_video_label,
      'title',coalesce(v.title,e.source_video_label,'作品選択なしの感想'),
      'author_name',v.author_name,'watch_url',v.watch_url,'comment',coalesce(e.comment,''))
      order by a.display_order,e.slot,e.id)
      from public.data_ballots e join public.master_award_types a on a.year=e.year and a.code=e.award_code
      left join public.data_mad v on v.year=e.year and v.video_id=e.video_id
      where e.ballot_id=b.id and e.year=b.year and e.source='historical'),'[]'::jsonb))
    order by b.created_at desc,b.source_row desc,b.id)
    from public.data_ballot b join public.data_historical_voter_links l on l.ballot_id=b.id and l.year=b.year
    where b.year=p_year and b.source='historical' and b.status='imported'
      and b.voter_id=uid and l.user_id=uid),'[]'::jsonb);
end $$;
revoke all on function private.linked_original_votes(integer) from public,anon,authenticated;
grant execute on function private.linked_original_votes(integer) to authenticated;
create function public.linked_original_votes(p_year integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.linked_original_votes(p_year) $$;
revoke all on function public.linked_original_votes(integer) from public,anon,authenticated;
grant execute on function public.linked_original_votes(integer) to authenticated;
notify pgrst,'reload schema';
commit;
