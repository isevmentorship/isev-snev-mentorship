# Setup walkthrough — ISEV–SNEV Mentorship Site

End-to-end instructions to get your site live and the application form wired up
to a Google Sheet + committee email. About 20 minutes total, no command line
required.

Before you start, have three tabs open:

1. Your GitHub account (signed in).
2. A Google account (any — this is what will own the Sheet + Apps Script).
3. A file-explorer window on the `isev-snev-mentorship/` folder.

---

## Part 1 — Upload the files to GitHub (5 min)

1. Go to <https://github.com/new>.
2. **Repository name:** `isev-snev-mentorship` (any name works; it appears in the URL).
3. Leave it **Public**. Leave every checkbox **unchecked** — no README, no
   .gitignore, no license. You already have those.
4. Click **Create repository**.
5. On the empty repo page, click the link **"uploading an existing file"**.
6. Open the `isev-snev-mentorship/` folder on your computer. Select **all** of
   its contents (including the `assets/` subfolder and the hidden `.nojekyll`
   file — you may need to enable "show hidden files" in your OS to see it).
   Drag everything onto the GitHub upload area.
7. Scroll down, add a commit message like "initial site", click **Commit changes**.

✅ Your repo should now show `index.html`, `apply.html`, `prototype.html`,
`README.md`, `.nojekyll`, `SETUP.md`, and an `assets/` folder.

> If `.nojekyll` is missing, click **Add file → Create new file**, name it
> `.nojekyll` (exactly, with the leading dot), leave it empty, and commit.

---

## Part 2 — Enable GitHub Pages (2 min)

1. In your repo, click **Settings** (top-right of the repo navigation).
2. Left sidebar → **Pages**.
3. *Build and deployment → Source:* **Deploy from a branch**.
4. *Branch:* `main`, folder `/ (root)`. Click **Save**.
5. Wait ~60 seconds and refresh. A green banner appears at the top with your
   live URL, e.g. `https://<your-username>.github.io/isev-snev-mentorship/`.

✅ Open that URL. The landing page and the prototype both work. The Apply form
loads but will refuse to submit — that's expected until Part 4.

---

## Part 3 — Google Sheet + Apps Script (10 min)

This is what makes each form submission land in **both** a Sheet row and an
email to the committee.

### 3a. Create the Sheet

1. Go to <https://sheets.google.com> → click **Blank**.
2. Name it "ISEV-SNEV Mentorship Applications" (top-left).
3. Click cell **A1**, then paste the following row of headers. Sheets will
   auto-split the tabs into columns:

```
timestamp	role	full_name	email	affiliation	country	timezone	languages	career_stage	membership	focus_areas	research_focus	career_topics_ranked	career_topics_ranked_text	mentee_goals	mentee_success	mentee_mentor_stage	mentee_timezone_flex	mentor_expertise	mentor_experience	mentor_slots	mentor_style	frequency	availability_window	accessibility	consent_prof_dev	consent_12_month	consent_review	consent_contact	consent_unblind
```

> Heads-up: `career_topics_ranked` arrives as a JSON array
> (`[{"topic":"grant_writing","rank":1},…]`). `career_topics_ranked_text`
> is a friendly, comma-separated string like `"1. grant_writing, 2. networking"`
> — use that column if you'd rather read it directly in the Sheet.

4. Optional polish: bold row 1, then **View → Freeze → 1 row**.

### 3b. Add the Apps Script

1. From the Sheet: **Extensions → Apps Script**. A new tab opens.
2. Delete the default code. Paste this, changing the email on the first line:

