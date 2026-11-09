# Ambar Furniture Telegram Mini App

This version fixes product-photo delivery and sends the order as a native Telegram photo card:
- Product photo is uploaded as file bytes directly to Telegram (no localhost/public URL dependency).
- Order details appear as the photo caption.
- Confirm / Reject / Comment buttons are attached to the photo card.
- Delivery goes only to the customer's Telegram private chat ID. It no longer silently falls back to the admin chat.
- Admin notifications for customer comments can still go to `ADMIN_CHAT_ID`.

## Important Telegram limitation

This app uses the Telegram **Bot API**. The sender shown to the customer is the bot, not the administrator's personal Telegram account. A bot cannot initiate a private conversation by `@username` or phone number. The customer must open the bot and press **Start** first; then obtain that customer's numeric Telegram chat ID and enter it in the form.

Sending from an administrator's personal account instead of the bot requires a separately authenticated Telegram user/Business integration. A normal bot token cannot send as a personal account. Do not put a personal account session or credentials in this app.

## Setup

1. Install Node.js 18 or newer.
2. Run `npm install`, then `npm start`.
3. Configure these server environment variables:
   - `BOT_TOKEN` — token from BotFather.
   - `ADMIN_CHAT_ID` — optional; receives customer comment notifications only.
4. Host the app over HTTPS and set your Telegram Mini App URL.
5. Set the b
