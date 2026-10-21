-- Operational timestamps must represent the actual statement/insertion time, not the start of a
-- transaction that may have waited behind a per-match advisory lock.
ALTER TABLE rulesets ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE matches ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE matches ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
ALTER TABLE match_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE play_stoppages ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE audit_log ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE outbox ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE match_clock_samples ALTER COLUMN received_at SET DEFAULT clock_timestamp();
ALTER TABLE outbox_retention_watermarks ALTER COLUMN updated_at SET DEFAULT clock_timestamp();
