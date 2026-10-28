-- Achievements each player has earned (definitions live in achievements.js), with the map where it happened.
CREATE TABLE player_achievements (
  player_id      bigint NOT NULL REFERENCES players (id),
  achievement_id text   NOT NULL,
  map_id         bigint REFERENCES maps (id),
  earned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, achievement_id)
);
