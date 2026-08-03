-- CWL: record mid-preparation lineup swaps on the round itself.
--
-- The round-reveal notice (migration 027) fires once, when a round's lineup first lands, and stamps
-- `lineup_notified_at` so it cannot repost for the rest of the prep window. That was right for the
-- reveal and wrong for everything after it: a leader who swaps a player in on prep day produces a
-- genuinely new fact, and the stamp guaranteed nobody was told.
--
-- The plan cannot supply that signal either. From sign-up onward the sync rewrites the roster board
-- from the in-game signup list (see src/lib/cwl/signupReconcile.ts) — bench flags included — so the
-- plan follows reality within one poll and a planned-vs-actual diff reads "as planned" no matter what
-- was swapped. The only honest comparison mid-prep is the lineup against the lineup we saw LAST poll,
-- which means the observation has to be kept somewhere. Here.
--
-- `lineup_changes` is an append-only log, newest last, each entry:
--   { "at": "<iso>", "swappedIn": [{"playerTag","name"}], "swappedOut": [{"playerTag","name"}] }
-- It is written whether or not the Discord notice succeeds — the swap happened either way, and the
-- round card is the durable record; the message is best-effort like the rest of the notify layer.

ALTER TABLE cwl_rounds ADD COLUMN IF NOT EXISTS lineup_changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cwl_rounds ADD COLUMN IF NOT EXISTS lineup_changed_at TIMESTAMPTZ;
