-- Loop 17: upgrades are bought in steps (stepsPerTier per tier, 90). players.upgrade_steps: { upgrade key: steps
-- owned } (missing = 0, the start). Tiers bought so far become the steps up to the end of the tier before
-- (tier N's value was the old tier N-1 end; the economy reset clears them anyway).
ALTER TABLE players ADD COLUMN upgrade_steps jsonb NOT NULL DEFAULT '{}';
UPDATE players SET upgrade_steps = (SELECT COALESCE(jsonb_object_agg(k, ((v::int) - 1) * 90), '{}') FROM jsonb_each_text(tiers) AS t (k, v))
  WHERE tiers <> '{}';
ALTER TABLE players DROP COLUMN tiers;
