-- Add mustChangePassword so admin-created (invited) users must set their own
-- password before using the app. Defaults to false for all existing users:
-- they already know their password.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;