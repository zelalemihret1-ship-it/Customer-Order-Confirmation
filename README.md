# Ambar Furniture Telegram Mini App — Admin-account photo delivery

This project includes the photo picker, browser-generated PNG order card, and Telegram Business delivery that sends the generated image **as the connected admin/business account**, not as the bot.

## Requirements
- Node.js 18 or newer
- A Telegram bot created with @BotFather
- A Telegram Business account for the admin (Telegram Premium / Business features as applicable)
- A public HTTPS server for the webhook and Mini App

## Install and run
```bash
npm install
BOT_TOKEN="YOUR_BOT_TOKEN" npm start
```
Keep the bot token on the server only. Never put it in browser JavaScript.

## Required Telegram Business setup
1. In @BotFather, make sure the bot supports connecting to Telegram Business (`/mybots` → select the bot → Bot Settings → Business, where available).
2. In the administrator's Telegram app, open **Settings → Telegram Business → Chatbots** (wording may vary), add/select this bot, and authorize it to reply to customer chats. The connection must grant the `can_reply` right.
3. Set the bot webhook to `https://YOUR_DOMAIN/api/telegram/webhook`. Include these update types: `business_connection`, `business_message`, and `callback_query`. Example:
```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_DOMAIN/api/telegram/webhook" \
  -d 'allowed_updates=["message","callback_query","business_connection","business_message","edited_business_message"]'
```
4. Optional but recommended: set `TELEGRAM_WEBHOOK_SECRET` on the server and pass the same value as `secret_token` to `setWebhook`.
5. Open `https://YOUR_DOMAIN/api/business/status`. It should return `connected: true` and `canReply: true` after the admin has connected the bot.
6. The admin's business account must already have a private conversation with the customer, and Telegram's business reply permission/time-window rules must allow the message. Enter the customer's numeric private chat ID as known to the business connection.
7. Select the furniture photo and submit. The browser generates a PNG card with the product photo and order details. The server uploads that PNG using Telegram `sendPhoto` with `business_connection_id`.

## Important behavior
- The app deliberately **does not fall back to sending from the bot**. If no authorized Telegram Business connection exists, order submission returns a clear error instead of delivering from the bot.
- Telegram Business only lets a connected bot act within the chats and permissions granted by the account owner. It cannot initiate an arbitrary private chat with a person who has never contacted the admin account, and Telegram may limit replies to chats with recent customer activity.
- A normal bot token cannot impersonate a personal account. The connected Telegram Business feature is the supported route for sending as the admin/business account.
- Order records and business connection state are in memory in this starter project; use a database for production persistence.
