# Ambar Furniture Telegram Order Card

## What this version actually sends
- Requires a product photo. The server reads the uploaded image and creates a designed PNG order card containing the photo and order details.
- Sends that generated PNG using Telegram `sendPhoto`, not a plain text order message.
- Adds Confirm / Reject / Comment inline buttons to the photo card.
- Sends to the customer's private Telegram chat ID only; it does not redirect delivery to the admin.
- Optional `ADMIN_CHAT_ID` receives customer comment notifications.

## Run / deploy
1. Use Node.js 20 or newer.
2. Run `npm install` and then `npm start`.
3. Configure `BOT_TOKEN` from BotFather. Optionally configure `ADMIN_CHAT_ID`.
4. Host over HTTPS and set the Telegram Mini App URL.
5. Set the bot webhook to `https://YOUR_DOMAIN/api/telegram/webhook`.
6. Each customer must open the bot and press Start. Enter their numeric private `telegramChatId` in the order form. A username or phone number cannot be used by the Bot API to initiate a private conversation.

## Sending as the administrator's business account
A normal bot token cannot send as a personal Telegram user account. To send as the administrator's Telegram Business account, enable Telegram Business for the account, connect this bot in Telegram Business settings, grant the required messaging permission, and set `BUSINESS_CONNECTION_ID` to the connection ID received in the bot's `business_connection` update. The code passes that ID to `sendPhoto`. Without this Business connection, the sender shown is the bot. Do not paste personal account login codes or session strings into this app.

## Important
Orders are held in memory and reset when the server restarts. Add a database, authentication, persistent uploads, and production webhook verification before public deployment.
