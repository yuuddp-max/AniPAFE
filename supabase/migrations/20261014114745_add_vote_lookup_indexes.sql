create index if not exists ballot_entries_award_code_idx on public.ballot_entries(award_code);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor);
