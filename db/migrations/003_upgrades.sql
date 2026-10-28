-- Upgrade levels per player (they apply on every map). 0 means no effect; rules.js turns levels into effects.
-- Nothing can buy them yet.
ALTER TABLE players
  ADD COLUMN click_power smallint NOT NULL DEFAULT 0 CHECK (click_power >= 0),
  ADD COLUMN defense     smallint NOT NULL DEFAULT 0 CHECK (defense >= 0),
  ADD COLUMN earnings    smallint NOT NULL DEFAULT 0 CHECK (earnings >= 0);
