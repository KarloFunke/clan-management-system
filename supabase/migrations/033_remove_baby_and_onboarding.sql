-- Remove the "baby" (probationary new-recruit) and structured-onboarding concepts. The app no longer
-- reads or writes any of these.
--
-- DESTRUCTIVE: drops every onboarding event (the per-member onboarding timeline). At the time of
-- writing prod held 50 onboarding_events rows and 0 persons with is_baby = true.
-- leadership_logs rows with category 'recruitment' / 'promotion' are kept: they are ordinary
-- activity history, shown in the activity feed and leadership graphs.

DROP TABLE IF EXISTS onboarding_events;

ALTER TABLE persons DROP COLUMN IF EXISTS is_baby;
ALTER TABLE persons DROP COLUMN IF EXISTS baby_started_at;

DELETE FROM settings WHERE key = 'baby_trial_days';
