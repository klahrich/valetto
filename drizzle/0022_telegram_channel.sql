-- Telegram channel (lib/telegram.ts). Additive: new tables, and one more allowed agents.role value.
-- telegram_sender is the hidden keyless `telegram` agent that bound Telegram chats message an agent as, one per workspace.
-- Roll back by dropping telegram_messages, telegram_updates, telegram_pending, telegram_sent, telegram_chats, telegram_links and agents_one_telegram_sender,
-- deleting role = 'telegram_sender' agents (and their messages), and restoring the old agents_role_check.
ALTER TABLE "agents" DROP CONSTRAINT "agents_role_check";
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_role_check" CHECK ("role" in ('agent', 'customer_sender', 'telegram_sender'));
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_one_telegram_sender" ON "agents" USING btree ("workspace_id") WHERE "role" = 'telegram_sender' and "revoked_at" is null;
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"code_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_code_hash_unique" ON "telegram_links" USING btree ("code_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_one_active_per_agent" ON "telegram_links" USING btree ("agent_id") WHERE "revoked_at" is null;
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"chat_id" bigint NOT NULL,
	"agent_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"chat_type" text NOT NULL,
	"telegram_user_id" bigint,
	"display_name" text,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "telegram_chats_chat_id_agent_id_pk" PRIMARY KEY("chat_id","agent_id"),
	CONSTRAINT "telegram_chats_chat_type_check" CHECK ("chat_type" in ('private', 'group'))
);
--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_link_id_telegram_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."telegram_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "telegram_chats_agent_idx" ON "telegram_chats" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX "telegram_chats_link_idx" ON "telegram_chats" USING btree ("link_id");
--> statement-breakpoint
CREATE TABLE "telegram_sent" (
	"chat_id" bigint NOT NULL,
	"telegram_message_id" bigint NOT NULL,
	"agent_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_sent_chat_id_telegram_message_id_pk" PRIMARY KEY("chat_id","telegram_message_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_sent" ADD CONSTRAINT "telegram_sent_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telegram_sent" ADD CONSTRAINT "telegram_sent_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "telegram_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"body" text NOT NULL,
	"telegram_user_id" bigint,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_pending_chat_idx" ON "telegram_pending" USING btree ("chat_id","created_at");
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_updates_received_idx" ON "telegram_updates" USING btree ("received_at");
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"direction" text NOT NULL,
	"telegram_user_id" bigint,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_messages_direction_check" CHECK ("direction" in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "telegram_messages_chat_idx" ON "telegram_messages" USING btree ("chat_id","created_at");
