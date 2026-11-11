-- Loop 16 Phase 4: consumable items (Demolition) are bought into an inventory and used up one at a time.
CREATE TABLE player_inventory (
  player_id bigint NOT NULL REFERENCES players (id),
  item_id   text   NOT NULL,
  count     integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (player_id, item_id)
);
