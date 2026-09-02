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
  flexible), and the same-institution filter - then assigns each mentee ONE
  best-fit mentor (earlier applicants keep a contested mentor unless beaten
  by more than the seniority buffer) and writes the pair to a
  **`Proposed Matches`** tab.
- It emails the committee a **digest**: pairs awaiting approval, compact
  progress, expirations, surveys, and anyone waiting too long in the pool.
- Every Monday (~4am) it copies the whole spreadsheet into a Drive folder
  **`ISEV-SNEV Mentorship Backups`**, keeping the most recent 26 copies
  (six months).

### This answers your re-matching question directly

Because matching **re-runs from scratch every night over the whole accepted
pool**, the "no suitable match today, but a good mentor joins next week"
case is handled automatically: the next run sees the new mentor and proposes
the pair. Nobody has to remember to re-assess. Pairs already advanced (to `admin-approved`, `compact-sent`, `active`, etc.)
are preserved across runs and never regenerated; only fresh `proposed` rows
are recomputed.
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
2. **Read the proposed pairs.** Look at the `Proposed Matches` tab. Each row
   has a fit percentage, the topic and focus sub-scores, the time-zone gap,
   and an `institution_flag` if the pair looks same-institution.
3. **Approve a pair** by changing its status from `proposed` to
   `admin-approved` (only during the review period - once
   `auto_send_compacts` is TRUE this happens automatically). Everything after
   that is hands-off: compacts, activation, introduction, surveys.
4. **Retire a pair.** Set a proposal's status to `declined` to stop it from
   being re-proposed on the next run.

### The one-to-one flow (how a match happens)

1. **The matcher assigns one pair.** Each nightly run pairs every pooled
   mentee with their single best-fit mentor. When two mentees contest the
   same mentor, the earlier applicant keeps them unless the later one's fit
   is more than `seniority_buffer_pct` (default 20) points higher. Pairs land
   in Proposed Matches as `proposed`.
2. **Approval.** While `auto_send_compacts` (Settings) is FALSE - the review
   period - the committee looks at each proposed pair and sets it to
   `admin-approved` by hand; the digest lists exactly what is waiting. Once
   you trust the matcher, set it to TRUE and fresh pairs are auto-approved
   with compacts sent the same night, no committee click.
3. **The compact IS the acceptance.** Both parties get a personal signing
   link (compact.html) showing a blinded summary of their match - fit %,
   career stage, ranked topics, focus areas, languages, time zone; never a
   name or affiliation - plus their toolkit email. Signing accepts the
   match. Views, signatures, and reminders are tracked in the Compacts tab.
4. **Activation.** The moment the second signature lands, the pair goes
   `active`, `match_start` is stamped, and the introduction email with real
   names goes to both. Surveys follow at 6 and 12 months.
5. **Expiry.** A compact unsigned after `compact_expiry_days` (default 14)
   expires the pair: whoever signed returns to the pool (fresh timer, an
   explanatory email); whoever didn't is parked as `unresponsive` until an
   admin re-accepts them or bans them (Never Match tab - a row with ONE
   email and the second column blank is a full ban; two emails still bar
   just that pair).

### Overrides you control from the Sheet


- **`Settings` tab** - every tunable knob: scoring weights, the 50% hold
  threshold, the locality window, the seniority buffer, the compact expiry
  and reminder windows, `auto_send_compacts` (the review-period gate), and
  `allow_same_institution`.
- **`Never Match` tab** - two emails on a row permanently bar that pairing;
  ONE email with the second column blank bans that address from matching
  entirely.

---


## The daily pipeline (order matters)

0. **Pool bookkeeping** - `pool_entered_at` timers stamp/reset automatically.
1. **Pool retirement** - people in approved/active pairs leave the pool
   (`matched-pending` / `matched`, counterpart in `matched_with`); mentors
   only when all `mentor_slots` are consumed.
2. **Compact expiry** - see above.
3. **Lifecycle** - compacts out for admin-approved pairs, activation + intro
   when both signed, one reminder per artifact after `reminder_after_days`,
   stall flags after `stalled_after_days`, 6/12-month surveys.
4. **Match generation** - one-to-one assignment on the reduced pool;
   below-threshold candidates are written as `held-below-threshold` for
   manual committee matching.
5. **Auto-approval** - only if `auto_send_compacts` is TRUE.
6. **Digest** - proposed pairs awaiting approval (or auto-approved list),
   compact expirations, activations, surveys, reminders, stalls, applicants
   waiting `pool_wait_flag_days`+ in the pool with nothing proposed, and
   parked unresponsive people, with a direct Sheet link.

**Status cheat-sheet (Proposed Matches):** `proposed` (matcher) ->
`admin-approved` (committee, or automatic once auto_send_compacts=TRUE) ->
`compact-sent` (auto) -> `active` (auto on both signatures) -> `completed`
(committee). `expired` = compact window lapsed (swept and re-matchable);
`declined` = permanently retired pair; `held-below-threshold` = visible for
manual matching.

**Status cheat-sheet (applications):** `submitted` (blank) -> `accepted`
(committee) -> `matched-pending` (auto, compact phase) -> `matched` (auto,
active) - or `unresponsive` (auto, didn't sign in time; admin decides).


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
