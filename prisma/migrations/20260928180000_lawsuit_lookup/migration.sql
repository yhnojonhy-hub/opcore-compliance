-- CreateTable
CREATE TABLE "LawsuitLookup" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LawsuitLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LawsuitLookup_number_key" ON "LawsuitLookup"("number");

-- CreateIndex
CREATE INDEX "LawsuitLookup_expiresAt_idx" ON "LawsuitLookup"("expiresAt");
