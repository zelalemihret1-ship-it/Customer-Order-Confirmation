Ambar Furniture — v41 Always-Visible Answer Link
This version changes the customer delivery path so the answer URL is written directly into the same photo caption as the order card on the first send.
Button/link text:
🔗 መልስ ለመስጠት ክፈት
The HTTPS answer URL is also printed directly underneath it. Telegram clients can open the URL immediately without waiting for another customer message, inline-result refresh, callback query, or webhook edit.
Important Telegram limitation
A Telegram bot cannot start a private conversation with a user who has never opened/started the bot. Telegram Business connected bots are also restricted to eligible private chats with incoming messages in the last 24 hours. No code can bypass those Telegram rules.
For customers who already receive the card from the connected admin account, this version does not wait for a later customer message to add the answer URL: the URL is present in the original caption.
Deploy the ZIP to Render and restart the service.
