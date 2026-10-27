-- The first Territory schema. Migrations run in order, once each, inside one transaction (see db.js).

-- The old single-row save from before this schema. Nothing in it is kept.
DROP TABLE IF EXISTS game_state;

-- Catalog of skins. Free skins count as owned by everyone, so they never need player_skins rows.
CREATE TABLE skins (
  id            text PRIMARY KEY,                 -- stable key used in code, e.g. 'default'
  name          text NOT NULL,
  image         text,                             -- path under public/skins/; null for the plain look
  is_free       boolean NOT NULL DEFAULT false,
  price_squares integer CHECK (price_squares > 0), -- null = not for sale
  created_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO skins (id, name, is_free) VALUES ('default', 'Default', true);

-- Guests and account holders share one row, so a guest who signs up keeps their id and every block.
CREATE TABLE players (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 15),
  auth_user_id    text UNIQUE,                    -- set once the player has an account; null for guests
  is_vip          boolean NOT NULL DEFAULT false,
  squares         bigint NOT NULL DEFAULT 0 CHECK (squares >= 0), -- balance; every change is in square_ledger
  last_map_id     bigint,                         -- foreign key added below, once maps exists
  name_changed_at timestamptz,                    -- for the wait between renames
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_name_unique ON players (lower(name));

-- Secret tokens kept in guests' browsers. Only a SHA-256 hash is stored, never the token itself.
CREATE TABLE player_tokens (
  token_hash bytea PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Separate boards. Official maps have no creator; players buy maps and VIPs make them.
CREATE TABLE maps (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  style      text NOT NULL,                       -- 'grass' or 'white'; the list lives in code with the art
  type       text NOT NULL CHECK (type IN ('official', 'purchased', 'vip')),
  created_by bigint REFERENCES players (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE players ADD FOREIGN KEY (last_map_id) REFERENCES maps (id);

-- One row per block that exists. A missing row means there is no block there, so maps can take any shape.
CREATE TABLE map_cells (
  map_id     bigint NOT NULL REFERENCES maps (id),
  x          integer NOT NULL,
  y          integer NOT NULL,
  owner_id   bigint REFERENCES players (id),      -- null = empty
  claimed_at timestamptz,                         -- when the current owner took it
  PRIMARY KEY (map_id, x, y)
);
CREATE INDEX map_cells_owner ON map_cells (map_id, owner_id) WHERE owner_id IS NOT NULL;

-- Skins a player owns (not counting free ones).
CREATE TABLE player_skins (
  player_id   bigint NOT NULL REFERENCES players (id),
  skin_id     text NOT NULL REFERENCES skins (id),
  source      text NOT NULL,                      -- how it was obtained, e.g. 'squares', 'purchase', 'grant'
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, skin_id)
);

-- A player's setup on one map. Created on their first claim there; color and skin are locked after that.
CREATE TABLE player_map_settings (
  player_id        bigint NOT NULL REFERENCES players (id),
  map_id           bigint NOT NULL REFERENCES maps (id),
  color            text NOT NULL,
  skin_id          text NOT NULL REFERENCES skins (id),
  coverage         text NOT NULL DEFAULT 'tile',  -- how the skin covers the territory: 'tile' or 'stretch'; handled in code
  coverage_options jsonb NOT NULL DEFAULT '{}',
  wipe_floor       integer NOT NULL DEFAULT 0 CHECK (wipe_floor >= 0), -- the most blocks owned at any wipe here
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, map_id)
);
CREATE INDEX player_map_settings_map ON player_map_settings (map_id);

-- Every wipe, with how many blocks the player had at that moment (N).
CREATE TABLE map_wipes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_id       bigint NOT NULL REFERENCES maps (id),
  player_id    bigint NOT NULL REFERENCES players (id),
  blocks_owned integer NOT NULL,
  wiped_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX map_wipes_player ON map_wipes (player_id, map_id);

-- Every change to a squares balance. players.squares always equals the latest balance_after.
CREATE TABLE square_ledger (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id     bigint NOT NULL REFERENCES players (id),
  delta         bigint NOT NULL CHECK (delta <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  reason        text NOT NULL,                    -- 'first_claim' for now; later purchases and spending
  map_id        bigint REFERENCES maps (id),
  x             integer,
  y             integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX square_ledger_player ON square_ledger (player_id);

-- The launch map: one 32x32 grass board.
INSERT INTO maps (name, style, type) VALUES ('Grass', 'grass', 'official');
INSERT INTO map_cells (map_id, x, y)
SELECT m.id, x, y FROM maps m, generate_series(0, 31) AS x, generate_series(0, 31) AS y;
