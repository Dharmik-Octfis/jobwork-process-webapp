-- Two additions to invitations:
--
-- 1. DECLINE. `declined_at` records when the invitee said no. The status column
--    gains a fourth value ('declined') — it is a VarChar with a comment, not a
--    Postgres enum, per the repo convention, so no type change is needed here.
--    Declining is reversible: re-inviting resets the row to 'pending'.
--
-- 2. SEND THROTTLING. Every createInvitation call sends an email, and the row is
--    RECYCLED on re-invite (@@unique([organization_id, email])), so there is no
--    row-per-send to count. These two columns ARE the send record:
--      send_count   — how many times this invite has been emailed
--      last_sent_at — drives the per-recipient cooldown AND the per-org hourly cap
--    Enforced in the database rather than in memory because AppSail runs many
--    short-lived instances; an in-process counter would be no limit at all.

ALTER TABLE "invitations"
  ADD COLUMN "declined_at"  TIMESTAMPTZ(6),
  ADD COLUMN "send_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_sent_at" TIMESTAMPTZ(6);

-- The per-org hourly cap counts rows by (organization_id, last_sent_at) on every
-- send, so give it an index rather than a sequential scan of the org's invites.
CREATE INDEX "invitations_organization_id_last_sent_at_idx"
  ON "invitations"("organization_id", "last_sent_at");
