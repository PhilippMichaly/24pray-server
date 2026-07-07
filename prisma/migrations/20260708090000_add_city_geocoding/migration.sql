-- CreateTable
CREATE TABLE "City" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "population" INTEGER NOT NULL,
    "search" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "City_population_idx" ON "City"("population");

