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


## Sending cards from the admins' own accounts (no bot)
Set `TG_API_ID` and `TG_API_HASH` in Render (from https://my.telegram.org). Then:
- **Main admin:** open the Mini App from Telegram, tap **🔗 Connect my Telegram account**, enter your phone, the code (and 2-step password). Orders you create are sent to the customer from YOUR account.
- **Assigned admins:** do the same with their own phone. Their orders are sent from THEIR OWN account, never the main admin's.
The bot sends no order cards. Fill the customer's @username or phone in the form. Customers answer CONFIRM / REJECT / a comment; the reply is handled on the sending account.

## v35 changes
- Confirm / Reject / Comment buttons are always visible. After an answer they stay on screen but locked (🔒; the chosen one shows ✅ Confirmed or ❌ Rejected). On the answer web page they are disabled.
- The Order code is typed by the admin (required); it is no longer auto-generated.
- Every order message now carries a tappable answer link (and a "Open answer page" button on bot messages) so Confirm / Reject / Comment is reachable even when Telegram does not draw the inline buttons. Requires PUBLIC_BASE_URL (https).

## v16 behaviour
- Main admin can create orders WITHOUT connecting a personal account (sent via Telegram Business with Confirm / Reject / Comment buttons to customers who messaged the main admin account). Connecting an account additionally reaches any customer by @username/phone.
- Assigned admins must connect their own account (button disappears once connected); unlimited admins can be assigned, many at once (one "id name" per line).
- Cards from personal accounts are sent as a PHOTO plus a tappable Confirm/Reject poll; customers can also reply CONFIRM / REJECT / a comment.

## Cross-check copies (v19)
Every card an admin sends is also posted by the AMBAR bot (photo + who created it, which account sent it, delivered or not) to: ADMIN_CHAT_ID, the main admin ID(s) in MAIN_ADMIN_TELEGRAM_ID / OWNER_TELEGRAM_IDS, and the admin who created the order. When the customer confirms, rejects or comments, that copy's caption updates and a short message is sent to the same chats. Each of those people must open the AMBAR bot once and press Start. Customers never receive anything from the bot.


## Tappable Confirm / Reject / Comment buttons for every customer

Buttons reach customers without them pressing Start: the sending admin's account posts an inline message "via @YourBot". One-time setup: in @BotFather send `/setinline`, pick the bot, and enter any placeholder text. Without it the app falls back to the bot chat (customer must press Start), then to a poll.

## Answer link (works for every customer, no Start, no inline mode)

Every order message also carries a link `PUBLIC_BASE_URL/o/<token>`. It opens a page with the card and big Confirm / Reject / Comment buttons. Answers update the order and notify the admins. `PUBLIC_BASE_URL` must be your https site address.

## v38 — three buttons visible immediately
- The inline card contains exactly three action buttons — Confirm, Reject, Comment — in the initial `answerInlineQuery` result, and the bot immediately reapplies the same three buttons on `chosen_inline_result` so they appear without waiting for a customer message.
- **One-time BotFather setup (required for this):** send `/setinlinefeedback` → pick the bot → choose **100%**. (`/setinline` must also be on.) Redeploy; the webhook updates itself.
- Once the customer answers, the buttons stay but are locked (🔒 / ✅ Confirmed / ❌ Rejected), the answer-page link is removed from the message, and the web page buttons are disabled.
