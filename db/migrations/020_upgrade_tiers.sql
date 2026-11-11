-- Loop 16 Phase 3: upgrades are tiers (1-10, tier 1 free for everyone). The old level tables are gone.
-- tiers: { upgrade key: tier } for tiers above 1 (missing = tier 1). highest_level: the highest block level this
-- player has ever first-claimed, on any map (tier N can be bought once it is N or more).
ALTER TABLE players ADD COLUMN tiers jsonb NOT NULL DEFAULT '{}';
ALTER TABLE players ADD COLUMN highest_level smallint NOT NULL DEFAULT 1 CHECK (highest_level BETWEEN 1 AND 30);
ALTER TABLE players DROP COLUMN click_power, DROP COLUMN defense, DROP COLUMN earnings, DROP COLUMN growth;
DROP TABLE level_remaps;
DROP TABLE economy_applied;

-- players and maps point at each other (last map; who made a map): checked at commit, so a restore can put
-- them back in any order.
ALTER TABLE players ALTER CONSTRAINT players_last_map_id_fkey DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE maps ALTER CONSTRAINT maps_created_by_fkey DEFERRABLE INITIALLY IMMEDIATE;
