# AMBAR Furniture — Telegram Mini App

A Telegram Mini App (Node.js + Express) that runs the daily work of a furniture business from inside Telegram: customer orders and confirmations, customer records, workshop and stock, materials, ratings, greetings, weekly stories and Google Sheet reports.

- **Version:** 1.8.6 (see [CHANGELOG.md](CHANGELOG.md) for the full history, v77 → v184)
- **Runtime:** Node.js 20 or newer · `npm start` (`node server.js`)
- **Time zone / dates:** Africa/Addis_Ababa, Ethiopian calendar dates (`2019/03/25`) and 24-hour clock in the stock and material records. Change the zone with `SHEET_TIMEZONE`.

---

## 1. What is inside

| Home section | Page | What it does |
|---|---|---|
| Customer Order Confirmation | `/orders.html` | Create an order card (product, measurements, material, colour, handle, price…), send it to the customer in Telegram; the customer confirms or rejects with buttons. Statuses: Pending · Confirmed · Rejected · Follow-up. Archive of delivered / failed orders. |
| Customer ID | `/callers.html` | Customer records with 4-digit IDs (`0001`…), status (New Lead · Interested · Customer · Not Interested), last conversation, history, Telegram link. **Move ➜** opens the workshop / sold-out flow for that customer (section 4). |
| First Greeting | `/greeting.html` | Automatic first message to new private chats (main admin switch). |
| Customer Rating | `/rating.html` | Rating link sent after delivery; reviews list. |
| Weekly Story | `/stories.html` | Plan 7 photos / videos, one posted per day (videos are converted with ffmpeg). |
| Reports | `/reports.html` | **View only**: Workflow · Stock · Stock view · Material, with the Google Sheet backup. |
| Workshop | `/workshop.html` | Send Standard, Custom and order products to the workshop Telegram group; Sold Out group; restock. |
| Material | `/material.html` | Cut · Add · Edit materials with main-admin confirmation. |
| Stock | Home → Stock view | Every in-stock product with photo and full info (`GET /api/stock`). |
| Administration | `/setup.html` + Home | Assign admins, choose their sections, connect Telegram accounts, connect Google Sheets. |

---

## 2. People and access

**Roles**
- **Main admin (owner)** — Telegram IDs in `MAIN_ADMIN_TELEGRAM_ID` / `OWNER_TELEGRAM_IDS` (more can be promoted in the app). Sees everything, approves material requests, manages admins.
- **Assigned admin** — added by the main admin in Manage Admins; sees only the sections switched on for them.
- **View-only admin** — can look but every write request is refused by the server (`VIEW_ONLY`).

**Section switches (Manage Admins → access).** Ten keys:

| Key | Section |
|---|---|
| `orders` | Customer Order Confirmation |
| `customers` | Customer ID |
| `greeting` | First Greeting |
| `rating` | Customer Rating |
| `stories` | Weekly Story |
| `reports` | Reports |
| `workshop` | Workshop |
| `material` | Material (admins who already had Workshop keep access) |
| `stockview` | Home → Stock view (also allowed for `reports` / `workshop`) |
| `sheet` | The **Open Google Sheet** button on Home |

Admins created before `stockview` / `sheet` existed keep both until the main admin saves their access again. Defaults for a new admin: orders, customers, greeting, rating, stories, stockview, sheet.

**Telegram account connection.** An admin can connect their own Telegram account (QR login, via the `telegram` MTProto library; needs `TG_API_ID` / `TG_API_HASH`). Posts to groups then come from that admin's own account; without it the **AMBAR bot** posts (the bot must be a member/admin of the group).

---

## 3. Material (`/material.html`)

Same data and movement log as Reports → Material (which stays view-only).

- Per material: **✂️ Cut**, **➕ Add**, **✏️ Edit** (name, type, unit, low-stock alert, stock correction) and **🆕 New material**.
- **Main admin:** changes apply at once.
- **Other admins:** every Cut / Add / New / Edit becomes a request. **The stock does not change until the main admin approves.** Approved changes are logged in Reports → Material and in the Google Sheet backup under the requester's name ("Approved by …").
- **Alert:** a red, ringing 🔔 banner on Home and at the top of the Material page for the main admin (vibration on a new request, refresh every 8 s). The sender sees **⏳ Waiting confirmation**.
- **Confirmation topic:** the main admin chooses one Telegram **group + topic** (Material → ⚙️ Settings). Each waiting request is posted there by the AMBAR bot with **✅ Approve / ❌ Reject** buttons; only a main admin's press counts. The decision is posted in the same topic. Nothing is sent to private chats. If no topic is chosen, requests appear only in the app.
- **Who can Cut / Add / Edit:** in ⚙️ Settings the main admin ticks **✂️ Cut · ➕ Add · ✏️ Edit** for each admin that has Material. Buttons without a right are hidden and the server refuses them. Admins not selected yet keep all three.
- **✅ Confirmation** and **⚙️ Settings** are small bars that stay closed until tapped.

