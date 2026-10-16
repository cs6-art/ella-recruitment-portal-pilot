-- Lower the first-100 launch promotion grant from 250 to 25 credits.
--
-- Only affects organizations that claim a slot after this runs; grants already
-- made keep their recorded ledger amounts.
--
-- Rollback: UPDATE "launch_promotions" SET "credits" = 250 WHERE "key" = 'event-launch-first-100';

UPDATE "launch_promotions" SET "credits" = 25 WHERE "key" = 'event-launch-first-100';
