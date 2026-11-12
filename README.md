Ambar Furniture v50
Customer answer page update:
The Telegram card still has exactly ONE button: መልስ ለመስጠት ክፈት.
On the answer page, customer can Confirm, Reject, or choose Comment.
After choosing Comment, they type the comment and choose exactly one of:
✅ Confirm & Send Comment
❌ Reject & Send Comment
The selected decision and comment are saved and sent to the admin together.

FILES IN THIS PROJECT
  package.json         – dependencies + start command (npm start)
  server.js            – the whole server, including the Google Sheet code
  public/index.html    – the order form page (product dropdown, Shoe Shelf sizes, main-admin 📊 Google Sheet button)
  public/setup.html    – the admin setup page
Deploy: keep this folder structure, run `npm install` then `npm start`.
(server.js also holds a built-in backup copy of both pages, used only if the public files are missing.)

Google Sheet control (main admin only)
--------------------------------------
Every order and every movement is written to a Google Sheet automatically:
  • Orders        – one row per order, always current (status, product, customer, delivery, comments, links)
  • Activity Log  – one new row per movement (created, delivered / not delivered, Confirmed, Rejected, comment, answer closed, admin assigned / removed, full sync)
  • Dashboard     – live totals and orders-by-product built from the two tabs above
The "📊 Google Sheet" button (and ⚙ settings: test / sync all) is shown ONLY to the main admin, and the server refuses everyone else.

One-time setup:
 1. Google Cloud Console → create a project → enable "Google Sheets API".
 2. IAM & Admin → Service Accounts → create one → Keys → Add key → JSON (download).
 3. Create a Google Sheet, click Share, add the service account e-mail (client_email in the JSON) as Editor.
 4. In Render → Environment add:
      GOOGLE_SHEET_ID               = the long id from the sheet URL (…/spreadsheets/d/<ID>/edit)
      GOOGLE_SERVICE_ACCOUNT_JSON   = the whole JSON file content
      SHEET_TIMEZONE                = optional, default Africa/Addis_Ababa
      PUBLIC_BASE_URL               = your app URL (so card / answer links in the sheet are full links)
 5. Redeploy, open the app as main admin, tap ⚙ → "Test connection", then "Sync ALL orders" to back-fill old orders.
The sheet is a one-way record (app → sheet). Editing cells in the sheet does not change orders in the app.


EASY Google Sheet connection (no Google Cloud, no API)
 1. Create a Google Sheet. Open Extensions -> Apps Script.
 2. Delete the existing code, paste everything from google-sheet-script.gs, click Save.
 3. Deploy -> New deployment -> gear icon -> "Web app". Execute as: Me. Who has access: Anyone. Click Deploy and allow permissions.
 4. Copy the Web app URL and set it on the server:  GOOGLE_SCRIPT_URL = <that URL>
    (optional password: set SECRET in the script and the same value in GOOGLE_SCRIPT_KEY)
 5. Restart the server, then use the Google Sheet button -> Test.

If you see "Google Script did not answer correctly":
 - Deploy -> Manage deployments -> pencil (Edit) -> Who has access = Anyone -> Version = New version -> Deploy.
 - Use the Web app URL ending in /exec (not /dev, not the sheet link).
 - Re-paste the latest google-sheet-script.gs, Save, then deploy a New version.
 - Open the /exec URL in a browser: it should show {"ok":true,"message":"AMBAR sheet connector is running."}

