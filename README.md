# ISEV–SNEV Mentorship Program — Landing Site

A static landing page, a built-in application form, and a clickable prototype of
the matchmaker flow for the joint **ISEV × SNEV Mentorship Program**. Designed to
be dropped into a new GitHub repository and published with GitHub Pages — no
servers, no build step.

## What's in this folder

```
isev-snev-mentorship/
├── index.html            # Landing page (about, how it works, eligibility, FAQ, apply CTA)
├── apply.html            # Application form (mentor/mentee in one page)
├── prototype.html        # 5-step clickable demo of the matching flow (sample data only)
├── assets/
│   ├── styles.css        # Shared stylesheet (clean academic default)
│   ├── apply.js          # Form logic: role toggle, validation, AJAX submit
│   └── app.js            # Prototype logic (no backend, no storage)
├── .nojekyll             # Tells GitHub Pages to skip Jekyll processing
└── README.md             # This file
```

Everything runs client-side. The only outbound network call is the form submit
to whichever service you wire up below.

## Quick start (5 minutes)

1. Create a new empty GitHub repo (e.g., `isev-snev-mentorship`).
2. Copy the contents of this folder into the repo root and push to `main`.
3. In the repo, open **Settings → Pages**, set source to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
4. Wait ~60 seconds, then visit `https://<your-username>.github.io/isev-snev-mentorship/`.
5. Wire up the application form — see the next section.

At this point the landing page and the prototype already work. The application
form will *show* the correct error and refuse to submit until you configure a
form-handling endpoint.

---

## Wiring up the application form

The form lives in `apply.html` and posts to a URL defined in its `action=` attribute:

```html
<form id="applyForm" action="https://formspree.io/f/YOUR_FORM_ENDPOINT" method="POST">
```

You have two good options — pick one, get an endpoint URL, paste it in place of
`YOUR_FORM_ENDPOINT`.

### Option A — Formspree (easiest, ~3 minutes)

A hosted form handler. Free tier: 50 submissions/month, built-in spam filtering,
auto-reply emails, submission archive.

