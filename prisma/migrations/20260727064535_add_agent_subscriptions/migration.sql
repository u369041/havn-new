/*
  Warnings:

  - A unique constraint covering the columns `[stripeCustomerId]` on the table `AgentProfile` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeSubscriptionId]` on the table `AgentProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AgentSubscriptionStatus" AS ENUM ('NOT_STARTED', 'CHECKOUT_PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'UNPAID');

-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripePriceId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionCancelledAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "subscriptionStartedAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "AgentSubscriptionStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_stripeCustomerId_key" ON "AgentProfile"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_stripeSubscriptionId_key" ON "AgentProfile"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "AgentProfile_subscriptionStatus_idx" ON "AgentProfile"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "AgentProfile_stripePriceId_idx" ON "AgentProfile"("stripePriceId");
