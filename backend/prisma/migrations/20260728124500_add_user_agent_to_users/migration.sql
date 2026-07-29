-- Add the browser/device user agent to the users table for account details.
ALTER TABLE "users" ADD COLUMN "user_agent" TEXT;