1. Go to [formspree.io](https://formspree.io) and sign up (email or GitHub login).
2. Click **New Form**, give it a name (e.g., "ISEV-SNEV Mentorship"), and set
   the **Send to** address to the committee's inbox.
3. Copy the form's endpoint — it looks like
   `https://formspree.io/f/abcd1234`.
4. Open `apply.html` and replace the entire `action` URL:
   ```html
   <form id="applyForm" action="https://formspree.io/f/abcd1234" method="POST">
   ```
5. Also remove (or delete) the `<div class="callout" id="endpointNotice">…</div>`
   block in `apply.html` so the setup notice stops appearing to applicants.
6. Commit and push. Submit a test application; it should land in the inbox.

**Getting applications into a spreadsheet:** Formspree's Google Sheets
integration requires a paid plan. For free, do one of:

- **Zapier/Make (free tiers available):** create a zap with trigger
  *New Email Matching Search* (subject contains "ISEV-SNEV Mentorship Application")
  and action *Google Sheets → Create Spreadsheet Row*. Map each form field to
  a column. This works but has rate limits.
- **Google Apps Script on the inbox:** in the committee's Gmail, run an
  Apps Script that parses the email body and appends to a Sheet.
  See [developers.google.com/apps-script/guides/triggers](https://developers.google.com/apps-script/guides/triggers).
- **Skip the integration:** Formspree already keeps a searchable archive of
  every submission and can export to CSV on demand.

**Alternatives with the same flow:** [Basin](https://usebasin.com) (100/mo free),
[Getform](https://getform.io) (50/mo free), [Web3Forms](https://web3forms.com) (unlimited, free),
[FormSubmit](https://formsubmit.co) (no signup — just use
`action="https://formsubmit.co/you@example.org"`). All of these accept the same
POST body as Formspree, so you just swap the URL.

### Option B — Google Apps Script (free forever, email + Sheet in one step)

A little more setup, but nothing to pay for and you own the data end-to-end.
Submissions land as **both** a row in a Google Sheet and an email to the committee.

1. Open [sheets.google.com](https://sheets.google.com) and create a new Sheet
   called, e.g., "ISEV-SNEV Mentorship Applications."
2. In the first row, add column headers matching the field names in `apply.html`:
   ```
   timestamp  role  full_name  email  affiliation  country  timezone  languages
   career_stage  membership  research_focus  keywords  mentee_goals
   mentee_success  mentee_mentor_stage  mentee_timezone_flex  mentor_expertise
   mentor_experience  mentor_slots  mentor_style  frequency
   availability_window  accessibility  consent_review  consent_contact
   consent_unblind
   ```
   (Order doesn't matter — the script matches by name.)
3. From the Sheet, go to **Extensions → Apps Script**. Delete the default code
   and paste:
   ```js
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

     // Send the committee an email copy
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
4. Click **Deploy → New deployment → Web app**.
   - *Execute as:* Me
   - *Who has access:* Anyone
   - Click **Deploy** and authorize when prompted.
5. Copy the generated **Web app URL** (looks like
   `https://script.google.com/macros/s/AKfyc.../exec`).
6. Paste it into `apply.html` as the form's `action` attribute, and delete the
   setup notice `<div class="callout" id="endpointNotice">…</div>`.
7. Commit, push, submit a test application. You should see a new row in the
   Sheet and a new email in the committee inbox.

Apps Script is free; quotas are generous for this use case (on the order of
thousands of emails/day for consumer accounts).

### If the page says "This form is not configured yet"

That's the safety net in `apply.js`. It means the `action=` attribute still
contains the literal string `YOUR_FORM_ENDPOINT`. Edit `apply.html`, replace
that placeholder with your real endpoint URL, and redeploy.

---

## Fields collected by the form

Shared (both roles): name, email, affiliation, country, time zone (standardized
IANA dropdown), preferred language(s), career stage, ISEV/SNEV membership,
EV focus areas (standardized multi-select), brief free-text description,
ranked career topics (up to 5, weighted 1–5), meeting frequency,
availability window, accessibility notes, five consent checkboxes
(professional-development acknowledgement, 12-month commitment, review,
contact, unblinding).

Mentee-specific: 12-month goals narrative, what success looks like, preferred
mentor seniority, time-zone flexibility.

Mentor-specific: mentoring experience narrative, prior mentoring experience,
support level (1, 2, or 3 mentees per cycle), mentoring style.

All field names are visible in `apply.html`. If you edit, add, or remove fields,
update the Sheet headers (Option B) or your spreadsheet export (Option A) to match.

---

## Deploy to GitHub Pages

1. Create a repository on GitHub (e.g., `isev-snev-mentorship`).
2. Copy the contents of this folder to the root of the repo.
3. Commit and push to `main`.
4. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
5. Visit `https://<your-username>.github.io/isev-snev-mentorship/`.

### Custom domain (optional)

If the program gets its own subdomain (e.g., `mentorship.isev.org`):

1. Add a file named `CNAME` at the repo root containing only the bare domain.
2. In your DNS provider, add a `CNAME` record pointing `mentorship` to
   `<your-username>.github.io`.
3. In Settings → Pages, enable HTTPS once the certificate is issued.

---

## Preview locally

Because the prototype loads `assets/app.js` and `assets/apply.js` via relative
paths, some browsers block local-file JS. Easiest fix is a tiny local server:

```bash
cd isev-snev-mentorship
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## What to edit before going live

| File | What to change |
| --- | --- |
| `apply.html` | Replace `YOUR_FORM_ENDPOINT` in the `<form action=...>` with your real endpoint URL |
| `apply.html` | Remove the `<div class="callout" id="endpointNotice">…</div>` setup banner |
| `index.html` | Replace the brand monogram (`IS`) with an official logo if/when licensed |
| `index.html` | Update the SNEV link in the footer and the `mailto:` for the committee |
| `index.html` | Update the matching-cycle label (e.g., "Spring 2026") |
| `prototype.html` | The sample applicant profile in Step 2 is hardcoded — edit to taste |
| `assets/app.js` | `MENTOR_CANDIDATES` and `MENTEE_CANDIDATES` hold the fake demo candidates |

---

## What the prototype demonstrates (and what it doesn't)

The prototype is a **front-end-only walkthrough** so mentors, mentees, and the
committee can see the intended user experience before any real system is built.
It supports role selection, an "application accepted" confirmation screen, 1–3
blinded candidate profiles with fit scores and tags, selecting and submitting
picks, and a simulated "mutual match" unblinding screen.

It does **not** include: real authentication, application submission, admin
review tooling, messaging, or persistence — that's what the application form +
Sheet/Formspree inbox is for in this early phase. When you're ready to replace
the prototype with a real matching system, the visual components in
`prototype.html` are structured to be re-used on top of a small backend
(Supabase, Firebase, or a Node/Python service).

## License / credits

Draft site template for the joint ISEV × SNEV Mentorship Program.
Logos, program copy, and branding are placeholders and should be reviewed
by the ISEV and SNEV representatives before the site is made public.
