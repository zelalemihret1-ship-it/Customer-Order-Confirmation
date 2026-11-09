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
