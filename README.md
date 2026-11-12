Ambar Furniture v44
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
