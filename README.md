# AMBAR Furniture Telegram Mini App

## Telegram message delivery — BOT_TOKEN only

This build sends order cards ONLY to admin destinations using the official Telegram Bot API and `BOT_TOKEN`. It never sends order cards to customers. Each order card is sent to the submitting admin, all configured main-owner IDs, and optional `ADMIN_CHAT_ID`. It does **not** require `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, personal Telegram login, or a Telegram Business connection.

### Important Telegram rule

A bot cannot start a private conversation with a person just from their username or phone number. The main owner and each assigned admin who should receive private order-card copies must open the AMBAR bot and press **Start** first. The bot webhook then knows each admin chat ID. You can configure `ADMIN_CHAT_ID` to send a shared copy to an admin group/channel; add the bot to that group and allow it to post.

Customer bot delivery is disabled by design. If an admin has not started the bot, the order is still saved and the app reports which admin notification could not be delivered.

## Render deployment

1. Put the contents of this ZIP at the root of your GitHub repository (`package.json` and `server.js` must be at the root).
2. Use a Render Web Service with Node. Build command: `npm install`. Start command: `npm start`. Health check: `/healthz`. Node 20 or newer is required.
3. Configure these Render environment variables:
   - `BOT_TOKEN` — required Telegram bot token from @BotFather.
   - `BOT_USERNAME` — optional bot username without `@`, used to build a customer Start link.
   - `MAIN_ADMIN_TELEGRAM_ID` — the owner's numeric Telegram user ID.
   - `ADMIN_SETUP_KEY` — long secret for owner setup access where applicable.
   - `ADMIN_CHAT_ID` — optional shared admin group/chat ID for order copies. Main owner private copies are sent to `MAIN_ADMIN_TELEGRAM_ID` / `OWNER_TELEGRAM_IDS`.
   - `PUBLIC_BASE_URL` — optional; Render's `RENDER_EXTERNAL_URL` is used automatically if this is blank.
   - `TELEGRAM_WEBHOOK_SECRET` — optional webhook verification secret.
   - Supabase variables below, if using persistent order/image storage.
4. Deploy. The server configures the Telegram webhook automatically and handles normal `message` and `callback_query` updates.
5. Open the AMBAR bot and press **Start** from the owner account and each assigned admin account. Customers do not need to press Start because order cards are not sent to customers.
6. Open the Mini App from Telegram. The owner assigns admins using their numeric Telegram IDs in **Manage Assigned Admins**.

## Supabase

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=order-images`. Run the supplied `supabase.sql` in the Supabase SQL Editor. Keep the service-role key only in Render, never in frontend code or GitHub.

## Access rules

Only `MAIN_ADMIN_TELEGRAM_ID` / `OWNER_TELEGRAM_IDS` and admins assigned by the owner can use the protected app APIs. Each admin opens the Mini App using their own Telegram account. Admin identity authenticates app access only; it is not used as the message sender.

## Delivery behavior

- Order cards are sent only to the configured main owner ID(s), the submitting admin, and optional `ADMIN_CHAT_ID`.
- The customer never receives an order card from the bot.
- Admin copies include Confirm and Reject controls.
- The order remains saved even if one or more admin destinations cannot be reached. The response reports which admin IDs failed so they can open the bot and press Start.
- Confirming/rejecting an order updates the order status. Customer order-card delivery is disabled.

## Runtime

Node.js 20+. The service uses built-in `fetch`, `FormData`, and `Blob`. Uploaded files on ephemeral hosting may not survive restarts unless Supabase storage or persistent disk is configured.
