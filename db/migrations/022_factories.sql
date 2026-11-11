-- Loop 16 Phase 5: factories. One per block, on the owner's own land; they mine on the server tick while awake.
--   awake_until:  it works until then (Factory Lifetime hours after it was built or woken), then sleeps
--   processed_at: the tick has brought it up to here (a step boundary); catch-up after a sleep starts here
--   target_x/y, progress: the block it is mining and the hits put in so far (never fades)
CREATE TABLE factories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_id       bigint  NOT NULL REFERENCES maps (id),
  owner_id     bigint  NOT NULL REFERENCES players (id),
  x            integer NOT NULL,
  y            integer NOT NULL,
  built_at     timestamptz NOT NULL DEFAULT now(),
  awake_until  timestamptz NOT NULL,
  processed_at timestamptz NOT NULL,
  target_x     integer,
  target_y     integer,
  progress     double precision NOT NULL DEFAULT 0,
  UNIQUE (map_id, x, y)
);
CREATE INDEX factories_owner ON factories (map_id, owner_id);
CREATE INDEX map_cells_factory ON map_cells (factory_id) WHERE factory_id IS NOT NULL;
