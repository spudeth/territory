-- Each player's place in the tutorial and the tips they've seen: { step, done, tips }.
-- Players from before the tutorial existed aren't new, so theirs starts as done.
ALTER TABLE players ADD COLUMN tutorial jsonb NOT NULL DEFAULT '{}';
UPDATE players SET tutorial = '{"done": true}';
