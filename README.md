ETHIOPIAN CALENDAR PICKER (v65): Order / Completion / Delivery date now open a calendar grid (Ethiopian months, Pagume 5/6 days, Today / Clear). Orders View now shows the exact Order, Completion and Delivery dates (yyyy/mm/dd) - paste the new google-sheet-script.gs into Apps Script and deploy a new version.

ETHIOPIAN CALENDAR UPDATE: every date is now Ethiopian.
 - Order Date / Completion Date / Delivery Date: the order form has Day · Month (Meskerem … Pagume) · Year pickers; the card shows the date as yyyy/mm/dd (e.g. 2019/03/05).
 - Google Sheet: those dates, plus Created At / Last Updated, are Ethiopian TEXT (yyyy/mm/dd). Google no longer turns them into Gregorian dates.
   Old rows (Gregorian) are converted automatically the next time the server starts / "Test" runs. Dashboard, Graphs (Daily/Weekly labels like "Hidar 5") and Orders View work from the Ethiopian dates.
 - To apply: paste the new google-sheet-script.gs into Apps Script, Save, Deploy -> New deployment (or "Manage deployments" -> New version), then restart the server.

Ambar Furniture v54
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

## v51 – ONE FEATURES BOX · ONE GRAPH BUTTON · ✏️ EDIT ORDER
- **Ambar Assistant removed** (card, server routes and notes storage). In Product Information there is now ONE box, "Additional features" (free text).
  It is printed on the order card, saved with the order and written to a new Google Sheet column "Additional Features" (after Drawer).
- **Graphs: ONE button.** The Graphs tab has a single yellow drop-down (cell B3): Daily · Weekly · Monthly · Yearly. It changes every graph together
  (time graphs = last 12 days/weeks/months/years; total graphs = Today / This week / This month / This year). The per-graph drop-downs are gone.
  The Dashboard tab is unchanged.
