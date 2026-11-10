# AMBAR Furniture Telegram Mini App

## Telegram message delivery — BOT_TOKEN only

This build sends all order cards and admin notifications using the official Telegram Bot API and `BOT_TOKEN`. It does **not** require `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`, personal Telegram login, or a Telegram Business connection. Both the main owner and assigned admins can submit orders; messages are sent by the AMBAR bot.

### Important Telegram rule

A bot cannot start a private conversation with a person just from their username or phone number. The customer must open the AMBAR bot and press **Start** first. The bot webhook then remembers that customer's numeric chat ID. The owner and each assigned admin must also press **Start** in the bot if they want a private copy of the order card. You can configure `ADMIN_CHAT_ID` to send a shared copy to an admin group/channel; add the bot to that group and allow it to post.

If the customer has not started the bot, the order is still saved and a copy is sent to the submitting admin and/or `ADMIN_CHAT_ID` when reachable. The app clearly reports that customer delivery is pending.

## Render deployment

1. Put the contents of this ZIP at the root of your GitHub repository (`package.json` and `server.js` must be at the root).
2. Use a Render Web Service with Node. Build command: `npm install`. Start command: `npm start`. Health check: `/healthz`. Node 20 or newer is required.
3. Configure these Render environment variables:
   - `BOT_TOKEN` — required Telegram bot token from @BotFather.
   - `BOT_USERNAME` — optional bot username without `@`, used to build a customer Start link.
   - `MAIN_ADMIN_TELEGRAM_ID` — the owner's numeric Telegram user ID.
   - `ADMIN_SETUP_KEY` — long secret for owner setup access where applicable.
   - `ADMIN_CHAT_ID` — optional shared admin group/chat ID for order copies.
   - `PUBLIC_BASE_URL` — optional; Render's `RENDER_EXTERNAL_URL` is used automatically if this is blank.
   - `TELEGRAM_WEBHOOK_SECRET` — optional webhook verification secret.
   - Supabase variables below, if using persistent order/image storage.
4. Deploy. The server configures the Telegram webhook automatically and handles normal `message` and `callback_query` updates.
5. Open the AMBAR bot and press **Start** from the owner account and each assigned admin account. Customers must also press **Start** before direct customer delivery is possible.
6. Open the Mini App from Telegram. The owner assigns admins using their numeric Telegram IDs in **Manage Assigned Admins**.

## Supabase

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=order-images`. Run the supplied `supabase.sql` in the Supabase SQL Editor. Keep the service-role key only in Render, never in frontend code or GitHub.

## Access rules

Only `MAIN_ADMIN_TELEGRAM_ID` / `OWNER_TELEGRAM_IDS` and admins assigned by the owner can use the protected app APIs. Each admin opens the Mini App using their own Telegram account. Admin identity authenticates app access only; it is not used as the message sender.

## Delivery behavior

- The customer receives an order card from the AMBAR bot if their bot chat is known and they have started the bot.
- The submitting owner/admin receives a copy from the bot if they have started it.
- `ADMIN_CHAT_ID` receives a shared admin copy if configured and the bot has permission to post there.
- Admin copies include Confirm and Reject controls. Customer copies do not include admin controls.
- Confirming/rejecting an order updates the status and sends a status notification to the customer when the customer chat is reachable.

## Runtime

Node.js 20+. The service uses built-in `fetch`, `FormData`, and `Blob`. Uploaded files on ephemeral hosting may not survive restarts unless Supabase storage or persistent disk is configured.