HTTP 401 / "asking to sign in" fix:
 - Apps Script -> Deploy -> New deployment -> gear -> Web app -> Execute as: Me, Who has access: Anyone -> Deploy.
 - Use the NEW /exec URL in GOOGLE_SCRIPT_URL (do not reuse the old deployment's URL) and restart the server.
 - Open the /exec URL in an Incognito window. It must show {"ok":true,...} with NO sign-in page.
 - If "Anyone" is not in the list, the Google account is a school/work account that blocks it. Use a personal @gmail.com account for the sheet and script.

GOOGLE FORM MODE (use this if the Web app link keeps giving HTTP 401)
 1. Create a Google Sheet. Open Extensions -> Apps Script, paste google-sheet-script.gs, Save.
 2. forms.google.com -> new form with ONE question, type "Paragraph" (not required). Settings -> Responses: turn OFF "Collect email addresses",
    "Limit to 1 response" and any "Restrict to users in ..." option.
 3. Form -> Responses tab -> "Link to Sheets" -> choose the sheet from step 1.
 4. Form -> three-dots menu -> "Get pre-filled link" -> type x in the box -> "Get link" -> copy the link.
 5. On the server set:  GOOGLE_FORM_URL = <that link>   and   GOOGLE_SHEET_URL = <your sheet's normal address, so the button can open it>
    Do NOT set GOOGLE_SCRIPT_URL (remove it).
 6. In Apps Script pick function "setupFormMode" -> Run -> allow permissions (one time).
 7. Restart the server, press Test. Orders appear in the Orders tab within about a minute.

"Cannot read properties of null (reading 'getSheetByName')":
 The script is not attached to your sheet. Either open the SHEET -> Extensions -> Apps Script and paste google-sheet-script.gs there,
 or put your sheet ID in SHEET_ID at the top of the script. Then Save, run function "authorize" once (allow), and
 Deploy -> New deployment -> Web app (Execute as Me, Anyone) and use the NEW /exec URL.

UPDATE: orders are saved to the Google Sheet in ONE step per order (new row, or the same row updated), with the Activity Log written by the script.
 - If saving fails, the order screen now shows "Google Sheet NOT updated: <reason>".
 - On every server start, all existing orders are synced into the sheet automatically; the main admin can also press Sync ALL.
 - After you change google-sheet-script.gs: Save -> Deploy -> New deployment, and use the new /exec URL.

GOOGLE SHEET LOOKS EMPTY? Your data is in the tab called "Orders" (bottom of the sheet). The new script puts Orders FIRST, removes the empty
default tab and formats it as a table (dark header, banded rows, filter buttons, colored Status, Delivery Type / Service columns).
After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> use the new /exec URL -> restart the server (or press Test)
so the formatting is applied. Tabs: Orders (table), Activity Log (table), Dashboard (totals, by product, by delivery type, by service, latest movements).

ETHIOPIAN MONTH TABS + START NEW MONTH
 - Each Ethiopian month gets its own tab in the Google Sheet (e.g. "Hidar 2019"). An order goes to the month of its Order Date
   (or its creation date if no Order Date). Later updates (confirm / reject / comments) stay in the same row.
 - Columns START WITH THE CUSTOMER INFORMATION: Customer Name, Phone, Telegram Username, Telegram Chat ID, Location, then the order details.
 - "▶ Start New Month" button (main admin only; the server refuses everyone else) creates / opens the tab of the current Ethiopian month.
 - Your old single "Orders" tab is renamed "Old Orders (backup)". When the server restarts, all existing orders are filed into the month tabs automatically
   (or press Sync ALL in the gear panel). You can delete the backup tab afterwards.
 - Dashboard totals add up ALL month tabs.
 - After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

v45 – SETTINGS MENU, ARCHIVE & START NEW, SUMMARY + GRAPHS
 - All control buttons now live inside ONE ⚙ settings icon (bottom right): Open Google Sheet, Summary, Graphs, Sheet test/sync (main admin),
   ♻ Archive old list & Start New (main admin), 👥 Manage Assigned Admins (main admin), 🔗 Connect my Telegram account.
 - ♻ Archive old list & Start New (main admin only, server-enforced): every month tab + the Activity Log are KEPT as "Archive <date> · …" tabs,
   a clean new month tab is created, and orders created before that moment are never written to the sheet again.
 - Google Sheet tabs now start with "Dashboard" (summary in numbers) and "Graphs" (charts), then the month tabs.
 - "Status" column now sits right after "Order Code" (existing tabs are re-mapped by column name automatically; no data is lost).
 - After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

v47 – PROFESSIONAL SHEET DESIGN
 - Order tabs: Roboto font, taller header with colour groups (gold = customer info, teal = Order Code + Status), frozen header + customer name,
   no gridlines, soft row banding, centered status/date columns, money columns formatted (#,##0), colour "pill" Status / Delivered / Paid In Full.
 - Dashboard: banner, 12 KPI tiles, breakdown tables (product / delivery type / service) and the latest 15 movements.
 - Graphs: banner + 6 charts (status, per-month stacked, product, delivery, delivery type, service) with the data tables underneath.
 - After pasting google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server (formatting is re-applied on start).

## Google Sheet tabs (modern layout)
- Dashboard, Graphs – totals and charts.
- **Find Customer** – type an @username, Telegram Chat ID, Order Code or phone in the yellow box (B4); the customer card plus that customer's Orders, Payments, Delivery and Product tables appear.
- Customers, Orders View, Payments (with Balance), Deliveries, Products – one filterable table per topic (live formulas over all month tabs).
- Month tabs (e.g. "Hidar 2019") hold the raw data, header colours grouped by topic. Do not type in the formula tabs.
After pasting the new google-sheet-script.gs: Save, Deploy -> Manage deployments -> New version, then restart the server (or press Test) so the tabs are built.

## v48 – SIMPLER SHEET + NO ZOOM
- Google Sheet tabs are now exactly: Dashboard · Find Customer · Orders View · Graphs · Activity Log · month (date) tabs (newest month first).
  Customers, Payments, Deliveries and Products tabs are no longer built and are deleted automatically (they were only formula views; no order data is lost).
  "Old Orders (backup)" is not touched – delete it by hand once you no longer need it.
- NEW ORDERS ARE ON TOP: every new order is inserted at row 2 of its month tab (right under the header). Existing month tabs are sorted newest-first
  on the next server start / Test, and "Sync ALL" files old orders oldest-first so the newest ends up on top. Orders View was already newest-first.
- Mini app is not zoomable: viewport has user-scalable=no / maximum-scale=1, plus pinch, double-tap and Ctrl+wheel zoom are blocked
  (index.html, setup.html and the customer answer page; server.js also injects it into the built-in fallback pages).
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server (or press Test).

## v49 – ONE "Start from ZERO" BUTTON (main admin only)
- ⚙ Settings → "🗑 Start from ZERO (backup + clear all)" replaces the old "Archive old list & Start New" button. Two confirmations are asked.
- What it does, in order: (1) writes every order to the Google Sheet, (2) the sheet keeps ALL current month tabs + the Activity Log as "Backup <date> · …" tabs
  and creates clean Dashboard / Orders / Log, (3) deletes all orders from the app database, (4) order numbering restarts at 1.
- If the sheet backup fails, nothing is deleted from the app. If the Google Sheet is not connected, the app is cleared without a sheet backup (the message says so).
- Server-enforced: only the main admin (owner) can call /api/sheets/reset-all. Uploaded photos already stored in Supabase Storage are not deleted.
- Note: the built-in fallback copy of index.html inside server.js is old; keep public/index.html in the deploy so the new button is shown.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

## v50 – NO ACTIVITY LOG · NAME SEARCH · INTERACTIVE GRAPHS · AMBAR ASSISTANT
- **Activity Log removed.** The sheet no longer has an "Activity Log" tab (an old one is deleted automatically on the next server start / Test). The Dashboard's
  "Latest 15 movements" was replaced by "Latest 10 orders". Old "Backup … · Activity Log" tabs made by earlier "Start from ZERO" runs are NOT touched – delete them by hand if you wish.
- **Find Customer – search by NAME too.** In the yellow box type a name (or just part of it), @username, Chat ID, Order Code or phone. Row 5 tells you which customers matched
  (if a name matches several people the card shows the first one – type more of the name to narrow it down).
- **Dashboard + Graphs views.** Every graph has a yellow drop-down directly above it (Google Sheets cannot switch a graph by clicking the graph itself):
  * time graphs (Orders over time, Money over time, Dashboard "Trend"): **Daily · Weekly · Monthly · Yearly** (last 12 days / weeks / months / years;
    months and years are ETHIOPIAN, matching the month tabs; weeks start on Monday);
  * total graphs (status, product, delivery type, cards delivered, delivery service): **Today · This week · This month · This year · All time**;
  * the Dashboard numbers, breakdown tables and trend graph each have their own yellow box. Your last choice is kept when the sheet is rebuilt.
  * New look: one card header per graph, donut charts, stacked columns, softer grid, consistent colours (amber / green / red for Pending / Confirmed / Rejected).
- **Hidden tab "_Data"** is the live helper table behind the Dashboard and Graphs. Do not delete it (it is rebuilt automatically on every server start / Test).
- **🤖 Ambar Assistant** (index page, right after "Service Information"): an admin chooses *New feature* or *Correction*, writes it and presses Send.
  It is saved (data/assistant-notes.json, and Supabase `app_settings.assistant_notes` when Supabase is used) and sent by the bot to the main admin in Telegram.
  Assigned admins see their own notes; the main admin sees all of them and can press "Mark done".
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> Manage deployments -> New version (or New deployment, new /exec URL) -> restart the server (or press Test).
