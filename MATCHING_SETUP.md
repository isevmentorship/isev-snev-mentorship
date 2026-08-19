# Matching engine + weekly backup - setup runbook

This turns your Google Sheet from a passive inbox into the running matching
system from `ARCHITECTURE.md` §6-7, plus a weekly Drive backup. It lives in the
**same Apps Script project** as the form handler (`doPost`), so there is nothing
new to host and no new account to create.

The script is `apps_script/matching_engine.gs` in this repo. **That file is the
source of truth** - edit it here, then paste into Apps Script and re-save.

Total time: about 5 minutes.

---

## What it does

- Adds a **`status`** column to your Applications sheet. You (the committee)
  set each applicant to `accepted`, `declined`, or `withdrawn`. Only
  `accepted` applicants enter the pool. A blank status means "submitted, not
  yet reviewed".
- Every night (~2am) and on demand, it scores every accepted mentee against
  every accepted mentor using the two-tier topic algorithm, the focus-area
  overlap, the ±5-hour time-zone filter (widened if the mentee said they're
  flexible), and the same-institution filter. It writes up to the top 3
  candidates per mentee to a **`Proposed Matches`** tab.
- It emails the committee a **digest**: new proposals, applicants awaiting
  review, and anyone who has waited 30+ days with no candidate (the §7
  escalations).
- Every Monday (~4am) it copies the whole spreadsheet into a Drive folder
  **`ISEV-SNEV Mentorship Backups`**, keeping the most recent 26 copies
  (six months).

### This answers your re-matching question directly

Because matching **re-runs from scratch every night over the whole accepted
pool**, the "no suitable match today, but a good mentor joins next week"
case is handled automatically: the next run sees the new mentor and proposes
the pair. Nobody has to remember to re-assess. Pairs the committee has already
advanced (to `mutual-interest`, `admin-approved`, `active`, etc.) are preserved
across runs and never regenerated; only fresh `proposed` rows are recomputed.
A mentor stays in the pool until the number of their matches in an approved/
active state reaches the `mentor_slots` they chose.

---

## Install

