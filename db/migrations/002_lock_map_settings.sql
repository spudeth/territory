-- A player's look on a map (color, skin, coverage) is chosen once, on their first claim there, and locked
-- for that map forever. The server never changes them; this makes the database refuse it too.
-- wipe_floor lives in the same row and still changes.

ALTER TABLE player_map_settings
  ADD CONSTRAINT player_map_settings_coverage CHECK (coverage IN ('tile', 'stretch'));

CREATE FUNCTION player_map_settings_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.color, NEW.skin_id, NEW.coverage, NEW.coverage_options)
     IS DISTINCT FROM (OLD.color, OLD.skin_id, OLD.coverage, OLD.coverage_options) THEN
    RAISE EXCEPTION 'color, skin and coverage are locked once chosen for a map'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER player_map_settings_locked
  BEFORE UPDATE ON player_map_settings
  FOR EACH ROW EXECUTE FUNCTION player_map_settings_locked();
