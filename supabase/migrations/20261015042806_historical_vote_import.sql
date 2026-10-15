-- Historical form submissions have no verified auth.users identity. Keep them
-- separate from live ballots; never fabricate accounts or infer ownership.
create table public.data_historical_imports (
  id uuid primary key default gen_random_uuid(),
  year integer not null references public.master_poll_settings(year),
  source_filename text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_sheet text not null,
  column_mapping jsonb not null check (jsonb_typeof(column_mapping) = 'object'),
  expected_ballots integer not null check (expected_ballots > 0),
  expected_entries integer not null check (expected_entries > 0),
  expected_votes integer not null check (expected_votes > 0 and expected_votes <= expected_entries),
  expected_comments integer not null check (expected_comments >= 0),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  status text not null default 'loading' check (status in ('loading', 'complete')),
  imported_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (year, source_sha256, source_sheet),
  unique (id, year),
  check ((status = 'complete') = (completed_at is not null))
);

create table public.data_historical_ballot (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  year integer not null,
  source_row integer not null check (source_row >= 2),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 500),
  nico_user_id text check (nico_user_id ~ '^(0|[1-9][0-9]{0,29})$'),
  created_at timestamptz not null,
  source_timestamp text not null,
  raw_response jsonb not null check (jsonb_typeof(raw_response) = 'object'),
  imported_at timestamptz not null default now(),
  foreign key (import_id, year) references public.data_historical_imports(id, year),
  unique (import_id, source_row),
  unique (id, year)
);
create index historical_ballot_year_idx on public.data_historical_ballot(year);

create table public.data_historical_ballots (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null,
  year integer not null,
  award_code text not null references public.master_award_types(code),
  slot integer not null check (slot >= 1 and slot <= case when award_code = 'overall' then 10 else 3 end),
  source_video_number integer check (source_video_number > 0),
  source_video_label text,
  video_id text,
  comment text,
  selection_column text not null,
  comment_column text not null,
  imported_at timestamptz not null default now(),
  foreign key (ballot_id, year) references public.data_historical_ballot(id, year),
  foreign key (year, video_id) references public.data_mad(year, video_id),
  unique (ballot_id, award_code, slot),
  check ((source_video_number is null) = (source_video_label is null)),
  check (source_video_number is not null or comment is not null),
  check (video_id is null or source_video_number is not null)
);
create index historical_entries_ballot_year_idx on public.data_historical_ballots(ballot_id, year);
create index historical_entries_video_idx on public.data_historical_ballots(year, video_id);
create index historical_entries_award_idx on public.data_historical_ballots(award_code);

alter table public.data_historical_imports enable row level security;
alter table public.data_historical_ballot enable row level security;
alter table public.data_historical_ballots enable row level security;
revoke all on public.data_historical_imports, public.data_historical_ballot,
  public.data_historical_ballots from public, anon, authenticated;
grant select on public.data_historical_imports, public.data_historical_ballot,
  public.data_historical_ballots to authenticated;
grant all on public.data_historical_imports, public.data_historical_ballot,
  public.data_historical_ballots to service_role;
create policy historical_imports_admin_read on public.data_historical_imports
  for select to authenticated using ((select private.is_admin()));
create policy historical_ballot_admin_read on public.data_historical_ballot
  for select to authenticated using ((select private.is_admin()));
create policy historical_entries_admin_read on public.data_historical_ballots
  for select to authenticated using ((select private.is_admin()));

comment on table public.data_historical_imports is '過去投票Excelの取込台帳。completeのみ取込完了。現行の投票集計とは別管理。';
comment on table public.data_historical_ballot is '過去フォームの回答者・回答日時・原本。Google認証ユーザーへの自動紐付けは行わない。';
comment on table public.data_historical_ballots is '過去投票の部門別明細。選択なしの感想、未登録作品への票、長文感想も保持する。';
comment on column public.data_historical_ballots.video_id is '現在の同年度作品マスターに照合できた場合のみ設定。未登録作品も元番号・ラベルで保持する。';
comment on column public.data_historical_ballot.created_at is '元フォームのタイムスタンプ。日本時間からUTCへ変換。取込日時はimported_at。';
