-- Squares balances keep fractions (Earnings is a multiplier), to 6 places like rules.SQUARE_DECIMALS.
-- Players see the whole number, rounded down. Existing whole balances keep their values.
ALTER TABLE players ALTER COLUMN squares TYPE numeric(24, 6);
ALTER TABLE square_ledger ALTER COLUMN delta TYPE numeric(24, 6);
ALTER TABLE square_ledger ALTER COLUMN balance_after TYPE numeric(24, 6);
