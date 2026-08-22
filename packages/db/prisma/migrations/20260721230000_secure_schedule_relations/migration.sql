-- Remove only rows that cannot satisfy the new relations.
DELETE FROM "ScheduleItem" AS item
WHERE NOT EXISTS (
  SELECT 1 FROM "Section" AS section WHERE section."id" = item."sectionId"
)
OR EXISTS (
  SELECT 1
  FROM "Schedule" AS schedule
  WHERE schedule."id" = item."scheduleId"
    AND NOT EXISTS (
      SELECT 1 FROM "Term" AS term WHERE term."id" = schedule."termId"
    )
);

DELETE FROM "Schedule" AS schedule
WHERE NOT EXISTS (
  SELECT 1 FROM "Term" AS term WHERE term."id" = schedule."termId"
);

-- Add supporting indexes.
CREATE INDEX "Schedule_termId_idx" ON "Schedule"("termId");
CREATE INDEX "ScheduleItem_sectionId_idx" ON "ScheduleItem"("sectionId");

-- AddForeignKey
ALTER TABLE "Schedule"
ADD CONSTRAINT "Schedule_termId_fkey"
FOREIGN KEY ("termId") REFERENCES "Term"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleItem"
ADD CONSTRAINT "ScheduleItem_sectionId_fkey"
FOREIGN KEY ("sectionId") REFERENCES "Section"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
