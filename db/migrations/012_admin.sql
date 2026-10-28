-- Admin commands (npm run admin): what was done, bans, which guest profiles belong to the same person, and
-- deleted accounts.

-- Every admin command run, refused or not.
CREATE TABLE admin_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command    text NOT NULL,
  target     text,                       -- e.g. 'map Grass', 'player Sly Wolf'
  args       jsonb NOT NULL DEFAULT '{}',
  ok         boolean NOT NULL,
  result     text NOT NULL,              -- what changed, or why it was refused
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A ban stops a player (and the profiles linked to them) from connecting until it ends or is lifted.
CREATE TABLE bans (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES players (id),
  reason     text,
  until      timestamptz,                -- null: permanent
  lifted_at  timestamptz,                -- set by unban
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bans_player ON bans (player_id);

-- Profiles seen together on one device: a logged-in account and the guest token the browser also held.
CREATE TABLE player_links (
  account_id bigint NOT NULL REFERENCES players (id),
  guest_id   bigint NOT NULL REFERENCES players (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, guest_id)
);

-- A deleted account keeps only an anonymous row, for the squares ledger.
ALTER TABLE players ADD COLUMN deleted_at timestamptz;
