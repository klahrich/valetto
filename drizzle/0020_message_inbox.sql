-- Standalone-message inbox (lib/inbox.ts). Additive. read_at is the recipient's mark (null = unread).
-- inbox_seq is arrival order for pagination, not the read watermark.
-- A sequence number taken at INSERT and committed later can be skipped by a keyset cursor: a higher number
-- can commit and be listed while the lower one is still open. messages_assign_inbox_seq takes a transaction
-- advisory lock before nextval and holds it until commit, so a higher number cannot commit first.
-- Existing rows are numbered in (created_at, id) order. Task threads and wakes are unchanged.
-- Roll back by dropping the trigger, the function, both indexes, both columns, and messages_inbox_seq.
ALTER TABLE "messages" ADD COLUMN "read_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "inbox_seq" bigint;
--> statement-breakpoint
CREATE SEQUENCE "messages_inbox_seq" AS bigint;
--> statement-breakpoint
CREATE FUNCTION "messages_assign_inbox_seq"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Same transaction can insert many rows; pg_advisory_xact_lock is reentrant.
  -- hashtextextended keeps this lock off the keys used for rate limits.
  PERFORM pg_advisory_xact_lock(hashtextextended('replyslip.messages.inbox_seq', 0));
  NEW.inbox_seq := nextval('public.messages_inbox_seq');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "messages_assign_inbox_seq"
BEFORE INSERT ON "messages"
FOR EACH ROW
EXECUTE FUNCTION "messages_assign_inbox_seq"();
--> statement-breakpoint
-- Backfill rows that existed before the trigger. The migration transaction holds the same lock, so an insert
-- that arrives after this migration commits cannot take a number in the middle of the backfill.
DO $$
DECLARE
  row_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('replyslip.messages.inbox_seq', 0));
  FOR row_id IN
    SELECT id FROM messages WHERE inbox_seq IS NULL ORDER BY created_at, id
  LOOP
    UPDATE messages SET inbox_seq = nextval('public.messages_inbox_seq') WHERE id = row_id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "inbox_seq" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_inbox_seq_unique" ON "messages" ("inbox_seq");
--> statement-breakpoint
CREATE INDEX "messages_inbox_idx" ON "messages" ("to_agent_id", "inbox_seq") WHERE "task_id" IS NULL;
