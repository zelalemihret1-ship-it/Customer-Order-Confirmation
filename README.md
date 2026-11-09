# Ambar Furniture Telegram Mini App — deployment package

This archive is arranged with `package.json` and `server.js` at the project root for deployment platforms.

## Deploy on Render

1. Extract this ZIP and upload the **contents** to a new GitHub repository (the `package.json` must be at the repository root).
2. In Render, choose **New → Web Service** and connect that repository.
3. Render detects `render.yaml`. If entering settings manually, use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/healthz`
4. Add environment variables in Render:
   - `BOT_TOKEN` = your Telegram bot token (keep it secret)
   - `ADMIN_CHAT_ID` = optional admin chat ID for comment notifications
   - `TELEGRAM_WEBHOOK_SECRET` = optional long random secret used to verify Telegram webhook requests
5. Deploy. The service must finish with a healthy `/healthz` response.
6. Set the Telegram webhook to `https://YOUR-RENDER-DOMAIN/api/telegram/webhook`. Include `business_connection`, `business_message`, `callback_query`, and `message` in `allowed_updates`.
7. Connect the bot from the administrator's Telegram Business settings and grant permission to reply to customer chats. The Business connection update must reach the webhook. The app intentionally refuses to send from the bot account if no authorized Business connection is active.

## Deploy on Railway / other Node hosts

- Put these files at the repository root.
- Build command: `npm install`
- Start command: `npm start`
- Use the host-provided `PORT`; the server binds to `0.0.0.0`.
- Set `BOT_TOKEN`; set the other variables if needed.

## Runtime requirements

- Node.js 20 or newer.
- The server uses built-in `fetch`, `FormData`, and `Blob`.
- No frontend build step is required; the Mini App is served from `public/index.html`.

## Important deployment notes

- The in-memory order list and Business connection cache reset when the server restarts or redeploys. For production, use a database and persist the Business connection state.
- Local uploaded files may be ephemeral on free hosting plans. Use persistent storage for production order images.
- The customer must be reachable in the administrator's connected Telegram Business account, and the connected bot must have `can_reply` permission. The card is sent as a generated PNG using the Business connection, not as a text-only order.


## Ambar Business + PC photo fixes

This version fixes the Telegram Business connection workflow and desktop photo picker.

### Required Render environment variables

- `BOT_TOKEN` — Telegram bot token
- `ADMIN_CHAT_ID` — administrator chat ID for comment notifications (optional)
- `TELEGRAM_WEBHOOK_SECRET` — secret used to protect the webhook
- `PUBLIC_BASE_URL` — the public HTTPS URL of this Render service. Render also provides `RENDER_EXTERNAL_URL`; if `PUBLIC_BASE_URL` is blank, the app uses that value automatically.
- `ADMIN_BUSINESS_CONNECTION_ID` — optional. Normally leave blank; the app learns and stores the connection ID from `business_connection` and `business_message` webhook updates.

On startup the server configures the Telegram webhook with:
`message`, `callback_query`, `business_connection`, and `business_message`.

### Telegram Business connection

In the administrator Telegram account:
Settings → Telegram Business → Chatbots → select this bot → allow it to reply.

Then reload the Mini App. The backend stores the Business connection and validates `can_reply`. Generated PNG cards are sent with Telegram's `business_connection_id`, so the sender is the connected administrator/business account rather than the bot.

Important Telegram limitation: Telegram does not provide a public API method to list all Business connections. If a previously-connected account is deployed with a completely new server and no saved connection ID, the first `business_connection` or `business_message` update is needed for the server to learn the connection ID. The optional `ADMIN_BUSINESS_CONNECTION_ID` environment variable can be used when that ID is already known.

### Delivery type

The order form now has two delivery choices:
- Self Pick Up
- By Ambar Delivery

The delivery fee field is shown only for By Ambar Delivery, and the selected delivery type is included in the preview and generated PNG order card.

### PC photo picker

The product photo field now supports JPG/JPEG/PNG/WebP, a visible Choose Photo from PC button, drag-and-drop, validation, preview, and PNG card generation from the selected original file.

### Deployment

Build: `npm install`
Start: `npm start`
Health check: `/healthz`

## IMPORTANT: Telegram Business connection

The bot must be Business/Secretary Mode enabled in @BotFather before an administrator can connect it to Telegram Business. The app now checks `getMe.can_connect_to_business` and reports the exact problem in the dashboard.

After enabling Business/Secretary Mode:
1. Deploy the app.
2. In the administrator Telegram account, open Settings → Telegram Business → Chatbots.
3. Connect this bot and grant Reply to messages.
4. Send a message from a customer chat managed by the business account.
5. Open the Mini App and press Refresh Business connection.

The server captures the `business_connection_id` from Telegram's `business_connection` / `business_message` updates and uses that ID for `sendPhoto`.
