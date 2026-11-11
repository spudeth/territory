-- Loop 16 Phase 1: the economy foundation.

-- Money is integer tenths of a square (1 tenth = 1 hit of base work), 64-bit. Balances round down.
ALTER TABLE players ALTER COLUMN squares TYPE bigint USING floor(squares * 10);
ALTER TABLE square_ledger ALTER COLUMN delta TYPE bigint USING round(delta * 10);
ALTER TABLE square_ledger ALTER COLUMN balance_after TYPE bigint USING floor(balance_after * 10);
ALTER TABLE player_lives ALTER COLUMN squares TYPE bigint USING floor(squares * 10);
-- "Show tenths" in Settings: one decimal place everywhere (off: whole squares).
ALTER TABLE players ADD COLUMN show_tenths boolean NOT NULL DEFAULT false;

-- Every block: birth level (fixed forever), terrain (null = the map seed's terrain), up to 2 walls
-- ([{ side: 'n'|'e'|'s'|'w', hits }]), its factory, its land listing, and open attributes for future add-ons.
ALTER TABLE map_cells
  ADD COLUMN birth_level smallint NOT NULL DEFAULT 1 CHECK (birth_level BETWEEN 1 AND 30),
  ADD COLUMN terrain     text,
  ADD COLUMN walls       jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN factory_id  bigint,
  ADD COLUMN listing_id  bigint,
  ADD COLUMN attrs       jsonb NOT NULL DEFAULT '{}';
-- Terraformer changes now live on the block itself.
UPDATE map_cells c SET terrain = o.terrain FROM terrain_overrides o WHERE o.map_id = c.map_id AND o.x = c.x AND o.y = c.y;
DROP TABLE terrain_overrides;

-- Every map: E (base blocks: its starting size, fixed forever) and mined (first claims by players and
-- factories; Growth's extra blocks don't count). Its level is worked out from these two, never stored.
-- shape: how its starting blocks were made, for regenerating it ({ "blocks": n } from the seed, or
-- { "width": w, "height": h }); null for maps from before loop 16 (worked out by economy-reset).
ALTER TABLE maps
  ADD COLUMN base_blocks bigint CHECK (base_blocks > 0),
  ADD COLUMN mined       bigint NOT NULL DEFAULT 0 CHECK (mined >= 0),
  ADD COLUMN shape       jsonb;
-- Existing maps: E = their starting size (Xoren, loop 16): blocks now, less the ones growth added.
UPDATE maps m SET base_blocks = GREATEST(1, (SELECT count(*) FROM map_cells c WHERE c.map_id = m.id) - m.grown);
ALTER TABLE maps ALTER COLUMN base_blocks SET NOT NULL;

-- The server tick: when timed things (factories, item timers) were last brought up to date. The free server
-- sleeps; on waking it catches up on all the time since.
CREATE TABLE server_ticks (
  name    text PRIMARY KEY,
  last_at timestamptz NOT NULL
);
