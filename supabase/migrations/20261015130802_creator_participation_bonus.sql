begin;

-- Public history uses the same Nico-ID participation rule as the admin tally.
-- Keep votes as the raw selection count; rank on points including the bonus.
create or replace function private.year_rankings(p_year integer) returns jsonb
language sql stable security definer set search_path='' as $$
  with participants as (
    select distinct p.nico_user_id
    from public.data_ballot b join public.data_profiles p on p.user_id=b.voter_id
    where b.year=p_year and b.source='site' and b.status='submitted'
  ), totals as (
    select a.code as award_code,a.name as award_name,a.display_order as award_order,
      v.video_id,v.title,v.author_name,v.display_order,count(e.id)::integer as votes,
      case when a.code='overall' and exists (
        select 1 from participants p where p.nico_user_id=v.author_nico_user_id
      ) then 1 else 0 end as creator_bonus
    from public.master_award_types a cross join public.data_mad v
    left join public.data_ballots e on e.year=v.year and e.video_id=v.video_id
      and e.award_code=a.code and e.source='site'
      and exists (
        select 1 from public.data_ballot b join public.data_profiles p on p.user_id=b.voter_id
        where b.id=e.ballot_id and b.year=p_year and b.source='site' and b.status='submitted'
          and p.nico_user_id<>v.author_nico_user_id
      )
    where a.year=p_year and v.year=p_year and v.is_active
      and (a.code<>'theme' or v.theme is not null)
    group by a.year,a.code,v.year,v.video_id
  ), scored as (
    select totals.*,votes+creator_bonus as points from totals
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.award_order,r.rank,r.display_order),'[]'::jsonb)
  from (
    select scored.*,rank() over(partition by award_code order by points desc)::integer as rank
    from scored
  ) r
$$;

-- Replacing the private helper preserves its existing restricted ACLs.
revoke all on function private.year_rankings(integer) from public,anon,authenticated;
commit;
