-- drop_process_item_changes
--
-- `processes.item_changes` ("The item changes") is removed end to end. Nothing on
-- the server has read it since 2026-08-12 (a step's outputs are exactly the rows
-- the client sends); its last effect was the step grid seeding an output row from
-- the first input, which "Same as consumed" now does for every input.
--
-- Hand-written: `db:draft` against jobwork_local also emitted unrelated drift from
-- other branches, none of which belongs here.
--
-- @destructive-ok: the flag drives no logic. On 2026-09-30 it was true on 3 of 12 live processes in jobwork_local (1 org) and 4 of 11 in jobwork_dev (2 orgs), all QC data.

ALTER TABLE "processes" DROP COLUMN IF EXISTS "item_changes";