---

## 4. Workshop, Sold Out and Move

### Telegram groups (Workshop page)
Each admin chooses, once:
1. **Workshop group (+ topic)** — where products and orders for production are posted.
2. **Sold Out group (+ topic)** — where products sold from stock are posted.

The two groups sit in one small **📨 Telegram groups** bar (closed until tapped). Pick from your groups, or paste a group / topic link, `@username` or id. **Send test** checks each. Posts go from the admin's own account if connected, otherwise from the bot.

### Workshop tabs
- **📦 Standard** — shows only the products you prepared. **☰ List / ▦ Large** view. Make standard products (saved as **Stock**; IDs `CH1…` shoe shelf, `CON1…` console, `1A…` others), tick what you want, **send** to the workshop group.
- **🎨 Custom** — same List / Large view; each product has **⬆️ Move to standard**. Prepare all the info of a one-off product (photo, name, type, measurement, colour, quantity, handle, note) and send it to the group.
- **📋 Orders ↗** — opens the customer data page; orders are sent from **Move ➜** there.
- **📤 Sent** — the log of everything posted (ok / failed with the reason), showing only what was sent **from now**; **🔄 Start from now** resets the starting point (nothing is deleted).
- **🔴 Sold out** list under Standard / Custom with **♻️ Restock** (Sold Out → In Stock) on every sold product.
- Only products made in Workshop (Standard saved + Custom) are listed and sendable here; the general stock is sold through Move.

### Customer ID → Move ➜ ("What is this customer ordering?")
- **🆕 New product (order):** choose the order (rejected orders are blocked; you may send before the customer confirms), a **prepared confirmation** page shows customer, product, note and destination, then **✅ Confirm & send** posts it to the **workshop group** with the customer's info.
- **🛋 Readymade product:** **select one or several products, then press 🔴 Send** → they go to the **Sold Out group** (product + customer info; nothing goes to the customer), the product becomes **Sold Out**, and the **customer's info changes** (status → Customer, Last conversation → "Bought from stock (Sold Out): CODE-MODEL", old values kept in history, Google Sheet row updated). No confirmation step.

---

## 5. Setup

### Requirements
Node.js ≥ 20, a Telegram bot (BotFather), a public **HTTPS** URL (Render works well). Optional: Supabase (data + order images), Google Apps Script (sheets), ffmpeg (story videos; installed automatically as an optional dependency).

### Install and run
```bash
npm install
BOT_TOKEN=123:abc PUBLIC_BASE_URL=https://your-app.example.com \
MAIN_ADMIN_TELEGRAM_ID=111111111 npm start
```
On start the server sets the Telegram webhook to `PUBLIC_BASE_URL/api/telegram/webhook` (it must start with `https://`). Health check: `GET /healthz`.

### Telegram
1. Create the bot with BotFather and set `BOT_TOKEN`.
2. Set the bot's **menu button / Mini App** URL to `PUBLIC_BASE_URL` (open it from the bot's menu button — a normal browser tab has no Telegram identity).
3. Add the bot to every group you use (workshop group, Sold Out group, material confirmation group) and make it admin where it must post in topics.
4. Add your numeric Telegram ID to `MAIN_ADMIN_TELEGRAM_ID` (or `OWNER_TELEGRAM_IDS`), then assign other admins in the app.

