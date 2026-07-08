-- AlterTable
ALTER TABLE "PrayerSlot" ADD COLUMN "guestToken" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PrayerProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "inviteToken" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrayerProject_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PrayerProject" ("createdAt", "description", "endDate", "id", "inviteToken", "organizerId", "startDate", "status", "timezone", "title", "visibility") SELECT "createdAt", "description", "endDate", "id", "inviteToken", "organizerId", "startDate", "status", "timezone", "title", "visibility" FROM "PrayerProject";
DROP TABLE "PrayerProject";
ALTER TABLE "new_PrayerProject" RENAME TO "PrayerProject";
CREATE UNIQUE INDEX "PrayerProject_inviteToken_key" ON "PrayerProject"("inviteToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PrayerSlot_guestToken_key" ON "PrayerSlot"("guestToken");

