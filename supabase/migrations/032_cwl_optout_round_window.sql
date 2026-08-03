-- PARTIAL availability: an account that can play some of the season but not all of it.
--
-- Migration 031 made "not participating" a durable input to the allocation engine, but it was all or
-- nothing. The common case is narrower and the leader already knows it in advance: someone travelling
-- who is back for round 4, or an account that has to go quiet after round 5. Recording that as a full
-- opt-out throws away six playable war days; recording nothing means the rotation cheerfully plans
-- them into a round they already said they cannot fight.
--
-- The window stores the rounds the account is UNAVAILABLE for, inclusive, and both ends are nullable:
--
--   from = NULL, to = NULL   whole season   — the migration-031 behaviour, unchanged.
--   from = 1,    to = 3      "back for round 4"
--   from = 6,    to = 7      "gone after round 5"
--
-- Storing the unavailable span rather than the available one keeps the full-season row meaning what
-- it always meant (an unbounded window), so every existing row stays correct with no backfill.
--
-- The distinction is load-bearing downstream, not cosmetic. A full opt-out is an ENGINE EXCLUSION:
-- the account is left out of the allocation entirely and its slot backfilled. A partial one must NOT
-- be — the account still has to be in a clan to fight the rounds it is available for, so it is
-- rostered normally and the constraint is handed to the rotation suggester instead. See
-- cwl/availability.ts for the shared semantics and roster.ts's loadOptedOutAccountTags, which
-- deliberately selects only the full-season rows.
ALTER TABLE cwl_season_optouts
  ADD COLUMN IF NOT EXISTS unavailable_from_round INT,
  ADD COLUMN IF NOT EXISTS unavailable_to_round INT;

-- Either both ends are set (a partial window) or neither is (the whole season). A half-open window
-- would have no agreed reading — "from round 4" could mean the 4th onwards or up to the 4th — and
-- the UI always sends both, so reject the ambiguous shape at the table rather than guessing later.
ALTER TABLE cwl_season_optouts
  DROP CONSTRAINT IF EXISTS cwl_season_optouts_window_check;
ALTER TABLE cwl_season_optouts
  ADD CONSTRAINT cwl_season_optouts_window_check CHECK (
    (unavailable_from_round IS NULL AND unavailable_to_round IS NULL)
    OR (
      unavailable_from_round IS NOT NULL
      AND unavailable_to_round IS NOT NULL
      AND unavailable_from_round >= 1
      AND unavailable_to_round >= unavailable_from_round
    )
  );
