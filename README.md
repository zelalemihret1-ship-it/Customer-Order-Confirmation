# Ambar Furniture Telegram Mini App

This starter project provides:
- Admin order-entry Mini App
- Product photo upload
- Customer Telegram Order Card
- Confirm / Reject / Comment buttons
- Order status tracking
- Telegram webhook handling
- Customer Telegram Chat ID field for direct delivery

## Run locally

1. Install Node.js 18+.
2. Run:
   npm install
   npm start
3. Open http://localhost:3000

## Telegram setup

1. Create a Telegram bot with BotFather and set BOT_TOKEN.
2. Host this app on HTTPS.
3. Set PUBLIC_BASE_URL to the HTTPS address.
4. Configure your Telegram webhook:
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR_DOMAIN/api/telegram/webhook
5. Open the Mini App from your bot/menu button.
6. A customer must have started/interacted with the bot so the bot can identify their chat. Put their chat ID in the Customer Telegram Chat ID field.

## Production notes

For production, replace the in-memory `orders` array with PostgreSQL/Supabase/Firebase or another database, add admin authentication, validate uploaded images, and use a proper storage service for product photos. Do not expose BOT_TOKEN in frontend code.
