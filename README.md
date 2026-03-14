# EnosIII Bot — Vercel + Supabase Setup Guide

## Project Structure
```
enosiii-bot/
├── api/
│   └── webhook.js          ← Main bot logic (Vercel serverless function)
├── lib/
│   ├── db.js               ← Supabase database helpers
│   ├── telegram.js         ← Telegram API helpers
│   ├── openrouter.js       ← OpenRouter AI API caller
│   └── personalities.js    ← All 7 AI personalities
├── supabase_setup.sql      ← Run this in Supabase SQL Editor
├── package.json
├── vercel.json
└── .gitignore
```

---

## STEP 1 — Set up Supabase

1. Go to https://supabase.com and log in (or create a free account)
2. Click **New Project**, give it a name (e.g. `enosiii-bot`), set a database password, click **Create**
3. Wait for the project to finish provisioning (~1 minute)
4. Go to **SQL Editor** (left sidebar)
5. Click **New Query**
6. Copy the entire contents of `supabase_setup.sql` and paste it in
7. Click **Run**
8. You should see: tables created successfully

**Get your Supabase credentials:**
- Go to **Settings → API**
- Copy your **Project URL** (looks like `https://xxxx.supabase.co`)
- Copy your **service_role** key (under "Project API keys" — use service_role, NOT anon)

---

## STEP 2 — Create GitHub Repository

1. Go to https://github.com and log in
2. Click **New repository**
3. Name it `enosiii-bot` (or anything you like)
4. Set to **Private**
5. Do NOT add README or .gitignore (we already have them)
6. Click **Create repository**
7. Copy the repo URL (e.g. `https://github.com/yourusername/enosiii-bot.git`)

---

## STEP 3 — Push code to GitHub

Open a terminal/command prompt on your PC:

```bash
# Navigate into the project folder
cd enosiii-bot

# Initialize git
git init
git add .
git commit -m "Initial commit"

# Connect to your GitHub repo (replace URL with yours)
git remote add origin https://github.com/yourusername/enosiii-bot.git
git branch -M main
git push -u origin main
```

---

## STEP 4 — Deploy to Vercel

1. Go to https://vercel.com and log in
2. Click **Add New → Project**
3. Click **Import Git Repository**
4. Select your `enosiii-bot` repo
5. Click **Import**
6. On the configuration page — leave everything as default
7. Click **Deploy**
8. Wait for the deployment to finish
9. Copy your deployment URL (e.g. `https://enosiii-bot.vercel.app`)

---

## STEP 5 — Add Environment Variables in Vercel

1. In your Vercel project, go to **Settings → Environment Variables**
2. Add these one by one:

| Name | Value |
|------|-------|
| `BOT_TOKEN` | `yout TG bot token` |
| `BOT_PASSWORD` | your TG Bot PW |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service_role key |

3. After adding all variables, go to **Deployments** and click **Redeploy** (so the variables take effect)

---

## STEP 6 — Register Telegram Webhook

Open your browser and go to this URL (replace with your actual values):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://enosiii-bot.vercel.app/webhook
```

Example:
```
https://api.telegram.org/botyourTGbottoken/setWebhook?url=https://enosiii-bot.vercel.app/webhook
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

---

## STEP 7 — Verify Webhook

Check webhook status:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

It should show your Vercel URL with `pending_update_count: 0` and NO `last_error_message`.

---

## STEP 8 — Test the Bot

1. Open Telegram and message your bot
2. Send `/start`
3. Enter the password: `yourTGbotPW`
4. Send `/help` to see all commands
5. Chat away — responses should be instant!

---

## Troubleshooting

**Bot not responding?**
- Check Vercel **Functions** logs in your dashboard
- Check the webhook info for error messages
- Make sure all 4 environment variables are set correctly

**Supabase errors?**
- Make sure you used the `service_role` key, NOT the `anon` key
- Make sure RLS is disabled (the SQL script does this automatically)

**Want to update the bot later?**
- Edit the code locally
- `git add . && git commit -m "update" && git push`
- Vercel auto-deploys on every push — no manual steps needed