```javascript
const COMMITTEE_EMAIL = 'isevmentorship@gmail.com';

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = e.postData && e.postData.type === 'application/json'
    ? JSON.parse(e.postData.contents)
    : (e.parameter || {});
  data.timestamp = new Date().toISOString();
  const row = headers.map(h => Array.isArray(data[h]) ? data[h].join('; ') : (data[h] || ''));
  sheet.appendRow(row);

  const body = headers.map(h => `${h}: ${Array.isArray(data[h]) ? data[h].join(', ') : (data[h] || '')}`).join('\n');
  MailApp.sendEmail({
    to: COMMITTEE_EMAIL,
    subject: `Mentorship application (${data.role || 'unknown'}): ${data.full_name || ''}`,
    body: body
  });

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Click the floppy-disk **Save** icon. Name the project "Mentorship form" if prompted.

### 3c. Deploy as a web app

1. Click **Deploy** (top-right blue button) → **New deployment**.
2. Click the gear icon next to *Select type* → **Web app**.
3. Fill in:
   - **Description:** "Mentorship form handler"
   - **Execute as:** *Me (your email)*
   - **Who has access:** **Anyone** ← critical
4. Click **Deploy**.
5. Google asks you to authorize access. Click **Authorize access** → pick your
   account → ignore the "Google hasn't verified this app" warning (it's your
   own script) → **Advanced → Go to [project] (unsafe) → Allow**.
6. On the success screen, **copy the Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb……/exec`
7. Keep this tab open — you need the URL in Part 4.

---

## Part 4 — Wire the form to your Apps Script (2 min)

1. On GitHub, open your repo and click `apply.html`.
2. Click the **pencil icon** (top-right of the file view) to edit.
3. Use **Ctrl/⌘+F** inside the editor and search for `YOUR_FORM_ENDPOINT`.
4. Replace the entire `action="..."` URL on that line with the Web app URL you
   copied. Before:
   ```html
   <form id="applyForm" class="apply-form" action="https://formspree.io/f/YOUR_FORM_ENDPOINT" method="POST" novalidate>
   ```
   After:
   ```html
   <form id="applyForm" class="apply-form" action="https://script.google.com/macros/s/AKfycb……/exec" method="POST" novalidate>
   ```
5. Search for `id="endpointNotice"`. Delete the entire block from
   `<div class="callout" id="endpointNotice">` through the matching `</div>` so
   the yellow setup banner stops showing to applicants.
6. Scroll to the bottom, commit message "wire up form to Apps Script", click
   **Commit changes**.

GitHub Pages redeploys automatically in ~30 seconds.

---

## Part 5 — Test it (2 min)

1. Open your live Apply page.
2. Fill in the form as a fake applicant and submit.
3. Check:
   - The Google Sheet gains a new row with all the answers.
   - The committee email address you set in line 1 of the Apps Script receives
     an email.

If either doesn't arrive, the cause is almost always one of these three:

- The Apps Script deployment wasn't set to *Anyone* access. Redeploy with that
  setting.
- The `action="…"` URL in `apply.html` has a typo or is missing the `/exec` at
  the end.
- The email on line 1 of the script is missing quotes or has a typo.

---

## Go-live cleanup

Edit these in `index.html` (same pencil-icon editor as before):

- Replace the placeholder SNEV link in the footer with the real one.
- Confirm `mailto:isevmentorship@gmail.com` is the committee address you want on the public site.
- Update the "Spring 2026 matching cycle" label in the hero if your cycle is
  named differently.
- Swap the `IS` monogram for a real ISEV/SNEV logo once you have approval.

---

## Updating the site later

Whenever you want to change text or add a field:

1. On GitHub, open the file (`index.html`, `apply.html`, etc.).
2. Click the pencil icon.
3. Make your edits.
4. Commit.

GitHub Pages redeploys within a minute. If you add or remove a form field in
`apply.html`, remember to add or remove the matching column header in the
Google Sheet.

---

## Help / troubleshooting

- **Pages URL shows a 404 for a few minutes after enabling.** Normal. Give it
  2–3 minutes, hard-refresh (Ctrl/⌘+Shift+R).
- **Form says "This form is not configured yet".** The `action=` attribute in
  `apply.html` still contains the literal text `YOUR_FORM_ENDPOINT`. Part 4.
- **Form says "Submission failed".** Open your Apps Script → **Executions**
  (clock icon in the left rail). The latest execution's log shows the real
  error. Common cause: the Sheet headers don't match the form field names, or
  the deployment access is not "Anyone."
- **Want to rename columns?** You can rearrange or rename headers in the Sheet
  freely — the script matches by name, not by position. Just keep the header
  text identical to the form field `name` attributes in `apply.html`.
