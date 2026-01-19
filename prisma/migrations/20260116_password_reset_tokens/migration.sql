-- 20260116_password_reset_tokens
-- Create PasswordResetToken table + indexes + FK

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "userAgent" TEXT
);

-- Unique token hash
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key"
ON "PasswordResetToken"("tokenHash");

-- Indexes for lookups / cleanup
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"
ON "PasswordResetToken"("userId");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx"
ON "PasswordResetToken"("expiresAt");

-- FK to User with cascade delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PasswordResetToken_userId_fkey'
  ) THEN
    ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
