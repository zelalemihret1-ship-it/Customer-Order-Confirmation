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

## FINAL FIX NOTES
- Photo selection is now ONE button and works with phone and PC. On mobile it can open the camera/photo chooser; on desktop it opens the file picker.
- Telegram webhook setup clears the previous webhook before installing the current Business-enabled webhook.
- Business connection webhook requests are no longer rejected just because an old/mismatched optional webhook secret is present. A correctly supplied secret is still accepted and mismatches are rejected.
- Business connections are stored under BUSINESS_STORE_DIR. For Render persistent storage, set BUSINESS_STORE_DIR=/var/data and attach a persistent disk mounted at /var/data. Without a persistent disk, Telegram can still re-send the connection through business_connection/business_message, but the connection is not guaranteed across every instance replacement.
- IMPORTANT: Telegram Business mode must be enabled for the bot in @BotFather, and the bot must be connected under the administrator's Telegram Business -> Chatbots with Reply to messages permission.
- After deployment, open /api/business/diagnostics if the dashboard still says Not connected. It shows whether Telegram is delivering Business updates and any webhook error.

## Supabase database + image storage (recommended)

This build supports Supabase for persistent order records, comments, order statuses, Telegram Business connection state, product photos, and generated PNG cards. If Supabase variables are not configured, the app falls back to its previous local/in-memory behavior; local files and in-memory orders are not durable on ephemeral hosting.

### 1. Create the Supabase project

1. Create a project at https://supabase.com/dashboard.
2. Open **Project Settings → API**.
3. Copy the **Project URL** and the **service_role** secret key (not the anon key).
4. In **SQL Editor**, create a new query, paste the complete contents of `supabase.sql`, and run it. This creates the `orders` and `app_settings` tables and the public `order-images` Storage bucket.

### 2. Configure Render

Add these environment variables under your Render service → Environment:

- `SUPABASE_URL` = your Supabase Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service_role secret key
- `SUPABASE_STORAGE_BUCKET` = `order-images`
- Keep the existing Telegram variables: `BOT_TOKEN`, `ADMIN_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, and `PUBLIC_BASE_URL`.

Never put `SUPABASE_SERVICE_ROLE_KEY` in `public/index.html`, frontend JavaScript, GitHub, or any browser-visible setting. It belongs only in the server environment. Redeploy after saving the variables.

### 3. Confirm it works

- Open `https://YOUR-RENDER-DOMAIN/healthz`; it should return `{"ok":true,...}`.
- Submit a test order with both photos selected. The app sends the generated PNG through the connected Telegram Business account and saves the order and images in Supabase.
- In Supabase → Table Editor → `orders`, confirm the order row appears.
- In Supabase → Storage → `order-images`, confirm `products/` and `cards/` files appear.
- Restart/redeploy the Render service and reload the order dashboard; orders and Business connection state are restored from Supabase.

### Security notes

- Keep the service-role key private. It bypasses Row Level Security and is used only by `server.js`.
- The SQL enables Row Level Security on the tables and deliberately creates no public table policies. Browser clients should not query these tables directly.
- The Storage bucket is public-read so saved image URLs can be viewed; uploads are performed by the trusted server with the service-role key.
- The existing app's admin/dashboard authorization should still be protected separately before exposing admin routes publicly. Supabase persistence does not itself authenticate dashboard users.

## Telegram connection fixes (latest)

- Telegram logic moved to `telegram.js` (timeouts, retries on 429/5xx, friendly error messages).
- Webhook secret is normalised: a `TELEGRAM_WEBHOOK_SECRET` containing characters Telegram rejects no longer silently breaks `setWebhook`.
- Webhook is installed with `setWebhook` only (no `deleteWebhook` gap), retried on startup, and re-installed automatically if the dashboard status check finds Telegram pointing elsewhere.
- Webhook answers Telegram immediately (200) and processes afterwards, so slow work never causes retries/disabling.
- Supports both Business API shapes (`rights.can_reply` and top-level `can_reply`).
- A temporary Telegram error no longer makes a valid connection show as "Not connected"; connections are saved to disk and Supabase, and restore merges instead of wiping.
- Admin's own messages are no longer logged as customer comments; BOT_TOKEN with quotes/spaces is cleaned; `PUBLIC_BASE_URL` must be https.
- Dashboard shows the real Telegram error (bad token, etc.) instead of "Business Mode NOT enabled".


## Send to ANY customer from the admin account (optional)

1. Go to https://my.telegram.org → API development tools → create an app; copy `api_id` and `api_hash`.
2. On your computer: `npm install`, then `TG_API_ID=... TG_API_HASH=... npm run session`. Log in as the admin account; copy the printed `TG_SESSION`.
3. In Render set `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`. Redeploy.
4. In the form, fill the customer's **@username** or **phone** (the numeric ID is not needed).

Order of delivery: Telegram Business (buttons) → admin user account (customer replies CONFIRM / REJECT / comment) → copy to admin chat.
Keep volume low and only message real customers; Telegram can limit or ban accounts that send unsolicited bulk messages.


### Easier: log in from the app (no computer commands)
Set `TG_API_ID`, `TG_API_HASH` and `ADMIN_SETUP_KEY` (any long secret) in Render, redeploy, then open `https://YOUR-APP.onrender.com/setup.html`:
check status → Send code → enter the code (and 2-step password) → Verify → send a test message. The login is stored in Supabase.


### Several admins
Open `/setup.html` and repeat step 2 for each admin (give each a name, enter that admin's phone, then the code they receive). In the order form, choose **Send from admin account**; the card is sent from that admin, and customer replies (CONFIRM / REJECT / comments) are handled on that same admin account.


### Assigning admins who can use the app
Open `/setup.html` → **5. Assign people**. Add each person's numeric Telegram ID and name (optionally the sending admin account they use). Once someone is assigned, only assigned admins (and the owner) can use the app. Unassigned people see their own Telegram ID so they can send it to you. The owner is whoever holds `ADMIN_SETUP_KEY` (enter it on the lock screen) or is listed in `OWNER_TELEGRAM_IDS`.
