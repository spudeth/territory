-- Items (loop 14): bought once with squares, used within limits (uses per rolling window), on every map.
CREATE TABLE player_items (
  player_id bigint NOT NULL REFERENCES players (id),
  item_id   text   NOT NULL,
  bought_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_id)
);
CREATE TABLE item_uses (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id bigint NOT NULL REFERENCES players (id),
  item_id   text   NOT NULL,
  map_id    bigint REFERENCES maps (id),
  used_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_uses_recent ON item_uses (player_id, item_id, used_at);
-- Terraformer: a block's terrain, changed for good, over what the map's seed says.
CREATE TABLE terrain_overrides (
  map_id  bigint  NOT NULL REFERENCES maps (id),
  x       integer NOT NULL,
  y       integer NOT NULL,
  terrain text    NOT NULL,
  PRIMARY KEY (map_id, x, y)
);
