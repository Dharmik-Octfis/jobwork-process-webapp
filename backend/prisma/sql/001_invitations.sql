-- Invitations table (organization member invites by email).
--
-- The DB is currently ahead-of/managed-by-hand (see docs/PRISMA.md §8) — there
-- is no migration history yet, so apply this by hand in pgAdmin/psql exactly as
-- the `organizations` and `memberships` tables were created. Once the baseline
-- migration exists, fold this into it instead.
--
-- Depends on: `organizations`, `users`, and the `citext` extension (already
-- enabled — the `users.email` column uses it).

CREATE TABLE IF NOT EXISTS "invitations" (
    "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" TEXT          NOT NULL,
    "email"           CITEXT        NOT NULL,
    "role"            VARCHAR(50)   NOT NULL DEFAULT 'member',
    "token_hash"      TEXT          NOT NULL,
    "status"          VARCHAR(20)   NOT NULL DEFAULT 'pending',
    "invited_by_id"   UUID          NOT NULL,
    "expires_at"      TIMESTAMPTZ(6) NOT NULL,
    "accepted_at"     TIMESTAMPTZ(6),
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_key"
    ON "invitations" ("token_hash");

CREATE INDEX IF NOT EXISTS "invitations_email_idx"
    ON "invitations" ("email");

-- One live invite per email per organization; re-inviting UPSERTs this row.
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_organization_id_email_key"
    ON "invitations" ("organization_id", "email");

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("organization_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitations"
    ADD CONSTRAINT "invitations_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
