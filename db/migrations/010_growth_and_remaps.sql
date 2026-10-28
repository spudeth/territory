-- The Growth upgrade: map blocks a brand-new claim creates (level 0 = 1 block).
ALTER TABLE players ADD COLUMN growth smallint NOT NULL DEFAULT 0;

-- The upgrade tables (from data/economy.json) that players' stored levels refer to. When a new sync changes
-- the tables, the server moves stored levels at startup so nobody gets weaker (economy.remapLevel), then
-- records the new tables here. One row.
CREATE TABLE economy_applied (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  upgrades   jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Every level a sync moved, for checking later.
CREATE TABLE level_remaps (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players (id),
  upgrade    text NOT NULL,
  old_level  smallint NOT NULL,
  new_level  smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX level_remaps_player ON level_remaps (player_id);