- **✏️ Edit order** button in the admin bot, on the cross-check copy, next to "💰 Customer paid in full" (it is there from the start; the paid button
  still appears after the customer confirms). It opens the order form pre-filled; "💾 Save changes" updates the SAME order:
  the same Google Sheet row is changed (no new row), the card image/caption is refreshed in the admin bot (and in the customer's chat when the bot sent it).
  Needs PUBLIC_BASE_URL set to your https address. The customer's Telegram chat ID is not editable.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server (the new column and graph button are built on start).

## v52 – SEPARATE ANSWER BUTTON · PAY-FULL ALWAYS · EDIT RE-SENDS TO CUSTOMER · NO TREND · GRAPHS FIX
- Customer card sent by the bot: the answer link is ONLY the button "🔗 መልስ ለመስጠት ክፈት" (the extra text link inside the caption is gone).
- Admin bot: "💰 Customer paid in full" is always on the cross-check copy (no need to wait for the customer to confirm), next to "✏️ Edit order".
- Saving an edit re-sends the order to the customer as a new card titled "✏️ EDITED ORDER" with the answer button. The answer is reopened (status back to Pending)
  so the customer can confirm / reject / comment again. The same Google Sheet row is updated. Needs the customer's numeric Telegram chat ID (customer pressed Start).
- Google Sheet Dashboard: the TREND section is removed; Breakdown and Latest 10 orders moved up.
- Graphs tab: the total graphs now cover the same window as the time graphs (last 12 days / weeks / months / years), so they are no longer empty when "today" has no orders.
  The sheet is now built part by part: if one tab fails, the others are still built and the reason is shown in red in cell A3 of the Graphs tab.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

## v53 – GRAPHS ALWAYS VISIBLE · EDITED ORDER RE-SENT · SEPARATE ANSWER BUTTON
- Graphs tab: the numbers behind the graphs are now calculated by the script and written as plain values (no formulas), so the charts cannot stay blank.
  They refresh when you change the yellow drop-down (B3), whenever an order is saved, and when the sheet is rebuilt. Totals cover the same last 12 days / weeks / months / years as the time graphs.
  The script also tries to install an "edit" trigger on setup (a permission prompt may appear when you deploy).
- Edited order: saving an edit re-sends it to the customer the same way the order first went: bot card -> Telegram Business -> your connected Telegram account.
  The message header says "✏️ EDITED ORDER". If it cannot be sent, the reason is shown on the edit screen.
- Cards sent from your own Telegram account: when the customer has pressed Start in the AMBAR bot, the answer link now comes as a SEPARATE message with a real button
  (a personal account cannot attach bot buttons). If the customer never pressed Start, the text link stays inside the card.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment (allow permissions) -> new /exec URL -> restart the server.

## v54 – GRAPHS FILLED · EDIT CLOSED AFTER PAID IN FULL
- Graphs tab: the first column of every graph table (Nov 12, 2019 …) is now stored as plain TEXT. Before, Google Sheets turned it into dates / numbers, so the chart
  treated it as data and the real bars looked empty. Old rows are cleared on every refresh, the charts are told to use the first column as labels, and a pie with
  no orders shows a grey "(no orders)" slice instead of a blank circle.
- Every graph is drawn on its own; if one fails, the others still show and the reason is written in cell E3 (red). If the charts are ever deleted, they are drawn again
  automatically on the next order / drop-down change.
- Paid in full = order closed: after "💰 Customer paid in full" the ✏️ Edit order button disappears from the admin bot, the edit page shows "closed", and the server
  refuses any edit of that order. Everything else is unchanged.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment (allow permissions) -> new /exec URL -> restart the server (the Graphs tab is rebuilt on start).
- v54b: charts now send only basic options (colours, stacking, legend, donut, bar width, size); fonts / axis styling / chart-area options were removed because an unsupported option can leave an empty frame.

## v55 – GOOGLE SHEET: CONNECT ONCE, CONNECTED FOR ALL TIME
 - Main admin: ⚙ → 📊 Google Sheet → paste the Web app URL (…/exec) → "Connect & save permanently". The link is checked, then saved on disk AND in Supabase (`app_settings.google_sheet_connection`).
 - On every server start the saved link is restored automatically (before anything else), so a restart / redeploy never disconnects the sheet.
 - A wrong link never replaces a working saved one. Errors never erase the saved link.
 - If Google fails for a moment, the server quietly reconnects every 2 minutes, and each new order retries on its own.
 - Existing GOOGLE_SCRIPT_URL / GOOGLE_FORM_URL settings still work and are saved permanently on first start. Nothing else was changed.
 - For best permanence keep Supabase configured (Render's disk can be wiped on redeploy; Supabase keeps the link).

## v56 – CARD TO CUSTOMER + THANK-YOU AFTER FULL PAYMENT
 - Thank-you bug fixed: the check for the customer's chat ID was written with a broken pattern, so the message was never sent (and line breaks showed as "\n"). Now the customer gets the thank-you right after the admin presses "Paid in full"; the admin sees whether it was delivered.
 - Cards to customers: the bot sends the card to the customer when they have pressed Start. If not, the order is saved as "waiting" and the card is sent AUTOMATICALLY the moment the customer opens/starts the bot (matched by Telegram ID or @username). Admins get a note when it is delivered.
 - Telegram rule: a bot cannot message someone who never opened it, so the customer must open the bot once (the order warning shows the bot link to send them).

## v57 – CARD TO CUSTOMER: PERSONAL START LINK + FALLBACKS
 - If the card cannot be delivered when the order is saved, the admin warning now shows a personal link: https://t.me/<bot>?start=o_<order token>. When the customer opens it and presses Start, the card is delivered immediately (matched by the link itself, so it works even if the server forgot the customer's @username or ID, e.g. after a Render restart without Supabase).
 - Cards are also still auto-delivered when a known customer (by Telegram ID or @username) opens the bot.
 - If the card photo itself cannot be sent, the bot now falls back to a text message with the answer button instead of failing.
 - Telegram rule: a bot cannot message a person who never opened it, so a customer who never started the bot needs that one tap.
 - Keep Supabase configured so customers are remembered between restarts.

## v58 – CREATE & SEND ORDER CARD → SELECTED CUSTOMER
 - The "Select customer" list now shows everyone who pressed Start in the AMBAR bot, for the main admin AND for every assigned admin (before, assigned admins saw an empty list). Names are shown properly, and choosing one fills the customer's chat ID, @username and name.
 - "📨 Create & Send Order Card" sends the card with its button straight to the selected customer through the AMBAR bot. Assigned admins no longer need their own connected Telegram account for this.
 - If the customer has not pressed Start, the order is still saved and the personal start link (see v57) is shown.

## v59 – CARD REACHES THE SELECTED CUSTOMER (AND THE ADMIN BOT)
 - The order result now names exactly who received the card (customer name / @username) and warns if the chosen chat belongs to an admin account.
 - Admin accounts no longer appear in the "Select customer" list (they pressed Start too, but they are not customers).
 - When the admin has Telegram Business connected, the customer ALSO receives the card in their normal chat with the admin, in addition to the AMBAR bot copy. Admin cross-check copies in the AMBAR bot are unchanged.

## v60 – FOUR BUTTONS ON THE CUSTOMER'S ORDER CARD
 The card the customer receives now has four clickable buttons right under it:
 1. 🔗 መልስ ለመስጠት ክፈት – opens the answer page (unchanged)
 2. ✅ Confirm Order – confirms the order from the message itself
 3. ❌ Reject Order – rejects it
 4. 💬 Comment – the bot asks the customer to type the comment, saves it and tells the admins
 After an answer the buttons stay visible but locked, the card shows the final status, and the admin bot copies update as before. The order form and everything else are unchanged.

## v61 – CARD ALWAYS GETS SENT (button fallback)
 - The card is first sent with the 4 buttons. If Telegram refuses that keyboard for any reason, it is automatically re-sent with the 🔗 answer button only, and then with no buttons, so the customer always receives the card. Applies to the AMBAR bot send and the Telegram Business send.
 - If the card photo itself cannot be sent, a text message with the buttons is sent instead.
 - Real Telegram errors (blocked bot, customer never pressed Start, etc.) are shown in the order result.

## v62 – removed the 🔢 Summary (numbers) and 📈 Graphs page buttons from the settings panel (nothing else changed).

## v63 – fixed 'api is not defined' on 🗑 Start from ZERO (settings panel). Nothing else changed.
