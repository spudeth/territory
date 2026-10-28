-- A wipe unlocks the player's color, skin and coverage on that map. Their next first claim there sets new
-- ones and locks them again, until the next wipe. Other maps are not affected.
ALTER TABLE player_map_settings ADD COLUMN unlocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION player_map_settings_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT OLD.unlocked AND (NEW.color, NEW.skin_id, NEW.coverage, NEW.coverage_options)
     IS DISTINCT FROM (OLD.color, OLD.skin_id, OLD.coverage, OLD.coverage_options) THEN
    RAISE EXCEPTION 'color, skin and coverage are locked once chosen for a map (a wipe unlocks them)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
