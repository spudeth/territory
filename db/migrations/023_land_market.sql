-- Loop 16 Phase 7: the land market. A listing is a connected bundle of the seller's blocks (map_cells.listing_id)
-- at one price (tenths). A sale moves the blocks, their factories and walls to the buyer; marketFee of the price
-- is destroyed.
CREATE TABLE listings (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  map_id     bigint NOT NULL REFERENCES maps (id),
  seller_id  bigint NOT NULL REFERENCES players (id),
  price      bigint NOT NULL CHECK (price > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_map ON listings (map_id);
CREATE INDEX map_cells_listing ON map_cells (listing_id) WHERE listing_id IS NOT NULL;
