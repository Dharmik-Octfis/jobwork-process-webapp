-- add_verification_tokens
--
-- Short-lived one-time codes for the two flows that prove control of an inbox:
-- verifying a new address, and resetting a forgotten password (7.1's login/).
--
-- Purely additive: one new table, nothing existing is touched.
--
-- One table with a purpose column rather than two tables, because the lifecycle is
-- identical — issue, email, verify once, delete — and two would be two places to
-- get the expiry check wrong.
--
-- Keyed by email rather than user id on purpose. Password reset must not reveal
-- whether an address has an account, so the lookup happens before any user is
-- resolved; and email verification necessarily runs for an address not yet known to
-- belong to anyone.
--
-- expires_at is indexed for the sweep. Nothing deletes an abandoned code today, so
-- rows accumulate the same way oidc_payloads did before its sweeper — wire this
-- into that sweeper when either grows.

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "otp" VARCHAR(6) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_tokens_email_purpose_idx" ON "verification_tokens"("email", "purpose");

-- CreateIndex
CREATE INDEX "verification_tokens_expires_at_idx" ON "verification_tokens"("expires_at");
