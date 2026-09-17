-- drop_item_default_tolerance
--
-- @destructive-ok: tolerance is no longer a fixed per-item default; each job order input row keeps its own typed tolerance_pct, which this does not touch
--
-- Drops `items.default_tolerance_pct`. Job orders stopped copying it onto their input
-- rows in the same change, and every row already copied keeps its value in
-- `job_order_step_inputs.tolerance_pct` — the over-issue ceiling reads only that.
-- 🔴 Apply only once every deployed app using this database runs code whose Prisma
-- schema no longer lists the column — an older client selects it by default and
-- every items query fails.
--
-- Re-runnable: migrations here are not transactional, so the drop uses IF EXISTS.
--
-- 🔴 Deliberately NOT here: `refresh_tokens.idp_session_id`, `refresh_tokens.idp_subject`
-- and `users.identity_user_id`. `migrate diff` proposes dropping them because the
-- SSO work added them out of band; they are not this migration's to remove.

ALTER TABLE "items" DROP COLUMN IF EXISTS "default_tolerance_pct";
