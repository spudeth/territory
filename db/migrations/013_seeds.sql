-- Seeded maps (public/terrain.js): the seed decides a map's terrain, its starting shape and where it grows.
-- grown counts its growths, so the n-th growth always takes the same spot. Maps without a seed are all grass
-- and grow at random, as before.
ALTER TABLE maps ADD COLUMN seed text;
ALTER TABLE maps ADD COLUMN grown integer NOT NULL DEFAULT 0;
