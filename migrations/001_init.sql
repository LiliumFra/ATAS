CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS rulesets (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  version text NOT NULL CHECK (length(btrim(version)) > 0),
  effective_from date NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition text NOT NULL CHECK (length(btrim(competition)) > 0),
  home_team text NOT NULL CHECK (length(btrim(home_team)) > 0),
  away_team text NOT NULL CHECK (length(btrim(away_team)) > 0),
  ruleset_id text NOT NULL REFERENCES rulesets(id),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','FINISHED','ABANDONED')),
  clock_integrity_ok boolean NOT NULL DEFAULT true,
  source_integrity_ok boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team <> away_team)
);

CREATE TABLE IF NOT EXISTS periods (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND')),
  status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','RUNNING','ENDED')),
  nominal_duration_us bigint NOT NULL CHECK (nominal_duration_us > 0 AND nominal_duration_us <= 86400000000),
  announced_minutes integer CHECK (announced_minutes >= 0 AND announced_minutes <= 60),
  started_at timestamptz,
  ended_at timestamptz,
  started_monotonic_us bigint CHECK (started_monotonic_us IS NULL OR started_monotonic_us >= 0),
  ended_monotonic_us bigint CHECK (ended_monotonic_us IS NULL OR ended_monotonic_us >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (match_id, period),
  CHECK (ended_at IS NULL OR started_at IS NOT NULL),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (ended_monotonic_us IS NULL OR started_monotonic_us IS NOT NULL),
  CHECK (ended_monotonic_us IS NULL OR ended_monotonic_us >= started_monotonic_us)
);

CREATE TABLE IF NOT EXISTS play_stoppages (
  record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial UNIQUE NOT NULL,
  stoppage_id uuid NOT NULL,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND')),
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED','CORRECTED')),
  start_us bigint NOT NULL CHECK (start_us >= 0 AND start_us <= 86400000000),
  end_us bigint CHECK (end_us IS NULL OR (end_us > start_us AND end_us <= 86400000000)),
  source text NOT NULL CHECK (source IN ('REFEREE','FOURTH_OFFICIAL','VAR','OFFICIAL_FEED','SENSOR_FUSION','OPERATOR','SYSTEM')),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  supersedes_record_id uuid REFERENCES play_stoppages(record_id),
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  record_hash char(64) NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stoppage_id, revision),
  CHECK (supersedes_record_id IS NULL OR supersedes_record_id <> record_id)
);

CREATE TABLE IF NOT EXISTS match_events (
  record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigserial UNIQUE NOT NULL,
  event_id uuid NOT NULL,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND')),
  revision integer NOT NULL CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN (
    'SUBSTITUTION','INJURY','PLAYER_REMOVAL','TIME_WASTING','DISCIPLINARY_DELAY',
    'MEDICAL_BREAK','VAR_CHECK','VAR_REVIEW','GOAL_CELEBRATION','EXTERNAL_INTERFERENCE',
    'THROW_IN_RESTART','GOAL_KICK_RESTART','FREE_KICK_RESTART','CORNER_RESTART',
    'OTHER_SIGNIFICANT_DELAY'
  )),
  source text NOT NULL CHECK (source IN ('REFEREE','FOURTH_OFFICIAL','VAR','OFFICIAL_FEED','SENSOR_FUSION','OPERATOR','SYSTEM')),
  status text NOT NULL CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED','CORRECTED')),
  start_us bigint NOT NULL CHECK (start_us >= 0 AND start_us <= 86400000000),
  end_us bigint CHECK (end_us IS NULL OR (end_us > start_us AND end_us <= 86400000000)),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  supersedes_record_id uuid REFERENCES match_events(record_id),
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, revision),
  CHECK (supersedes_record_id IS NULL OR supersedes_record_id <> record_id)
);

CREATE INDEX IF NOT EXISTS idx_match_events_match_period_sequence
  ON match_events(match_id, period, sequence);
CREATE INDEX IF NOT EXISTS idx_match_events_logical_revision
  ON match_events(event_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_play_stoppages_match_period_sequence
  ON play_stoppages(match_id, period, sequence);
CREATE INDEX IF NOT EXISTS idx_play_stoppages_logical_revision
  ON play_stoppages(stoppage_id, revision DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  sequence bigserial PRIMARY KEY,
  match_id uuid REFERENCES matches(id) ON DELETE CASCADE,
  actor text NOT NULL CHECK (length(btrim(actor)) > 0),
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  audit_hash char(64) NOT NULL CHECK (audit_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_match_sequence ON audit_log(match_id, sequence);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  topic text NOT NULL CHECK (length(btrim(topic)) > 0),
  aggregate_id uuid,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (published_at IS NULL OR published_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox(id) WHERE published_at IS NULL;
