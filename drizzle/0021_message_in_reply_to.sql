-- Optional reply link on messages (lib/tasks.ts send_message). Additive.
-- Existing rows stay null. ON DELETE SET NULL so deleting a parent unlinks replies
-- instead of deleting them. Roll back by dropping the index, the foreign key, and the column.
ALTER TABLE "messages" ADD COLUMN "in_reply_to" uuid;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_in_reply_to_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "messages_in_reply_to_idx" ON "messages" USING btree ("in_reply_to");
