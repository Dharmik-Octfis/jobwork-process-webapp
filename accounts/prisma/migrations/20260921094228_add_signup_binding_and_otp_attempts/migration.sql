-- add_signup_binding_and_otp_attempts
--
-- Invitation / signup fix (docs/SSO_WEBSITE_ENTRY_PLAN.md, invitee journey):
--   attempts               — cap wrong guesses on a 6-digit code (was unlimited)
--   binding_hash           — a code can only be redeemed by the browser that asked for it
--   pending_password_hash  — the signup password applies only when the code is confirmed
--   pending_first_name / pending_last_name — likewise for the name
--
-- Additive only: one column with a default, four nullable. Rows written by the code
-- running before this deploy are unaffected, and that code ignores the new columns.
-- IF NOT EXISTS because migrations here are not transactional — a re-run after a
-- partial failure must not error on the columns that already landed.
ALTER TABLE "verification_tokens" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "verification_tokens" ADD COLUMN IF NOT EXISTS "binding_hash" VARCHAR(64);
ALTER TABLE "verification_tokens" ADD COLUMN IF NOT EXISTS "pending_first_name" VARCHAR(40);
ALTER TABLE "verification_tokens" ADD COLUMN IF NOT EXISTS "pending_last_name" VARCHAR(40);
ALTER TABLE "verification_tokens" ADD COLUMN IF NOT EXISTS "pending_password_hash" TEXT;
