-- Which side failed: the checks refusing what the model said about the text,
-- or no answer ever arriving. The screen shows different things for the two —
-- a structure failure is about what was written, a provider failure is an
-- outage — and recovering that by matching on an error string is the kind of
-- coupling that breaks the first time the wording improves.
ALTER TABLE "DayExtraction" ADD COLUMN "failureKind" TEXT;
