-- Parallele Kommunikation: Owner-gepflegte Gruppen-Links (validierte Dienst-URLs)
ALTER TABLE "PrayerProject" ADD COLUMN "linkWhatsapp" TEXT;
ALTER TABLE "PrayerProject" ADD COLUMN "linkTelegram" TEXT;
ALTER TABLE "PrayerProject" ADD COLUMN "linkSignal" TEXT;
