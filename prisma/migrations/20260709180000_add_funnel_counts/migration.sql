CREATE TABLE "FunnelCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "FunnelCount_date_step_key" ON "FunnelCount"("date", "step");
