-- Lives (loop 13): a life on a map starts with a player's first block there and ends when another player takes
-- their last one (a death) or they wipe (not a death). The death screen shows it; seen = the player has seen it.
CREATE TABLE player_lives (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players (id),
  map_id     bigint NOT NULL REFERENCES maps (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  peak       integer NOT NULL DEFAULT 1,
  claims     integer NOT NULL DEFAULT 0,
  squares    numeric NOT NULL DEFAULT 0,
  killer_id  bigint REFERENCES players (id),
  x integer, y integer,                       -- where the last block was lost
  seen       boolean NOT NULL DEFAULT false
);
CREATE INDEX player_lives_open ON player_lives (player_id, map_id) WHERE ended_at IS NULL;
