## v184 — Move: choose "Readymade product" or "New product (order)"
- In Customer ID → **Move ➜** a selector asks **"What is this customer ordering?"**: **🛋 Readymade product** or **🆕 New product (order)**.
- **Readymade** → pick the product(s) and press **🔴 Send to Sold Out group**: the card (product + customer info) goes **straight to the Sold Out group** (not to the customer), with **no prepared-confirmation step**; the product becomes Sold Out and the customer's info updates.
- **New product** → unchanged: the prepared **Order confirmation**, sent to the workshop only after the customer confirms.
- File: `public/callers.html`.

