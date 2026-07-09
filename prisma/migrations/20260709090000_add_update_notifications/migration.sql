ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'de';
ALTER TABLE "PrayerSlot" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'de';
CREATE TABLE "UpdateOptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpdateOptOut_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PrayerProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UpdateOptOut_projectId_email_key" ON "UpdateOptOut"("projectId", "email");
