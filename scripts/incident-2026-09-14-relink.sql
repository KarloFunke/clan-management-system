-- Incident 2026-09-14: roster sync wrote person_id = NULL over every family clan's active roster
-- (see src/lib/sync.ts step 3b and sync.test.ts). Persons and accounts were NOT deleted; only the
-- link between them was lost. The link survives in history tables that store both person_id and the
-- account tag, written before the incident:
--   cwl_allocations (person_id, player_account_tag)
--   cwl_war_members (person_id, player_tag)
--   war_members     (person_id, player_tag)
--   strikes         (person_id, player_account_tag)
--
-- This builds tag → person from all four and relinks only accounts that are currently unlinked, only
-- when every source agrees on ONE person, and only to a person that still exists. Anything ambiguous
-- is listed for a leader to resolve by hand.
--
-- Run the whole file: it ends in ROLLBACK. Inspect the output, then change the last line to COMMIT.

BEGIN;

CREATE TEMP TABLE relink_evidence ON COMMIT DROP AS
SELECT player_account_tag AS tag, person_id, 'cwl_allocations' AS src FROM cwl_allocations WHERE person_id IS NOT NULL AND player_account_tag IS NOT NULL
UNION ALL SELECT player_tag, person_id, 'cwl_war_members' FROM cwl_war_members WHERE person_id IS NOT NULL
UNION ALL SELECT player_tag, person_id, 'war_members'     FROM war_members     WHERE person_id IS NOT NULL
UNION ALL SELECT player_account_tag, person_id, 'strikes' FROM strikes         WHERE person_id IS NOT NULL AND player_account_tag IS NOT NULL;

CREATE TEMP TABLE relink_plan ON COMMIT DROP AS
SELECT e.tag,
       count(DISTINCT e.person_id)                    AS candidate_persons,
       (array_agg(DISTINCT e.person_id))[1]           AS person_id,
       string_agg(DISTINCT e.src, ',')                AS sources
FROM relink_evidence e
JOIN player_accounts a ON a.player_tag = e.tag AND a.person_id IS NULL
JOIN persons p         ON p.id = e.person_id
GROUP BY e.tag;

-- 1. Ambiguous: one tag, several persons in history. Resolve by hand.
SELECT r.tag, a.in_game_name, a.status, array_agg(DISTINCT p.display_name) AS persons
FROM relink_plan r
JOIN player_accounts a ON a.player_tag = r.tag
JOIN relink_evidence e ON e.tag = r.tag
JOIN persons p ON p.id = e.person_id
WHERE r.candidate_persons > 1
GROUP BY r.tag, a.in_game_name, a.status;

-- 2. What will be relinked.
SELECT r.tag, a.in_game_name, a.status, p.display_name, r.sources
FROM relink_plan r
JOIN player_accounts a ON a.player_tag = r.tag
JOIN persons p ON p.id = r.person_id
WHERE r.candidate_persons = 1
ORDER BY p.display_name, r.tag;

UPDATE player_accounts a
SET person_id = r.person_id
FROM relink_plan r
WHERE a.player_tag = r.tag AND r.candidate_persons = 1 AND a.person_id IS NULL;

-- 3. Persons still without any account afterwards (need a manual link in the dashboard).
SELECT p.id, p.display_name, p.created_at
FROM persons p
WHERE NOT EXISTS (SELECT 1 FROM player_accounts a WHERE a.person_id = p.id)
ORDER BY p.display_name;

-- 4. Summary.
SELECT count(*) FILTER (WHERE person_id IS NOT NULL) AS linked_accounts,
       count(*) FILTER (WHERE person_id IS NOT NULL AND status = 'active') AS linked_active
FROM player_accounts;

ROLLBACK;  -- change to COMMIT once the output above looks right
