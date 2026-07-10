# Setup walkthrough - ISEV-SNEV Mentorship Site

End-to-end instructions to get your site live and the application form wired up
to a Google Sheet + committee email. About 20 minutes total, no command line
required.

Before you start, have three tabs open:

1. Your GitHub account (signed in).
2. A Google account (any - this is what will own the Sheet + Apps Script).
3. A file-explorer window on the `isev-snev-mentorship/` folder.

---

## Part 1 - Upload the files to GitHub (5 min)

1. Go to <https://github.com/new>.
2. **Repository name:** `isev-snev-mentorship` (any name works; it appears in the URL).
3. Leave it **Public**. Leave every checkbox **unchecked** - no README, no
   .gitignore, no license. You already have those.
4. Click **Create repository**.
5. On the empty repo page, click the link **"uploading an existing file"**.
6. Open the `isev-snev-mentorship/` folder on your computer. Select **all** of
   its contents (including the `assets/` subfolder and the hidden `.nojekyll`
   file - you may need to enable "show hidden files" in your OS to see it).
   Drag everything onto the GitHub upload area.
7. Scroll down, add a commit message like "initial site", click **Commit changes**.

✅ Your repo should now show `index.html`, `apply.html`, `README.md`,
`.nojekyll`, `SETUP.md`, and an `assets/` folder.

> If `.nojekyll` is missing, click **Add file → Create new file**, name it
> `.nojekyll` (exactly, with the leading dot), leave it empty, and commit.

---

## Part 2 - Enable GitHub Pages (2 min)

1. In your repo, click **Settings** (top-right of the repo navigation).
2. Left sidebar → **Pages**.
3. *Build and deployment → Source:* **Deploy from a branch**.
4. *Branch:* `main`, folder `/ (root)`. Click **Save**.
5. Wait ~60 seconds and refresh. A green banner appears at the top with your
   live URL, e.g. `https://<your-username>.github.io/isev-snev-mentorship/`.

✅ Open that URL. The landing page works. The Apply form loads but will refuse
to submit - that's expected until Part 4.

---

## Part 3 - Google Sheet + Apps Script (10 min)

This is what makes each form submission land in **both** a Sheet row and an
email to the committee.

### 3a. Create the Sheet

1. Go to <https://sheets.google.com> → click **Blank**.
2. Name it "ISEV-SNEV Mentorship Applications" (top-left).
3. Click cell **A1**, then paste the following row of headers. Sheets will
   auto-split the tabs into columns:

```
timestamp	role	full_name	email	affiliation	country	timezone	languages	career_stage	membership	focus_areas	research_focus	career_topics_primary_ranked	career_topics_primary_text	career_topics_secondary_ranked	career_topics_secondary_text	mentee_goals	mentee_success	mentee_mentor_stage	mentee_timezone_flex	mentor_expertise	mentor_experience	mentor_slots	mentor_style	frequency	availability_window	accessibility	consent_prof_dev	consent_12_month	consent_review	consent_contact	consent_unblind
```

> Heads-up: `career_topics_primary_ranked` and
> `career_topics_secondary_ranked` arrive as JSON arrays
> (`[{"topic":"grant_writing","rank":1},…]`). The matching `_text` columns
> are friendly, comma-separated strings like
> `"1. grant_writing, 2. networking"` - use those if you'd rather read
> them directly in the Sheet. Mentors only fill in the primary tier;
> their `career_topics_secondary_ranked` will be empty.

4. Optional polish: bold row 1, then **View → Freeze → 1 row**.

### 3b. Add the Apps Script

1. From the Sheet: **Extensions → Apps Script**. A new tab opens.
2. Delete the default code. Paste this, changing the two constants at the top
   if needed:

