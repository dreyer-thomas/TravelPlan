-- Remove the discontinued comments & voting feature.
-- Dropped in FK-safe order: children first, then the target table.
-- SQLite drops a table's indexes together with the table, so no explicit DROP INDEX is needed.

DROP TABLE IF EXISTS "trip_feedback_votes";
DROP TABLE IF EXISTS "trip_feedback_comments";
DROP TABLE IF EXISTS "trip_feedback_targets";
