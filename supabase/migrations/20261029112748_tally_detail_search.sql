begin;
create function public.admin_search_tally_details(
  p_year integer, p_source text, p_denominator integer, p_version integer,
  p_calculated_at timestamptz, p_page integer, p_query text,
  p_award_name text, p_comments_only boolean
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; state jsonb; output jsonb;
begin
  -- The existing state RPC enforces administrator access; keep this function
  -- invoker-only so the snapshot SELECT is also checked by its existing RLS.
  state := public.admin_tally_state(p_year,p_source);
  if p_page is null or p_page not between 0 and 100000
    or p_query is null or length(p_query)>200
    or p_comments_only is null or p_award_name is null
    or p_award_name not in ('','総合賞','選曲賞','構成賞','諧謔賞','クリエイティブ賞','テーマ賞') then
    raise exception '明細の検索条件が不正です。' using errcode='22023';
  end if;
  select result into snapshot from public.data_tally_results
    where year=p_year and source=p_source and score_denominator=p_denominator
      and calculation_version=p_version and input_revision=(state->>'revision')::bigint
      and calculated_at=p_calculated_at;
  if snapshot is null then return null; end if;
  with matches as materialized (
    select value as detail, ordinality as position
    from jsonb_array_elements(snapshot->'details') with ordinality
    where (p_award_name='' or value->>'award_name'=p_award_name)
      and (not p_comments_only or regexp_replace(coalesce(value->>'comment',''),'[[:space:]　]+','','g')<>'')
      and (btrim(p_query)='' or strpos(
        lower(normalize(concat_ws(' ',value->>'title',value->>'display_name',value->>'nico_user_id',value->>'comment',value->>'video_id'),NFKC)),
        lower(normalize(btrim(p_query),NFKC)))>0)
  ), page_rows as (
    select * from matches order by position limit 50 offset p_page*50
  )
  select jsonb_build_object('total',(select count(*) from matches),'page',p_page,
    'calculated_at',p_calculated_at,
    'details',coalesce((select jsonb_agg(detail order by position) from page_rows),'[]'::jsonb)) into output;
  return output;
end $$;
revoke all on function public.admin_search_tally_details(integer,text,integer,integer,timestamptz,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_search_tally_details(integer,text,integer,integer,timestamptz,integer,text,text,boolean) to authenticated;
commit;
