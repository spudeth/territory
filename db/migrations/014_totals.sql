-- Lifetime totals for achievements (totals.js): one row per player per stat, e.g. 'claims', 'taps',
-- 'terrain:gold'. Records only improve; lastDay, streak and dayClaims are the day bookkeeping.
CREATE TABLE player_totals (
  player_id bigint NOT NULL REFERENCES players (id),
  stat      text   NOT NULL,
  value     double precision NOT NULL,
  PRIMARY KEY (player_id, stat)
);

-- Earlier play already counts: blocks claimed, taken and lost, wipes, maps played, upgrades bought, squares
-- earned and spent, renames.
INSERT INTO player_totals (player_id, stat, value)
SELECT player_id, 'claims', sum(first_claims) FROM player_map_stats GROUP BY player_id HAVING sum(first_claims) > 0
UNION ALL SELECT player_id, 'taken', sum(retakes) FROM player_map_stats GROUP BY player_id HAVING sum(retakes) > 0
UNION ALL SELECT player_id, 'lost', sum(blocks_lost) FROM player_map_stats GROUP BY player_id HAVING sum(blocks_lost) > 0
UNION ALL SELECT player_id, 'wipes', count(*) FROM map_wipes GROUP BY player_id
UNION ALL SELECT player_id, 'mapsPlayed', count(*) FROM player_map_settings GROUP BY player_id
UNION ALL SELECT player_id, 'purchases', count(*) FROM square_ledger WHERE reason LIKE 'upgrade:%' GROUP BY player_id
UNION ALL SELECT player_id, 'squaresSpent', -sum(delta) FROM square_ledger WHERE reason LIKE 'upgrade:%' GROUP BY player_id
UNION ALL SELECT player_id, 'squaresEarned', sum(delta) FROM square_ledger WHERE reason = 'first_claim' GROUP BY player_id
UNION ALL SELECT id, 'renames', 1 FROM players WHERE name_changed_at IS NOT NULL;
