CREATE INDEX IF NOT EXISTS idx_outbox_aggregate_cursor
  ON outbox(aggregate_id, id);

CREATE OR REPLACE FUNCTION atas_validate_event_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent match_events%ROWTYPE;
BEGIN
  IF NEW.revision = 1 THEN
    IF NEW.supersedes_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'First event revision cannot supersede another record'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supersedes_record_id IS NULL THEN
    RAISE EXCEPTION 'Event revision % requires a superseded record', NEW.revision
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO parent FROM match_events WHERE record_id = NEW.supersedes_record_id;
  IF NOT FOUND OR parent.event_id <> NEW.event_id OR parent.match_id <> NEW.match_id
     OR parent.period <> NEW.period OR parent.revision + 1 <> NEW.revision THEN
    RAISE EXCEPTION 'Invalid event revision lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_events_lineage ON match_events;
CREATE TRIGGER trg_match_events_lineage
BEFORE INSERT ON match_events
FOR EACH ROW EXECUTE FUNCTION atas_validate_event_lineage();

CREATE OR REPLACE FUNCTION atas_validate_stoppage_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent play_stoppages%ROWTYPE;
BEGIN
  IF NEW.revision = 1 THEN
    IF NEW.supersedes_record_id IS NOT NULL THEN
      RAISE EXCEPTION 'First stoppage revision cannot supersede another record'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.supersedes_record_id IS NULL THEN
    RAISE EXCEPTION 'Stoppage revision % requires a superseded record', NEW.revision
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO parent FROM play_stoppages WHERE record_id = NEW.supersedes_record_id;
  IF NOT FOUND OR parent.stoppage_id <> NEW.stoppage_id OR parent.match_id <> NEW.match_id
     OR parent.period <> NEW.period OR parent.revision + 1 <> NEW.revision THEN
    RAISE EXCEPTION 'Invalid stoppage revision lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_play_stoppages_lineage ON play_stoppages;
CREATE TRIGGER trg_play_stoppages_lineage
BEFORE INSERT ON play_stoppages
FOR EACH ROW EXECUTE FUNCTION atas_validate_stoppage_lineage();
