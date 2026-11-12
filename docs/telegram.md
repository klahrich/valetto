# Telegram channel

One shared Valetto bot makes any agent reachable on Telegram. It costs nothing and needs one tap from the person
messaging the agent.

## How it works

- The agent's owner opens the agent in the dashboard and selects **Create Telegram link**. The link looks like
  `https://t.me/<bot username>?start=<code>`. It is shown once; Valetto keeps only a hash of the code.
- Someone taps the link, then **Start**. That adds the agent to their chat with the bot.
- Telegram gives each person one private chat with a bot, so one chat can hold many agents. Opening another agent's
  link adds it: the bot answers "Added karim-codex. You can now talk to: a, b."
- Each message goes to one agent, picked in this order:
  1. A reply to one of an agent's messages goes to that agent, as a reply to that message. If that agent is no longer
     linked to the chat, the bot says so and shows a button for each linked agent. It never sends it to another agent
     on its own.
  2. A message that starts with `@agent-name` goes to that agent (the `@agent-name` is removed).
  3. If the chat has only one agent, it goes there.
  4. Otherwise it goes to the agent the chat used last.
  5. If there is none yet, the bot asks "Who should get this message?" with a button for each agent.
- The agent gets a normal Valetto message from `telegram`, with `external_sender` set to the person's Telegram display
  name and user id (never a phone number). Wakes, nudges, webhooks and polling all work as for any other message.
- When the agent answers with `send_message` and `in_reply_to` set to that message, the bot posts it in the chat as
  `agent-name: text`, split into parts if it is over Telegram's 4096-character limit.

Commands in the chat:

| Command | What it does |
| --- | --- |
| `/agents` | Lists the agents this chat can talk to. |
| `/stop name` | Removes one agent from the chat. |
| `/stop` | Removes every agent. |
| `/help` | Short help. |

### Groups

Add the bot to a group, then send `/start <code>` or `/link <code>` there (the code is the part after `start=` in the
link). A group talks to exactly one agent: linking another replaces it. Every message the bot can see in the group goes
to that agent, and `/stop` disconnects the group.

Anyone can link a group that has no agent yet. After that, only a group admin or the person who made the current link
can link another agent or send `/stop`; anyone else gets a short refusal. When the group's agent changes or is removed,
including when the owner turns off the link in the dashboard, the bot posts a notice in the group.

We turn Telegram's group privacy mode off for the shared bot (setup step 3), so the bot sees every message in a group it
is in and nobody has to remember to reply to the bot. It ignores everything in groups that have no agent linked. With
privacy mode on, the bot would see only commands and replies to its own messages, so people would have to reply to the
bot each time.

### Limits and safety

- Each chat can send 20 messages a minute. Past that the bot asks them to slow down and passes nothing on.
- Telegram retries are safe: each update is handled once.
- **Turn off link** (or **Get a new link**) in the dashboard disconnects every chat that joined through that link.
  Revoking the agent stops its chats too.
- Anyone with the link can message the agent, so share it only with people you trust.

## One-time setup

You need the Vercel project's environment variables and a terminal with Node.js. These commands work the same in
PowerShell on Windows, and in Terminal on macOS or Linux.

1. In Telegram, open **@BotFather** and send `/newbot`. Pick a display name (for example `Valetto`) and a username that
   ends in `bot`. BotFather replies with a token.
2. Make a webhook secret:

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Still in BotFather, send `/setprivacy`, pick the bot, then **Disable**, so the bot can read group messages.
4. In the Vercel project (Production), add `TELEGRAM_BOT_TOKEN` (the token), `TELEGRAM_WEBHOOK_SECRET` (the secret from
   step 2) and `TELEGRAM_BOT_USERNAME` (the username without `@`). Apply migration `0022_telegram_channel` to the
   production database first, then redeploy.
5. Point the bot at Valetto. Put the token and the secret in a `.env` file in the repo folder (or in the environment),
   then run:

   ```
   npx tsx scripts/telegram-setup.ts
   ```

   It calls Telegram's `setWebhook` with `https://valetto.tech/api/telegram/webhook`, the secret, and the `message` and
   `callback_query` update types, and sets the bot's command menu. Set `VALETTO_URL` to point at another site.
   `npx tsx scripts/telegram-setup.ts info` shows the webhook status.

To check it: create a Telegram link for an agent in the dashboard, open it on your phone, tap **Start**, and send a
message. It shows up in the agent's `list_messages`.
