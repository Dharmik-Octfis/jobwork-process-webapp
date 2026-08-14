-- Which godown each challan line physically left.
--
-- The header's `source_location_id` stays as the DISPATCH POINT — the address on
-- the Rule 55 challan. This records where the goods actually were, which stops
-- being the same question the moment a site has more than one godown: a mill with
-- three racks under one roof loads one vehicle from all three, and one challan per
-- rack is paperwork that does not match the lorry.
--
-- The rule enforced in the service is that every line sits in the same DISPATCH
-- SITE as the header — the root of `locations.parent_id`. Locations under one site
-- share an address, so one challan is honest; two separate premises have two
-- addresses and need two challans. Nothing is configured: it falls out of how the
-- customer modelled their locations, and a flat setup with no parents behaves
-- exactly as it did before this column existed.
--
-- 🔴 THREE STATEMENTS, IN THIS ORDER. Migrations here are not transactional, so a
-- NOT NULL added before the backfill would leave the column half-applied and the
-- table unusable. Add nullable, fill from the header, then constrain.

ALTER TABLE "job_issue_lines"
  ADD COLUMN IF NOT EXISTS "source_location_id" uuid;

-- Every existing line left the header's location, because until now there was
-- nowhere else it could have come from.
UPDATE "job_issue_lines" AS l
SET "source_location_id" = i."source_location_id"
FROM "job_issues" AS i
WHERE i."id" = l."job_issue_id"
  AND l."source_location_id" IS NULL;

ALTER TABLE "job_issue_lines"
  ALTER COLUMN "source_location_id" SET NOT NULL;

ALTER TABLE "job_issue_lines"
  ADD CONSTRAINT "job_issue_lines_source_location_id_fkey"
  FOREIGN KEY ("source_location_id") REFERENCES "locations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The allocator reads lines by location when it works out what is still out
-- against a challan.
CREATE INDEX IF NOT EXISTS "job_issue_lines_organization_id_source_location_id_idx"
  ON "job_issue_lines" ("organization_id", "source_location_id");
