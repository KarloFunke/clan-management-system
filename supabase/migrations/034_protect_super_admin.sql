-- A super_admin can never be removed by a sweep, a bug, or a stray API call.
--
-- On 2026-09-14 a roster sync wrote person_id = NULL over every active account, which left the
-- super_admin's person with no linked account — and since login resolves tag → account → person →
-- access_role, nobody could sign in as the owner. App-level guardrails did not help because the
-- write that did it was not a delete. These guards live in the database so they hold for every
-- path: sync, API routes, and direct PostgREST access with the public anon key.
--
-- Enforced:
--   1. A person whose access_role is 'super_admin' cannot be deleted.
--   2. A super_admin person cannot be left without a linked account — by deleting the account or
--      by clearing / changing its person_id. Checked once per statement against the final state,
--      so a batch that removes one account while another remains is fine, and a batch that strips
--      all of them (the 2026-09-14 shape) fails and rolls back as a whole.
--   3. The family cannot be left with zero super_admins (demotion of the last one).
--
-- To deliberately retire a super_admin, first grant super_admin to their successor.

CREATE OR REPLACE FUNCTION guard_super_admin_person_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.access_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot delete super admin "%": revoke super_admin first', OLD.display_name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS persons_protect_super_admin_delete ON persons;
CREATE TRIGGER persons_protect_super_admin_delete
  BEFORE DELETE ON persons
  FOR EACH ROW EXECUTE FUNCTION guard_super_admin_person_delete();

CREATE OR REPLACE FUNCTION guard_last_super_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.access_role = 'super_admin'
     AND NEW.access_role IS DISTINCT FROM 'super_admin'
     AND NOT EXISTS (SELECT 1 FROM persons WHERE access_role = 'super_admin' AND id <> OLD.id) THEN
    RAISE EXCEPTION 'Cannot remove the last super admin ("%"): grant super_admin to someone else first', OLD.display_name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS persons_protect_last_super_admin ON persons;
CREATE TRIGGER persons_protect_last_super_admin
  BEFORE UPDATE OF access_role ON persons
  FOR EACH ROW EXECUTE FUNCTION guard_last_super_admin();

-- Statement-level with a transition table: evaluated after the whole statement, so it judges the
-- end state rather than each row in isolation.
CREATE OR REPLACE FUNCTION guard_super_admin_accounts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  orphaned text;
BEGIN
  SELECT p.display_name INTO orphaned
  FROM persons p
  WHERE p.access_role = 'super_admin'
    AND p.id IN (SELECT person_id FROM old_rows WHERE person_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM player_accounts a WHERE a.person_id = p.id)
  LIMIT 1;
  IF orphaned IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to remove the last linked account of super admin "%"', orphaned
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS player_accounts_protect_super_admin_update ON player_accounts;
CREATE TRIGGER player_accounts_protect_super_admin_update
  AFTER UPDATE ON player_accounts
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION guard_super_admin_accounts();

DROP TRIGGER IF EXISTS player_accounts_protect_super_admin_delete ON player_accounts;
CREATE TRIGGER player_accounts_protect_super_admin_delete
  AFTER DELETE ON player_accounts
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION guard_super_admin_accounts();
