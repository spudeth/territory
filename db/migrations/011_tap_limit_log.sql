-- Players whose taps went over the tap-rate limit (rules.MAX_TAPS_PER_SECOND), one row per player per minute
-- with how many taps were ignored, so bots can be spotted later. No bans yet.
CREATE TABLE tap_limit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players (id),
  ignored    integer NOT NULL CHECK (ignored > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tap_limit_log_player ON tap_limit_log (player_id);
