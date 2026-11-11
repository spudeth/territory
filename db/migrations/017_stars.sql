-- Starred skins (loop 15): one pattern and one art skin per player, shown on the Owned tab and the profile.
ALTER TABLE players ADD COLUMN star_pattern text, ADD COLUMN star_art text;
