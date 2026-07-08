-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringCommitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringCommitment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrayerRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrayerRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrayerRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "minutesBefore" INTEGER NOT NULL DEFAULT 60,
    CONSTRAINT "ReminderPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PrayerSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestToken" TEXT,
    "notifyChannel" TEXT NOT NULL DEFAULT 'EMAIL',
    "remindedAt" DATETIME,
    "recurringId" TEXT,
    CONSTRAINT "PrayerSlot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrayerSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PrayerSlot_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringCommitment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PrayerSlot" ("endTime", "guestEmail", "guestName", "guestToken", "id", "notifyChannel", "projectId", "startTime", "status", "userId") SELECT "endTime", "guestEmail", "guestName", "guestToken", "id", "notifyChannel", "projectId", "startTime", "status", "userId" FROM "PrayerSlot";
DROP TABLE "PrayerSlot";
ALTER TABLE "new_PrayerSlot" RENAME TO "PrayerSlot";
CREATE UNIQUE INDEX "PrayerSlot_guestToken_key" ON "PrayerSlot"("guestToken");
CREATE INDEX "PrayerSlot_projectId_startTime_idx" ON "PrayerSlot"("projectId", "startTime");
CREATE INDEX "PrayerSlot_status_startTime_idx" ON "PrayerSlot"("status", "startTime");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_projectId_key" ON "Membership"("userId", "projectId");

-- CreateIndex
CREATE INDEX "PrayerRequest_projectId_createdAt_idx" ON "PrayerRequest"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPreference_userId_key" ON "ReminderPreference"("userId");

