-- Cover both columns of the import/year foreign key.
create index historical_ballot_import_year_idx
  on public.data_historical_ballot(import_id, year);
