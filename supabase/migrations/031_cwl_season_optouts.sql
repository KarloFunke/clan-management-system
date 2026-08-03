-- Accounts a leader has marked as NOT PARTICIPATING in a CWL season.
--
-- The allocation engine reasons about who is *able* to play (TH level, Ranked tier, active strikes).
-- It has no way to know who is *willing* to: a player on holiday, someone who asked to sit this one
-- out, an alt the owner does not want to run for a week. Until now the only lever was "Remove from
-- season", which writes status='removed' onto the allocation row — and every allocation row is
-- deleted and rebuilt by a re-allocation (see cwl/generate.ts). So the leader's decision survived
-- exactly until the next time anyone reordered the clan priorities.
--
-- The opt-out therefore lives OUTSIDE the allocation, keyed by (season, account). It is an input to
-- the engine rather than an output of it, which is what makes it durable: regenerating the roster
-- re-reads this table and leaves the account out again.
--
-- Scoped per SEASON, not globally, because "not playing" is a statement about one week. It is keyed
-- by player_account_tag to match cwl_allocations and the strike system — a person's alts opt out
-- independently, since sitting one account out says nothing about the others.
--
-- Deliberately NOT a foreign key onto player_accounts: an account can leave the family mid-season
-- and the leader's decision should not disappear with it (same reasoning as strikes' ON DELETE SET
-- NULL). The season link does cascade — an opt-out has no meaning without its season.
CREATE TABLE IF NOT EXISTS cwl_season_optouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  player_account_tag TEXT NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, player_account_tag)
);

CREATE INDEX IF NOT EXISTS idx_cwl_season_optouts_season ON cwl_season_optouts(season_id);
