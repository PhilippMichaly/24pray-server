-- Lasttest-Fix Schreiblast: genau EIN aktiver Slot pro (Projekt, Startzeit).
-- Partieller Unique-Index statt App-seitiger Transaktion (findFirst+create serialisierte
-- unter Konkurrenz und lief in Prisma-Transaction-Timeouts). CANCELLED bleibt re-buchbar.
CREATE UNIQUE INDEX "PrayerSlot_active_slot_unique"
  ON "PrayerSlot"("projectId", "startTime")
  WHERE "status" IN ('BOOKED', 'COMPLETED');
