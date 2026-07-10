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

### Overrides you control from the Sheet

- **`Settings` tab** - every tunable number from ARCHITECTURE.md §4.7:
  scoring weights, the 50% hold threshold, the locality window, the 30-day
  escalation windows, how many candidates to propose per mentee, and
  `allow_same_institution` (set to `TRUE` to disable the institution filter
  for a run).
- **`Never Match` tab** - add two emails on a row to permanently bar a pairing
  (§6.8), e.g. a direct supervisor relationship.

---

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
