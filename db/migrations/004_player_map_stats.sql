-- Each player's stats on each map (see stats.js), kept up to date with every claim.
-- best_square and best_line are records; the server also recomputes them from the map when it loads it.
-- Counters start now; owned_max starts from what players own today.
CREATE TABLE player_map_stats (
  player_id    bigint  NOT NULL REFERENCES players (id),
  map_id       bigint  NOT NULL REFERENCES maps (id),
  owned_max    integer NOT NULL DEFAULT 0,
  first_claims integer NOT NULL DEFAULT 0,
  retakes      integer NOT NULL DEFAULT 0,
  blocks_lost  integer NOT NULL DEFAULT 0,
  best_square  integer NOT NULL DEFAULT 0,
  best_line    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (map_id, player_id)
);

INSERT INTO player_map_stats (player_id, map_id, owned_max)
SELECT owner_id, map_id, count(*) FROM map_cells WHERE owner_id IS NOT NULL GROUP BY owner_id, map_id;
