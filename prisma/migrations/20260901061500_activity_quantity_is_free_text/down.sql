-- Down migration for 20260901061500_activity_quantity_is_free_text.
--
-- There is nothing to reverse structurally: this rewrote one field inside a JSON
-- column and changed no schema. Reverting the SHAPE would mean turning free text
-- back into an integer, which cannot be done without losing the words — "half
-- day" has no integer.
--
-- If the previous shape is genuinely needed, rebuild it from "ActivityLog",
-- which still holds both the verbatim text and the parsed number.

SELECT 1;
