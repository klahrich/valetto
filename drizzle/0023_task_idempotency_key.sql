-- create_task idempotency key (#225). Additive: two nullable columns on tasks, a partial unique index and a check.
-- idempotency_key is unique per sending agent (from_agent_id) with no expiry; request_hash is the sha256 of the
-- canonical request so a reused key with another payload is a 409. Existing rows keep both columns null.
-- Roll back by dropping tasks_idempotency_key_unique, tasks_idempotency_pair_check, request_hash and idempotency_key.
ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "request_hash" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_idempotency_pair_check" CHECK (("idempotency_key" is null) = ("request_hash" is null));
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idempotency_key_unique" ON "tasks" USING btree ("from_agent_id","idempotency_key") WHERE "idempotency_key" is not null;
