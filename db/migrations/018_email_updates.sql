-- Email updates list (loop 15): opt-in only. The latest choice on the player, every change in the log.
ALTER TABLE players ADD COLUMN email_updates boolean NOT NULL DEFAULT false,
  ADD COLUMN email_updates_at timestamptz, ADD COLUMN email_updates_source text,   -- 'signup', 'settings' or 'unsubscribe-link'
  ADD COLUMN unsubscribe_token text UNIQUE;                                        -- the one-click unsubscribe link's secret
CREATE TABLE email_consent_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id bigint NOT NULL REFERENCES players (id),
  subscribed boolean NOT NULL,
  source    text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
