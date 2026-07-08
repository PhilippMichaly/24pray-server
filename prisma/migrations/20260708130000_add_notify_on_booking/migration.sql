-- Owner-Benachrichtigung bei neuer Buchung in der eigenen Kette (Default: an).
ALTER TABLE "PrayerProject" ADD COLUMN "notifyOnBooking" BOOLEAN NOT NULL DEFAULT true;
