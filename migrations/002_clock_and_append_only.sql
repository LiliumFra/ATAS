CREATE TABLE IF NOT EXISTS match_clock_samples (
  sequence bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND')),
  source_id text NOT NULL CHECK (length(btrim(source_id)) > 0),
  source_sequence bigint NOT NULL CHECK (source_sequence >= 0 AND source_sequence <= 9007199254740991),
  elapsed_us bigint NOT NULL CHECK (elapsed_us >= 0 AND elapsed_us <= 86400000000),
  source_timestamp timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  sample_hash char(64) NOT NULL CHECK (sample_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (match_id, period, source_id, source_sequence)
);

CREATE INDEX IF NOT EXISTS idx_clock_samples_latest
  ON match_clock_samples(match_id, period, source_id, source_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_clock_samples_match_sequence
  ON match_clock_samples(match_id, sequence);

CREATE OR REPLACE FUNCTION atas_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ATAS append-only table % cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_match_events_append_only ON match_events;
CREATE TRIGGER trg_match_events_append_only
BEFORE UPDATE OR DELETE ON match_events
FOR EACH ROW EXECUTE FUNCTION atas_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_play_stoppages_append_only ON play_stoppages;
CREATE TRIGGER trg_play_stoppages_append_only
BEFORE UPDATE OR DELETE ON play_stoppages
FOR EACH ROW EXECUTE FUNCTION atas_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION atas_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_clock_samples_append_only ON match_clock_samples;
CREATE TRIGGER trg_clock_samples_append_only
BEFORE UPDATE OR DELETE ON match_clock_samples
FOR EACH ROW EXECUTE FUNCTION atas_reject_append_only_mutation();

DROP TRIGGER IF EXISTS trg_rulesets_immutable ON rulesets;
CREATE TRIGGER trg_rulesets_immutable
BEFORE UPDATE OR DELETE ON rulesets
FOR EACH ROW EXECUTE FUNCTION atas_reject_append_only_mutation();