1. Open the applications Google Sheet -> **Extensions -> Apps Script** (the
   same project that contains the form's `doPost` function).
2. Click the **+** next to *Files* -> **Script**. Name it `matching_engine`.
3. Open `apps_script/matching_engine.gs` from this repo, copy the **entire**
   file, paste it in, and click **Save**.
4. If your committee address is not `isevmentorship@gmail.com`, change the
   `DIGEST_EMAIL` constant near the top.
5. In the function dropdown at the top of the editor, choose
   **`setupMentorshipSystem`** and click **Run**. Approve the permission
   prompt (it needs Sheets, Gmail, and Drive access - all for your own data).
   This creates the tabs and installs both nightly and weekly triggers.
6. Reload the Sheet. A **Mentorship** menu appears with:
   - *Generate matches now*
   - *Send committee digest now*
   - *Snapshot backup now*
   - *Setup / repair (run once)*

That's it. The engine is live and will run nightly.

---

## Daily / weekly use

1. **Review new applications.** New rows arrive with a blank status. Read the
   application; set `status` to `accepted` to admit, or `declined` /
   `withdrawn` otherwise. (The nightly digest lists everyone awaiting review.)
2. **Read the proposals.** Look at the `Proposed Matches` tab. Each row has a
   fit percentage, the topic and focus sub-scores, the time-zone gap, and an
   `institution_flag` if the pair looks same-institution.
3. **Advance a pair.** When both sides are interested and the committee
   approves, change that row's `status` from `proposed` to `mutual-interest`,
   then `admin-approved` / `active` as you go. Those rows are then locked in -
   regeneration won't touch or duplicate them, and each one consumes one of
   the mentor's slots.
4. **Retire a pair.** Set a proposal's status to `declined` to stop it from
   being re-proposed on the next run.

### Sending blinded profiles (the applicant-facing step)

When a mentee (or mentor) should see their candidates:

1. In the **Proposed Matches** tab, click any row belonging to that person.
2. **Mentorship -> Send blinded profiles to MENTEE of selected row** (or the
   MENTOR variant).
3. The engine snapshots all of that person's `proposed` rows into an
   anonymized candidate set, mints a personal secret link, and emails it to
   them. The link opens **matches.html on the site** - blinded cards showing
   fit %, career stage, ranked topics, focus areas, languages, and time-zone
   gap. No names, affiliations, emails, or free text.
4. The applicant selects up to 3 candidates and submits. Their picks are
   written to the **Profile Links** tab (with viewed/responded timestamps)
   and the committee gets an email mapping each anonymous code back to the
   real pair, with a link to the Sheet.
5. When both sides of a pair have picked each other, set that row's status
   to `mutual-interest` and proceed as usual.

Re-sending to the same person refreshes their candidate set but keeps the
same link. Privacy note: the link is a capability URL - anyone holding it can
see that person's *anonymized* candidate set, which is why the payload never
includes identifying fields. Applicants are told not to forward it.

**Deployment requirement:** this feature adds a `doGet` function, which is
served through the web-app deployment. After pasting the updated
`matching_engine.gs`, you must also redeploy in place: **Deploy -> Manage
deployments -> edit (pencil) -> Version: New version -> Deploy**. Same URL,
new code. Until you do, matches.html links will show "This link isn't valid."

### Overrides you control from the Sheet

- **`Settings` tab** - every tunable number from ARCHITECTURE.md §4.7:
  scoring weights, the 50% hold threshold, the locality window, the 30-day
  escalation windows, how many candidates to propose per mentee, and
  `allow_same_institution` (set to `TRUE` to disable the institution filter
  for a run).
- **`Never Match` tab** - add two emails on a row to permanently bar a pairing
  (§6.8), e.g. a direct supervisor relationship.

---

## Lifecycle automation (the daily pipeline)

The nightly trigger runs a full pipeline, in this order:

0. **Pool bookkeeping.** Everyone with status `accepted` carries a
   `pool_entered_at` timer; it re-stamps automatically whenever someone
   (re-)enters the pool.
1. **Pool retirement.** People in an admin-approved or active pair get their
   applications-sheet `status` flipped to `matched-pending` (compact phase)
   or `matched` (active), with counterpart email(s) in `matched_with`.
   Mentors only retire when ALL their `mentor_slots` are consumed. This runs
   FIRST, so the matcher below never re-proposes someone who is taken.
2. **Mutual-interest detection.** When both sides' blinded-profile picks
   include the same pair, that Proposed Matches row flips to
   `mutual-interest` automatically. When picks collide (two mentees mutually
   matched to a one-slot mentor), the digest shows a fit-maximizing
   **suggested assignment** plus the conflicting alternates - approving stays
   a human decision: the committee sets the winning rows to `admin-approved`.
2b. **Round expiry (the 2-week window).** Blinded-profile rounds last
   `match_round_days` (default 14). When a round closes with no mutual match:
   - **Responders return to the pool** (`accepted`, fresh pool timer) and get
     an email explaining that no match came together this round and they can
     expect to hear back within 1-2 weeks. Candidates they responded to but
     did NOT pick become `declined` pairs (never re-proposed); the rest
     `expire` and may legitimately reappear in a future round.
   - **Non-responders are parked as `unresponsive`** and stay out of matching
     until an admin sets them back to `accepted` - or bans them by adding
     their email to the **Never Match** tab with the second column left blank
     (a single-email row is a full ban; two emails still bar just that pair).
3. **Compacts and activation.** Every `admin-approved` row automatically
   emails BOTH parties a personal compact-signing link
   (`compact.html?t=...`, view/sign tracked in the **Compacts** tab) plus a
   toolkit email (attaches `Mentor Toolkit.pdf` / `Mentee Toolkit.pdf` from a
   Drive folder named **Mentorship Toolkits** - create it once and drop the
   two PDFs in), and the row moves to `compact-sent`. The moment the second
   signature lands, the pair is **activated automatically**: intro email with
   real names to both, `match_start` stamped, row -> `active`. No committee
   action needed between "approved" and "introduced".
4. **Fresh match generation** on the reduced pool.
4b. **Automatic blinded-profile sends.** Everyone in the pool who received
   new proposals - mentees AND mentors - automatically gets their blinded
   candidates email the same run. That starts their 2-week round and moves
   their status to `reviewing-matches`, which excludes them from further
   match generation until the round resolves. Nobody is emailed daily: one
   send per round, one reminder at day 7. (The manual "Send blinded
   profiles" menu items still exist for re-sends and special cases; they
   plug into the same round machinery.)
5. **Reminders and stall flags.** One reminder email per artifact (blinded
   profiles, compact, survey) after `reminder_after_days` (default 7) with no
   response; anyone silent past `stalled_after_days` (default 14) appears in
   the digest under "UNRESPONSIVE 2+ WEEKS". Separately, anyone sitting in
   the pool `pool_wait_flag_days` (default 14) with nothing sent is flagged
   so admins can reach out with expected dates or hand-pick a
   below-threshold match (the held rows are visible in Proposed Matches).
6. **Surveys.** `checkin_after_days` (default 180) after `match_start`, both
   parties get the 6-month check-in (`survey.html`); at `closeout_after_days`
   (default 365), the 12-month closeout survey (questions from
   CLOSEOUT_SURVEY.md). Views, responses, and answers land in the **Surveys**
   tab (`answers_json`), and each response is also emailed to the committee.
7. **One digest email** covering all of it, with a direct link to the Sheet.

The Mentorship menu's "Run full daily pipeline now" does the same on demand.

**One-time setup for this feature set:** re-paste `matching_engine.gs`, run
`setupMentorshipSystem` (creates the Compacts and Surveys tabs, adds the
`matched_with` column, migrates headers), redeploy the web app in place, and
create the **Mentorship Toolkits** Drive folder with the two PDFs (named
exactly `Mentor Toolkit.pdf` and `Mentee Toolkit.pdf`).

**Status cheat-sheet (Proposed Matches):** `proposed` (generated) -> `sent`
(auto: profiles out, 2-week round running) -> `mutual-interest` (auto) ->
`admin-approved` (committee, the ONE manual gate) -> `compact-sent` (auto) ->
`active` (auto on both signatures) -> `completed` (committee, after the
closeout). Rounds that close without a mutual match leave rows as `expired`
(may be re-proposed later) or `declined` (a responder passed on the pair;
never re-proposed). `held-below-threshold` as before.

**Status cheat-sheet (applications sheet):** `submitted` (blank) ->
`accepted` (committee) -> `reviewing-matches` (auto, round running) -> back
to `accepted` (auto, round closed without a match) or `unresponsive` (auto,
no reply in 2 weeks; admin decides) -> `matched-pending` (auto, compact
phase) -> `matched` (auto, active pair). `declined`/`withdrawn` as before.

## Updating the engine later

Edit `apps_script/matching_engine.gs` in this repo, copy it, paste over the
`matching_engine` file in Apps Script, and Save. Re-run
`setupMentorshipSystem` if you changed anything about the tabs or triggers
(it's safe to re-run - it only adds what's missing and re-installs the
triggers). No web-app redeploy is needed; the matching functions run on the
time triggers and the menu, not through the web-app URL.

---

## Notes, limits, and honest caveats

- **Blinding.** This engine is the committee's back-office tool - it shows real
  names because the committee needs them. The public site still never reveals
  identities; unblinding to applicants remains a manual committee step. The
  `Proposed Matches` tab should not be shared outside the committee.
- **Scoring correction.** The original ARCHITECTURE.md §6.2 formula used a raw
  product of rank weights that capped every match well below the 50% threshold;
  the implementation and the doc now use the geometric mean so a perfect match
  scores 100%. See the correction note in §6.2.
- **Time zones.** Offsets use standard time; because the default window is a
  wide ±5 hours, DST drift of an hour doesn't change outcomes. Applicants who
  chose "Other" for time zone have an unknown offset and are allowed through
  the locality filter (marked `unknown`) rather than silently dropped - the
  committee should eyeball those.
- **Scale.** Nightly runs are O(mentees x mentors). Even a few hundred on each
  side is milliseconds of work and stays far inside Apps Script's 6-minute
  execution limit. If the program ever reaches thousands on both sides
  simultaneously, that's the point to move to the Airtable system in
  ARCHITECTURE.md (the provisioning script is already in the repo).
- **Email quota.** The digest is one email per run to one address - negligible.
  The applicant-confirmation emails from the form handler are the quota
  consideration (see SETUP.md).
- **Backups** are full-spreadsheet copies in your own Drive; 26 are kept and
  older ones are trashed (recoverable from Drive Trash for 30 more days).
