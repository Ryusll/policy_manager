ALTER TABLE "articles"
ADD COLUMN "clause_number" INTEGER,
ADD COLUMN "item_number" INTEGER,
ADD COLUMN "has_precedent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "has_related_law" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "has_related_rule" BOOLEAN NOT NULL DEFAULT false;