### Environment variables
| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token (required) |
| `BOT_USERNAME` | Bot username (optional; otherwise detected) |
| `PUBLIC_BASE_URL` / `RENDER_EXTERNAL_URL` | Public HTTPS URL used for the webhook |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret checked on webhook calls |
| `TELEGRAM_API_BASE` | Alternative Bot API base URL (default `https://api.telegram.org`) |
| `MAIN_ADMIN_TELEGRAM_ID`, `OWNER_TELEGRAM_IDS` | Main admin Telegram ID(s) |
| `ADMIN_TELEGRAM_ID(S)`, `ADMIN_CHAT_ID` | Older admin settings, still read |
| `ADMIN_SETUP_KEY` | Optional key protecting setup actions |
| `ADMIN_BUSINESS_CONNECTION_ID` | Telegram Business connection used to send as the business account |
| `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` | Telegram MTProto app (admin account connection); `TG_SESSION` = legacy session |
| `PORT` | HTTP port |
| `BUSINESS_STORE_DIR` | Folder for the JSON data files (default `./data`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Optional persistent storage (`app_settings`, `orders`) |
| `SUPABASE_STORAGE_BUCKET` | Order image bucket (default `order-images`) |
| `GOOGLE_SHEET_URL`, `GOOGLE_SHEET_ID`, `GOOGLE_FORM_URL` | Google Sheet / form links |
| `GOOGLE_SCRIPT_URL`, `GOOGLE_SCRIPT_KEY` | Orders + customers Apps Script (`google-sheet-script.gs`) |
| `REPORTS_SCRIPT_URL`, `REPORTS_SCRIPT_KEY` | Reports backup Apps Script (`reports-sheet-script.gs`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Optional service-account access |
| `SHEET_TIMEZONE` | Default `Africa/Addis_Ababa` |
| `STORY_BOT_MESSAGES` | `1` = the bot also sends story messages |
| `FFMPEG_PATH` | Use a specific ffmpeg binary |

### Google Sheets
Two Apps Scripts ship with the project: `google-sheet-script.gs` (orders, customers, dashboard) and `reports-sheet-script.gs` (Reports backup). Deploy each as a web app, then connect it in the app (Home → Connect Google Sheet / Reports settings). Backups run one way (app → Sheet) and re-run by themselves every 2 minutes if something changed or the last backup failed.

---

## 6. Data and storage
- JSON files in `BUSINESS_STORE_DIR` (default `./data`): `workshop2-data.json`, `material-data.json`, `reports-data.json`, `reports-sheet.json`, `callers.json`, `app-admins.json`, `admin-sessions.json`. With Supabase configured, the main records are also mirrored to the `app_settings` table.
- On Render, mount a persistent disk (or use Supabase) — otherwise files are lost on redeploy.
- Product IDs only count up; a deleted ID is never reused.

---

## 7. Project layout
```
server.js            Express app, Telegram webhook, orders, customers, admins, sheets
workshop.js          Workshop module   → /api/workshop, /api/stock
material.js          Material module   → /api/material
reports.js           Reports, stock, materials → /api/reports
greetings.js ratings.js stories.js storyvideo.js   Greeting / Rating / Weekly Story
public/              Pages (home, index=orders, callers, workshop, material, reports,
                     greeting, rating, stories, setup) + app.js / app.css
google-sheet-script.gs, reports-sheet-script.gs     Apps Scripts
```

### API overview
All `/api/*` routes need an identified Telegram admin (`requireAccess`); the section switch of the route's section must be on.

| Prefix | Section |
|---|---|
| `/api/orders`, `/api/customers` | Orders |
| `/api/callers` | Customer ID |
| `/api/workshop/*` | Workshop (`/settings`, `/send-product`, `/send-order`, `/send-sold`, `/restock`, `/customer/:id`, …) |
| `/api/material/*` | Material (`/state`, `/cut`, `/add`, `/edit`, `/decide`, `/confirm-group`, `/rights`, …) |
| `/api/reports/*` | Reports (view-only) |
| `/api/stock` | Stock view |
| `/api/setup/*` | Admin management |
| `/api/sheets/*` | Google Sheet connection and sync |

Version checks: `/api/workshop-version`, `/api/material-version`.

---

## 8. Troubleshooting
- **"Telegram identity was not received"** — open the app from the bot's menu button, not a browser tab.
- **Webhook not set** — `PUBLIC_BASE_URL` must start with `https://`; check the server log on start.
- **Nothing is posted to a group / topic** — the bot (or the connected admin account) must be in the group; for topics it needs permission to post; use **Send test** on the Workshop / Material settings.
- **Material requests do not reach Telegram** — choose the confirmation group first (Material → ⚙️ Settings); the requests still show in the app.
- **A product cannot be sent to Sold Out** — choose the Sold Out group (Workshop page) first.
- **Data lost after redeploy** — use a persistent disk or Supabase.
- **Hidden buttons for an admin** — check their section switches in Manage Admins.
