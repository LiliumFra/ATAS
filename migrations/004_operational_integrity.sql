CREATE TABLE IF NOT EXISTS outbox_retention_watermarks (
  aggregate_id uuid PRIMARY KEY,
  through_id bigint NOT NULL CHECK (through_id > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION atas_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ATAS record in % cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_matches_no_delete ON matches;
CREATE TRIGGER trg_matches_no_delete
BEFORE DELETE ON matches
FOR EACH ROW EXECUTE FUNCTION atas_reject_delete();

DROP TRIGGER IF EXISTS trg_periods_no_delete ON periods;
CREATE TRIGGER trg_periods_no_delete
BEFORE DELETE ON periods
FOR EACH ROW EXECUTE FUNCTION atas_reject_delete();

CREATE OR REPLACE FUNCTION atas_guard_match_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.competition <> OLD.competition
     OR NEW.home_team <> OLD.home_team OR NEW.away_team <> OLD.away_team
     OR NEW.ruleset_id <> OLD.ruleset_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Match identity and ruleset binding are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'SCHEDULED' AND NEW.status IN ('LIVE','ABANDONED'))
    OR (OLD.status = 'LIVE' AND NEW.status IN ('FINISHED','ABANDONED'))
  ) THEN
    RAISE EXCEPTION 'Invalid match status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'Match version must increase on update'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Match updated_at cannot move backwards'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matches_guard_update ON matches;
CREATE TRIGGER trg_matches_guard_update
BEFORE UPDATE ON matches
FOR EACH ROW EXECUTE FUNCTION atas_guard_match_update();

CREATE OR REPLACE FUNCTION atas_guard_period_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.match_id <> OLD.match_id OR NEW.period <> OLD.period
     OR NEW.nominal_duration_us <> OLD.nominal_duration_us THEN
    RAISE EXCEPTION 'Period identity and nominal duration are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'NOT_STARTED' AND NEW.status = 'RUNNING')
    OR (OLD.status = 'RUNNING' AND NEW.status = 'ENDED')
  ) THEN
    RAISE EXCEPTION 'Invalid period status transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.announced_minutes IS NOT NULL AND (
       NEW.announced_minutes IS NULL OR NEW.announced_minutes < OLD.announced_minutes
  ) THEN
    RAISE EXCEPTION 'Announced added time cannot be removed or reduced'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'Period start timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'Period end timestamp is immutable once set'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'Period version must increase on update'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_periods_guard_update ON periods;
CREATE TRIGGER trg_periods_guard_update
BEFORE UPDATE ON periods
FOR EACH ROW EXECUTE FUNCTION atas_guard_period_update();