```javascript
const COMMITTEE_EMAIL = 'isevmentorship@gmail.com';
const SITE_URL = 'https://isevmentorship.github.io/isev-snev-mentorship/';
const PROGRAM_NAME = 'ISEV-SNEV Mentorship Program';

function doPost(e) {
  // Serialize concurrent submissions so two applicants can't write the same
  // Sheet row at the same moment.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    let data = {};
    if (e.postData && e.postData.type === 'application/json') {
      data = JSON.parse(e.postData.contents);
    } else {
      // Form-encoded post: e.parameters holds every value as an array,
      // which also captures repeated keys from multi-selects.
      Object.keys(e.parameters || {}).forEach(function (k) {
        const v = e.parameters[k];
        data[k] = v.length > 1 ? v.join('; ') : v[0];
      });
    }

    // Honeypot: bots fill the invisible _gotcha field. Pretend success,
    // store nothing, email no one.
    if (data._gotcha) {
      return jsonReply_({ ok: true });
    }

    data.timestamp = new Date().toISOString();

    const row = headers.map(function (h) {
      const v = data[h];
      if (v === undefined || v === null) return '';
      return Array.isArray(v) ? v.join('; ') : v;
    });
    sheet.appendRow(row);

    const summary = headers
      .filter(function (h) { return String(data[h] === undefined ? '' : data[h]) !== ''; })
      .map(function (h) {
        return h + ': ' + (Array.isArray(data[h]) ? data[h].join(', ') : data[h]);
      })
      .join('\n');

    // 1) Copy to the committee. Reply-to is the applicant, so the committee
    //    can respond with one click.
    MailApp.sendEmail({
      to: COMMITTEE_EMAIL,
      subject: 'Mentorship application (' + (data.role || 'unknown') + '): ' + (data.full_name || ''),
      body: summary,
      replyTo: String(data.email || COMMITTEE_EMAIL)
    });

    // 2) Confirmation to the applicant, with a copy of their answers.
    if (data.email) {
      MailApp.sendEmail({
        to: String(data.email),
        subject: PROGRAM_NAME + ' - application received',
        body:
          'Hi ' + (data.full_name || 'there') + ',\n\n' +
          'Thanks for applying to the ' + PROGRAM_NAME + ' as a ' +
          (data.role || 'participant') + '. The matching committee will review ' +
          'your application; you should hear back within two weeks.\n\n' +
          'For your records, here is a copy of your answers:\n\n' +
          summary + '\n\n' +
          'If anything looks wrong, just reply to this email.\n\n' +
          '- The ISEV-SNEV Mentorship Committee\n' + SITE_URL,
        replyTo: COMMITTEE_EMAIL
      });
    }

    // AJAX submissions (the normal path) get JSON back and the site shows its
    // own in-page confirmation. A plain form post (the no-JS/offline fallback
    // sets _native=1) gets a real confirmation page instead of raw JSON.
    if (data._native === '1') {
      return HtmlService.createHtmlOutput(confirmationPage_(data));
    }
    return jsonReply_({ ok: true });
  } catch (err) {
    return jsonReply_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonReply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function confirmationPage_(data) {
  const name = data.full_name ? ', ' + escapeHtml_(String(data.full_name)) : '';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Application received</title></head>' +
    '<body style="font-family:Georgia,serif;background:#f7f9fb;margin:0;padding:3rem 1rem;">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #dde5ec;' +
    'border-radius:10px;padding:2rem;">' +
    '<h1 style="color:#0f2a44;margin-top:0;">Application received.</h1>' +
    '<p>Thanks' + name + ' - your application is in. A confirmation with a copy ' +
    'of your answers is on its way to your email, and the committee will be in ' +
    'touch within two weeks.</p>' +
    '<p><a href="' + SITE_URL + '" style="color:#0f2a44;">Back to the program site</a></p>' +
    '</div></body></html>';
}

function escapeHtml_(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

3. Click the floppy-disk **Save** icon. Name the project "Mentorship form" if prompted.

> **Already deployed once and just updating the code?** Paste the new code,
> save, then go to **Deploy → Manage deployments → ✏️ (edit) → Version: New
> version → Deploy**. This keeps the same web-app URL, so nothing in
> `apply.html` needs to change. (Creating a *New deployment* instead would
> mint a different URL and silently orphan the form.)

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
7. Keep this tab open - you need the URL in Part 4.

---

## Part 4 - Wire the form to your Apps Script (2 min)

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

## Part 5 - Test it (2 min)

1. Open your live Apply page.
2. Fill in the form as a fake applicant (use an email you can check) and submit.
3. Check:
   - The page shows the in-page "Application received." confirmation (no
     redirect to a raw JSON page).
   - The Google Sheet gains a new row with all the answers, including the
     `career_topics_*` columns.
   - The committee address receives a copy, and the applicant email receives
     a confirmation with all the answers.

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
  2-3 minutes, hard-refresh (Ctrl/⌘+Shift+R).
- **Form says "This form is not configured yet".** The `action=` attribute in
  `apply.html` still contains the literal text `YOUR_FORM_ENDPOINT`. Part 4.
- **Form says "Submission failed".** Open your Apps Script → **Executions**
  (clock icon in the left rail). The latest execution's log shows the real
  error. Common cause: the Sheet headers don't match the form field names, or
  the deployment access is not "Anyone."
- **Want to rename columns?** You can rearrange or rename headers in the Sheet
  freely - the script matches by name, not by position. Just keep the header
  text identical to the form field `name` attributes in `apply.html`.
