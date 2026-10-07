-- init_identity
--
-- The accounts service's initial schema — docs/SSO_AND_IDENTITY.md §7.3, §13 step 1.
-- Identity only: who a person is, which browsers hold an SSO session, which apps
-- may ask, and the keys that sign the answers. No tenants, no business data.
--
-- 🔴 No RLS policies here, deliberately, and none should ever be added. RLS scopes
-- rows to an organizationId; this database has no organizations. `runAsTenant` does
-- not exist in this service. The equivalent guard is that the app connects as
-- `accounts_app`, which has DML but no DDL — it cannot drop the table its own
-- signing keys live in.
--
-- Both ADD UNIQUE warnings are safe: this runs against an empty database, so there
-- is nothing for either index to collide on.
--
-- Additive throughout — every statement CREATEs. Rolling back is dropping the
-- database, which at this point holds nothing.

-- `citext` is required before `users.email` can be CITEXT. Creating it here rather
-- than only by hand is what lets a fresh database be rebuilt from prisma/migrations
-- alone; the provisioning step also creates it, hence IF NOT EXISTS.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" TEXT,
    "first_name" VARCHAR(40) NOT NULL DEFAULT '',
    "last_name" VARCHAR(40) NOT NULL DEFAULT '',
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(32),
    "user_agent" TEXT,

    CONSTRAINT "sso_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "client_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_clients" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "post_logout_redirect_uris" TEXT[],
    "backchannel_logout_uri" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_keys" (
    "kid" VARCHAR(64) NOT NULL,
    "algorithm" VARCHAR(16) NOT NULL,
    "public_jwk" JSONB NOT NULL,
    "private_jwk" JSONB NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("kid")
);

-- CreateTable
CREATE TABLE "oidc_payloads" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" VARCHAR(255),
    "user_code" VARCHAR(64),
    "uid" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_payloads_pkey" PRIMARY KEY ("type","id")
);

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sso_sessions_user_id_idx" ON "sso_sessions"("user_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "session_grants_session_id_client_id_key" ON "session_grants"("session_id", "client_id");

-- CreateIndex
CREATE INDEX "oidc_payloads_grant_id_idx" ON "oidc_payloads"("grant_id");

-- CreateIndex
CREATE INDEX "oidc_payloads_uid_idx" ON "oidc_payloads"("uid");

-- CreateIndex
CREATE INDEX "oidc_payloads_user_code_idx" ON "oidc_payloads"("user_code");

-- CreateIndex
CREATE INDEX "oidc_payloads_expires_at_idx" ON "oidc_payloads"("expires_at");

-- AddForeignKey
ALTER TABLE "sso_sessions" ADD CONSTRAINT "sso_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_grants" ADD CONSTRAINT "session_grants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sso_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
