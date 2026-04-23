# ISEV–SNEV Mentorship Program — System Architecture

Version 0.2 · specification for build · April 2026

**Revision history.** 0.2 (2026-04-22) — incorporated review feedback:
capacity-aware mentor pool removal (§3.4, §4.1, §5.3, §6.1); cross-institution
conflict detection filter (§4.1, §4.2, §6.7, §10.3, §10.6); 30-day unmatched
escalation (§7); default hold on below-threshold matches (§7); refined hero
tagline (§12); canonical `Settings` table (§4.7); §16 resolutions captured.
0.1 (2026-04-22) — initial draft.

This document specifies the full target system for the ISEV–SNEV Mentorship
Program: data model, user flows, matching algorithm, signing, admin dashboard,
security, and a phased roadmap. It is the plan we will build against, not a
status report on what is built.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Components](#2-system-components)
3. [Canonical Taxonomies](#3-canonical-taxonomies)
4. [Data Model](#4-data-model)
5. [User Flows](#5-user-flows)
6. [Matching Algorithm](#6-matching-algorithm)
7. [Handling No-Match and Empty-Pool Cases](#7-handling-no-match-and-empty-pool-cases)
8. [Compact Signing (Dropbox Sign)](#8-compact-signing-dropbox-sign)
9. [Toolkit Delivery](#9-toolkit-delivery)
10. [Admin Interface](#10-admin-interface)
11. [Ad-Hoc and Re-Enrollment Flows](#11-ad-hoc-and-re-enrollment-flows)
12. [Language Changes](#12-language-changes)
13. [Security, Privacy, Data Retention](#13-security-privacy-data-retention)
14. [Cost Estimate](#14-cost-estimate)
15. [Implementation Roadmap](#15-implementation-roadmap)
16. [Open Questions and Inputs Needed](#16-open-questions-and-inputs-needed)
17. [Glossary](#17-glossary)

---

## 1. Executive Summary

The system pairs mentors and mentees in the extracellular-vesicle research
community for 12-month professional-development relationships. Applicants
complete a standardized form; a joint ISEV–SNEV committee reviews applications
and generates 1–3 blinded candidate matches based on locality (± 5 h time
zone), ranked topic-area preferences, and secondary focus-area overlap. Both
sides select mutual interest from blinded profiles; the committee re-confirms
and triggers electronic signing of the Mentorship Program Compact. After both
parties sign, both the mentor and mentee toolkits are automatically delivered
and the pair is marked active for 12 months. Admin staff have a dashboard
covering all applicants, proposed matches, active pairs, and graduates, with
bulk-email, status tracking, ad-hoc pairing, and mentor re-enrollment tools.

The system is built from three services stitched together: a static public
website (GitHub Pages) for the landing page and application form; an Airtable
base with Interface Designer for the data layer, admin dashboard, and email
automations; and Dropbox Sign for compact signatures. There is no bespoke
backend to operate — everything runs on managed SaaS. Estimated recurring
cost is roughly US$40–70 per month for modest volume.

The deliberately boring architecture is the point. It puts all custom logic
in Airtable formulas and automations that a non-engineer committee member can
inspect and edit, and keeps the public site trivially redeployable from
GitHub. The trade-off is scale: this works comfortably up to a few hundred
applicants per cycle and a few thousand total records. Beyond that, we would
migrate the data layer to a real database and keep the rest.

---

## 2. System Components

| Component | Purpose | Who owns it |
|---|---|---|
| **Public website** (GitHub Pages) | Landing page, application form, prototype/preview | ISEV–SNEV GitHub org |
| **Airtable base** | Applicants, matches, taxonomies, statuses, history | ISEV–SNEV Airtable account |
| **Airtable Interfaces** | Admin dashboard, match review, ad-hoc pairing, bulk email | Same base |
| **Airtable Automations** | Emails, match generation, reminders, webhooks | Same base |
| **Dropbox Sign** | Compact template, signing flow, audit trail, webhook | ISEV–SNEV Dropbox Sign account |
| **Apps Script or Cloudflare Worker** (light) | Thin proxy: accepts POST from the form, writes to Airtable via API | ISEV–SNEV Google or Cloudflare account |
| **Mail** | Automation-generated emails to applicants/admin | Airtable default sender; optionally custom domain |

Data-flow summary:

```
  apply.html (static, GitHub Pages)
        │   HTTPS POST (JSON)
        ▼
  Apps Script / Cloudflare Worker  ──────►  Airtable API
                                                   │
                                                   ▼
                                            Airtable base
                                            (applicants, matches)
                                                   │
                       ┌───────────────────────────┼──────────────────┐
                       ▼                           ▼                  ▼
              Airtable Automations           Admin Interfaces    Dropbox Sign
              (emails, match runs)          (Interface Designer) (compact signing)
                       │
                       ▼
              Mentor / Mentee inboxes
```

No participant data touches GitHub; the public site is a thin shell that only
sends POST requests outward.

---

## 3. Canonical Taxonomies

Free-text fields are being replaced with standardized, closed vocabularies so
the matching algorithm can compare candidates reliably and reporting is
consistent across cycles.

### 3.1 Mentorship topic areas (ranked)

Applicants select and **rank their top 3** topic areas from this list. Mentors
select what they are **willing and able to mentor on** (unranked multi-select).
The ranking is the primary matching signal after locality.

1. Career transition (e.g., postdoc → faculty, academia → industry, industry → academia)
2. Industry career advancement
3. Academic career advancement (grants, tenure, lab building)
4. Grant writing and fellowship applications
5. Professional networking and relationship-building
6. Job search strategy and interviewing
7. Communication, presentation, and public speaking
8. Leadership, management, and team-building
9. Long-term career trajectory and goal setting
10. Work–life integration and wellbeing
11. Navigating underrepresentation / DEI in STEM
12. Publishing strategy (authorship, journal selection, peer review)
13. Mentoring and supervising others
14. International career moves and relocation

This list is the canonical one. Adding or renaming items requires a migration
plan because historical applications reference the old values.

### 3.2 EV research focus areas (multi-select, unranked)

A secondary matching signal used only within the topic-area filter. Applicants
and mentors tag any that apply.

- EV biology and biogenesis
- EV biomarkers
- EV therapeutics and delivery
- EV imaging and single-vesicle characterization
- EV proteomics / lipidomics / nucleic acids
- EVs in neurodegeneration
- EVs in cancer
- EVs in infectious disease
- EVs in cardiovascular disease
- EVs in reproductive biology
- EVs in immunology and inflammation
- EVs in development and regeneration
- EV isolation and purification methods
- EV standardization and MISEV guidelines
- Other (free text)

### 3.3 Time zone (single-select)

IANA time-zone identifiers grouped by region, with common aliases. Ten most
frequent shown first; remainder grouped under "All regions" dropdowns. We store
the IANA name (e.g., `America/Los_Angeles`) and, via a formula field, the
current UTC offset (e.g., `-7`) used by the matching filter.

### 3.4 Status taxonomies

Application status (Applicants table):

- `submitted` · received but not reviewed
- `accepted` · admitted to the pool, has remaining mentor slots or is an
  unmatched mentee
- `declined` · not admitted (with reason)
- `withdrawn` · applicant withdrew
- `matched` · fully allocated — mentee has a match, or mentor's capacity is
  filled. Hidden from matching.
- `graduated` · completed a 12-month cycle
- `re-enrollable` · graduate asked if they want another cycle

**Mentor capacity rule.** Mentors declare a support level of 1, 2, or 3
mentees at a time (§4.1 `mentor_capacity`). Their `active_match_count`
formula field counts matches with status in `{admin-approved, compact-sent,
compact-signed, active}`. A mentor remains `accepted` and visible in the
matching pool as long as `active_match_count < mentor_capacity`. Only when
capacity is fully allocated does their status flip to `matched`. Matches
completing (or terminating early) decrement the count and can return the
mentor to `accepted`.

Match status (Matches table):

- `proposed` · algorithm generated, both sides notified
- `mutual-interest` · both sides selected each other
- `admin-approved` · committee approved the mutual match
- `compact-sent` · Dropbox Sign requests dispatched
- `compact-signed` · both parties signed
- `active` · toolkits delivered, clock running
- `completed` · 12 months elapsed, normal close
- `terminated-early` · either party withdrew (reason captured)

---

## 4. Data Model

Airtable base with five core tables. Field names are the implementation names.

### 4.1 `Applicants`

| Field | Type | Notes |
|---|---|---|
| `application_id` | Autonumber | Primary key |
| `role` | Single-select | `mentor` \| `mentee` |
| `status` | Single-select | See §3.4 |
| `full_name` | Text | Private |
| `email` | Email | Private |
| `affiliation` | Text | Private |
| `affiliation_normalized` | Formula | Lowercased, stripped of punctuation and common words ("university", "institute", "the", "of"). Used by the cross-institution filter (§6.7). |
| `email_domain` | Formula | Lowercased text after `@`. Used by the cross-institution filter. |
| `country` | Text | Partial-private (region shown on blinded cards) |
| `timezone` | Single-select | IANA name |
| `utc_offset` | Formula | Derived numeric offset, updated daily |
| `languages` | Multi-select | From a small curated list |
| `career_stage` | Single-select | Grad student / postdoc / staff / PI / etc. |
| `membership` | Single-select | ISEV only / SNEV only / both / neither |
| `topic_rank_1` | Single-select | From §3.1 |
| `topic_rank_2` | Single-select | From §3.1 |
| `topic_rank_3` | Single-select | From §3.1 |
| `topic_offered` | Multi-select | Mentor only (§3.1 unranked) |
| `focus_areas` | Multi-select | §3.2 |
| `short_bio` | Long text | Shown on blinded card (scrubbed by admin if needed) |
| `goals_summary` | Long text | Blinded card |
| `meeting_frequency_pref` | Single-select | Bi-monthly / monthly / quarterly |
| `availability_windows` | Multi-select | Weekday AM/PM/EVE/weekends |
| `mentor_capacity` | Number | Mentor only: support level of 1, 2, or 3 mentees at a time |
| `active_match_count` | Formula | Count of linked `Matches` with status in `{admin-approved, compact-sent, compact-signed, active}` |
| `slots_remaining` | Formula | For mentors: `mentor_capacity - active_match_count`. For mentees: `1 - active_match_count`. Drives pool removal — when this hits 0 and status isn't already `matched`, an automation flips the status. |
| `prof_dev_ack` | Checkbox | "I understand this is professional development, not technical research advice" |
| `consent_*` | Checkbox × 3 | Existing consent boxes |
| `submitted_at` | Created time | |
| `accepted_at` | Date | Filled on admin accept |
| `cycle_label` | Text | e.g., "Spring 2026" |
| `private_notes` | Long text | Admin-only |

### 4.2 `Matches`

| Field | Type | Notes |
|---|---|---|
| `match_id` | Autonumber | Primary key |
| `mentor` | Link → Applicants | Cardinality: 1 |
| `mentee` | Link → Applicants | Cardinality: 1 |
| `status` | Single-select | See §3.4 |
| `score_total` | Number | Computed (§6) |
| `score_topic_overlap` | Number | |
| `score_focus_overlap` | Number | |
| `score_timezone_delta_hours` | Number | |
| `institution_conflict` | Formula | True when mentor and mentee share a normalized affiliation string, share a non-consumer email domain, or are flagged by the fuzzy-match script. Soft warning — admin can override. |
| `admin_generated` | Checkbox | True when admin created the match ad-hoc (§10.6). Skips mutual-interest gate. |
| `mentor_selected` | Checkbox | Mentor picked this mentee |
| `mentee_selected` | Checkbox | Mentee picked this mentor |
| `proposed_at` | Date | When generated |
| `admin_approved_at` | Date | Triggers signing |
| `dropbox_sign_request_id` | Text | From Dropbox Sign API |
| `compact_signed_at` | Date | Both parties |
| `toolkits_sent_at` | Date | |
| `start_date` | Date | = `compact_signed_at` |
| `end_date` | Formula | `start_date + 12 months` |
| `completed_at` | Date | Normal close |
| `terminated_at` | Date | Early termination |
| `termination_reason` | Long text | |
| `admin_notes` | Long text | |

### 4.3 `Topic Areas` (lookup table)

The §3.1 list as records, so the dropdown stays consistent and metadata (short
description, common synonyms for search) lives in one place.

### 4.4 `Focus Areas` (lookup table)

The §3.2 list as records.

### 4.5 `Time Zones` (lookup table)

IANA name, human label, current UTC offset (refreshed by a weekly automation),
sort order.

### 4.6 `Audit Log` (optional but recommended)

Captures admin actions: application acceptances, match approvals, manual
overrides, terminations. Useful for program evaluation and dispute resolution
(ref. compact §7 Dispute Resolution).

### 4.7 `Settings` (single-row config table)

All tunable knobs live in a one-row table the admin can edit:

| Field | Default | Purpose |
|---|---|---|
| `weight_topic_overlap` | 0.70 | Score weight in §6.4 |
| `weight_focus_overlap` | 0.30 | Score weight in §6.4 |
| `locality_window_hours` | 5 | Hard filter radius in §6.1 |
| `allow_same_institution` | false | Bypasses §6.7 when true |
| `consumer_email_domains` | `gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, proton.me, protonmail.com` | Excluded from domain-match heuristic |
| `match_threshold_percent` | 50 | Below this, auto-hold (§7) |
| `mentor_unfilled_escalation_days` | 30 | §7 escalation trigger |
| `unmatched_mentee_escalation_days` | 30 | Mirror for mentees |
| `compact_reminder_days` | 7, 10, 13 | Dropbox Sign reminder cadence |
| `compact_expiration_days` | 14 | §8.3 |
| `cycle_label_default` | `Spring 2026` | Filled into new Applicants records |

---

## 5. User Flows

### 5.1 Applicant flow (mentee or mentor)

1. Applicant lands on `index.html`, clicks Apply.
2. `apply.html` presents the full form. After choosing a role, they pick and
   **rank their top 3 topic areas**, tag focus areas, select their time zone
   from a dropdown, acknowledge the professional-development framing, consent
   to review and unblinding, and submit.
3. A thin Cloudflare Worker / Apps Script endpoint receives the JSON, validates
   it, and writes a record to `Applicants` with status `submitted`.
4. Applicant sees the confirmation screen and gets an automated
   acknowledgement email within a minute: "We received your application;
   expect a response within two weeks."
5. Committee reviews applications in the Airtable dashboard. On accept
   (`status → accepted`), an automation emails the applicant: "You're in the
   pool. We'll send candidate matches within X weeks."
6. When the matching run produces candidates for this applicant, an
   automation emails them a link (unique per applicant, token-based) to a
   **blinded candidate view** showing 1–3 anonymized profiles with fit scores.
7. Applicant marks which candidates they'd like to proceed with. Their
   selections update `mentor_selected`/`mentee_selected` on each Match record.
8. If a counterpart also selects them → `status → mutual-interest`, admin is
   notified (§5.3).
9. After admin approves and both parties sign the compact, applicant gets an
   email: "Your match with [real name] is confirmed. Toolkit attached. Kickoff
   guidance follows."
10. 12 months later, an automation sends a close-out survey and marks the
    match `completed`. The mentor's application moves to `re-enrollable`
    state (see §11).

### 5.2 Blinded candidate view

The applicant's unique email link leads to a page with candidate cards that
show: anonymous code (e.g., `M-A417`), career stage, region (not country),
time-zone offset, their ranked topic areas, focus areas, short bio, goals
summary, and a fit score. Names, exact affiliations, and photos are redacted.
Applicant clicks "I'd like to pursue this match" or "Not a good fit."

This page reads match records filtered by the applicant's token. We implement
it one of two ways (final choice in Phase 1):

- **(a) Airtable Portal**: use Softr or Airtable's own sharable Interface
  (logged-in Airtable account required — unlikely to work for applicants).
- **(b) Static token page**: applicant's link contains a signed token.
  A Cloudflare Worker reads the token, fetches the matches from the Airtable
  API, and renders HTML. Recommended — keeps applicants out of Airtable
  entirely.

### 5.3 Admin review and approval flow

1. Admin opens the Airtable Interface "Proposed Matches" view.
2. Each row shows mentor code, mentee code, score, and per-side selections.
3. When a row reaches `mutual-interest`, it lights up. Admin opens detail,
   reads both profiles (unblinded for admins), writes any notes, and clicks
   **Approve**.
4. `Approve` sets `admin_approved_at` and triggers:
   - Automation → Dropbox Sign API creates a signature request from the
     compact template, pre-filled with mentor and mentee names and emails.
   - Match `status → compact-sent`.
5. Both parties receive a Dropbox Sign email. They click to sign the compact.
6. When both have signed, a Dropbox Sign webhook fires to an Automation
   endpoint. The automation sets `compact_signed_at`, triggers toolkit
   delivery, and flips match `status → active`. The mentee's applicant
   status flips to `matched`. The mentor's applicant status flips to
   `matched` **only if this new pairing exhausts their capacity**
   (`active_match_count == mentor_capacity`); otherwise the mentor stays
   `accepted` and remains in the pool for their remaining slots.

### 5.4 Active relationship and close-out

- No routine system intervention between sign and close (the mentorship is
  between the two humans).
- At month 6 and month 11, automations send a short check-in email to both
  parties: "How's it going? Any issues to flag to the committee?"
- At month 12, a close-out survey goes out. `status → completed`. The mentor
  enters the `re-enrollable` pool.

---

## 6. Matching Algorithm

Matching runs nightly (or on-demand from the admin dashboard) and writes
proposed Match records. For each unmatched `accepted` applicant in the pool:

### 6.1 Eligibility filters (applied in order)

1. **Pool membership.** Candidate must have status `accepted` and
   `slots_remaining > 0`. A mentor with `mentor_capacity = 3` and one active
   pairing still has two slots open and remains eligible.
2. **Locality.** Compute the absolute UTC-offset difference between the
   applicant and the candidate. Discard any candidate whose offset differs by
   more than 5 hours. Hard filter, not a score component.
3. **Cross-institution** (soft filter — default on, admin-overridable per-run
   via a Settings toggle). See §6.7.
4. **Never-match list** (§6.8).

Candidates who pass all four filters are scored; the rest are discarded for
this run.

### 6.2 Topic-area score (primary)

Each side has ranks. The mentee supplied ranks 1/2/3 from §3.1. The mentor
supplied an unranked set of topics they're willing to mentor on.

For each mentee rank position, compute a contribution:

| Mentee rank | Weight if mentor offers this topic |
|---|---|
| 1 | 0.50 |
| 2 | 0.30 |
| 3 | 0.20 |

`score_topic_overlap` = sum of contributions where the mentor offered the
mentee's ranked topic (range 0.00–1.00).

Symmetry note: mentors don't rank preferences, so for mentor-initiated queries
we compute the same score from the mentee's side.

### 6.3 Focus-area score (secondary)

Jaccard similarity on focus-area tags:

`score_focus_overlap` = |intersection| / |union| (range 0.00–1.00).

### 6.4 Total score

`score_total` = `0.70 × score_topic_overlap + 0.30 × score_focus_overlap`

Expressed as a percentage on cards: `round(score_total * 100)`%.

Tunable weights live in a small Airtable `Settings` table so the committee can
re-weight without code changes.

### 6.5 Candidate selection

Among candidates who pass all eligibility filters (§6.1), sort by
`score_total` descending. Take up to the top three. If two candidates tie and
a tiebreaker is needed, prefer the smaller `|offset_delta|`, then the
candidate with more `slots_remaining` (so we balance mentor load), then
alphabetical order of `application_id`.

### 6.6 Regeneration triggers

- Nightly cron (Airtable automation).
- Admin "Regenerate matches" button on the Applicant detail page.
- When a counterpart of the right role newly joins the pool, the automation
  re-runs for any applicant who currently has fewer than three candidates.

### 6.7 Cross-institution filter

Same-institution pairings are usually undesirable (the goal is external
perspective). We detect likely same-institution pairs using three heuristics;
any one of them trips the flag:

1. **Normalized affiliation match.** Lowercase both sides, strip punctuation
   and common filler words ("university of", "institute", "the", "school of",
   "dept", commas, ampersands). If the resulting strings are equal — or if
   one is a substring of the other with length ≥ 8 characters — flag.
2. **Email domain match.** Compare `email_domain` fields. If both sides
   share a domain and that domain is **not** on a small allow-list of
   consumer providers (`gmail.com`, `outlook.com`, `hotmail.com`,
   `yahoo.com`, `icloud.com`, `proton.me`, `protonmail.com`), flag.
3. **Fuzzy match.** Compute Levenshtein distance between normalized
   affiliations. If the ratio of distance to the longer string is below
   0.20, flag. (Catches "Karolinska Institutet" vs "Karolinska Institute"
   and "UCSF" vs "U.C.S.F.".)

This logic runs in the Airtable Automation script that generates matches;
results are written to the `institution_conflict` formula on the Match
record.

**Behaviour.** By default, flagged pairs are excluded from the candidate set
entirely (the applicant never sees them). A Setting (`allow_same_institution`)
can be toggled on if admin knows the conflict is fine — useful for large
institutions where the mentor and mentee are in unrelated departments. Admin
can also create an ad-hoc match (§10.6) that bypasses the filter; in that
case the warning is shown on the approval screen and must be explicitly
acknowledged.

**Known limitations.** This catches the common case but is not foolproof.
People use personal emails; institutions have multiple names ("MGH" vs
"Massachusetts General Hospital"); hospital networks share domains across
unrelated units. Admin remains the final check.

### 6.8 Never-match list

Admin can manually add a specific applicant pair to a `never_match` list
(e.g., direct line-management conflict, prior difficult history). The
matcher excludes these regardless of other scores.

---

## 7. Handling No-Match and Empty-Pool Cases

**Zero counterparts available.** The applicant is accepted into the pool;
their dashboard email says: "You're accepted. The pool is thin for your
region/topic right now — we'll match you as soon as a suitable counterpart
joins." An Airtable view surfaces these applicants to admin as **Awaiting
counterpart**.

**Fewer than three matches pass the filter.** Send the available one or two.
An admin-only flag on the applicant's row notes "Thin candidate pool — watch
for new mentors."

**Best score below 50%.** A formula on the Match record flags it as
`below_threshold`. The default behaviour is **hold and wait for the next pool
refresh** — the algorithm does not surface the match to the applicant. Admin
can override by using the ad-hoc pairing UI (§11) to propose a
close-but-imperfect match with an explanatory note attached, at which point
the match enters the normal approval and signing flow.

**Mentor has no suitable mentee.** Mirror: "Thank you for volunteering; the
mentee pool in your region/focus is thin. We'll be back in touch soon." Show
this applicant under **Awaiting counterpart** too.

**Mentor has unfilled slots after 30 days.** Automation escalates to admin:
"Mentor [code] has [N] unfilled slot(s) after 30 days in the pool. Consider
broader matching criteria, ad-hoc pairing, or a personal outreach." The same
escalation fires for mentees who have sat in the pool 30 days without a
proposed match.

---

## 8. Compact Signing (Dropbox Sign)

The compact PDF supplied by the committee is converted into a **reusable
template** in Dropbox Sign. Two signer roles are defined: `Mentor` and
`Mentee`. Pre-fill fields include both names, the program cycle label, and
the start date (today). Both signer fields and the date field are required.

### 8.1 Sending a request

On admin approval, an Airtable Automation runs a small script step that:

1. Reads the Match record (mentor and mentee emails/names).
2. POSTs to Dropbox Sign `/signature_request/send_with_template` with the
   template ID and the two signer email/name pairs.
3. Stores the returned `signature_request_id` in the Match record.
4. Updates match `status → compact-sent`.

### 8.2 Receiving signed documents

Dropbox Sign sends webhook events (`signature_request_all_signed`) to a small
endpoint (Cloudflare Worker or Apps Script) that:

1. Validates the webhook HMAC signature.
2. Finds the matching Match record by `signature_request_id`.
3. Downloads the completed PDF and attaches it to the Match record (or stores
   a Dropbox Sign archive link).
4. Sets `compact_signed_at`, flips `status → compact-signed`.
5. Kicks the toolkit delivery automation (§9).

### 8.3 Failure modes

- **One party doesn't sign within 14 days.** Automation sends a reminder to
  the non-signer at day 7, day 10, and day 13. On day 14 the request expires
  and the match rolls back to `admin-approved` for admin to decide whether
  to re-send, rematch, or terminate.
- **Party explicitly declines in Dropbox Sign.** Webhook flips
  `status → terminated-early`, admin notified to regenerate matches for the
  remaining participant.

### 8.4 Legal posture

The compact is a program-expectations document, not a binding contract.
Dropbox Sign is sufficient — electronic signature is legally recognized under
the U.S. ESIGN Act and EU eIDAS for this use, and Dropbox Sign produces an
audit trail that satisfies the committee's recordkeeping needs. We do not
need anything heavier (e.g., notarization, witness signatures).

---

## 9. Toolkit Delivery

On `status → active`, an Airtable Automation sends two emails:

- **Mentor email** — personalized, attaches `MentorToolkit.pdf` from the
  Airtable attachment field on a `Resources` record (or links to a Google
  Drive viewer link). Body: kickoff agenda, link to the signed compact, link
  to the first-meeting checklist.
- **Mentee email** — symmetric, attaches `MenteeToolkit.pdf`.

The toolkit PDFs are uploaded to the `Resources` table once by admin. Updating
a toolkit means uploading a new version to Airtable — no site redeploy needed.

`toolkits_sent_at` is stamped on the Match record for reporting.

---

## 10. Admin Interface

Built in **Airtable Interface Designer** against the base. Pages:

### 10.1 Home

Counts and charts: applications this cycle, in-pool counts by role, proposed
matches awaiting review, active pairs, graduations this month.

### 10.2 Applications

Full list with quick-filter (pending / accepted / declined / withdrawn). Row
actions: Accept, Decline, Request more info. Detail view shows all fields;
admin can edit `private_notes` and `cycle_label`.

### 10.3 Proposed Matches

Kanban by status. `mutual-interest` column gets an **Approve** button that
triggers the signing flow. Score badges on each card. If
`institution_conflict` is true (§6.7), the card shows a yellow warning chip
and the Approve button requires explicit acknowledgement ("I've verified
these two are in unrelated units of the same institution — proceed").

### 10.4 Active Pairs

Table of all pairs with live status columns: compact signed? toolkits sent?
start date, end date (computed), days remaining. Inline **Terminate early**
and **Add note** controls.

### 10.5 Bulk email

Filter the Active Pairs or Graduates views, select rows, click Email. Airtable
has a built-in send-email-to-selected action. Body templates:

- "Check-in: how's your mentorship going?"
- "Final survey"
- "We're running another cycle — interested in mentoring again?"

### 10.6 Ad-hoc pairing

Two-pane view: left lists unmatched mentees, right lists mentors with
`slots_remaining > 0`. Admin selects one from each side, clicks **Pair**. A
scripted action creates a `proposed` Match with `admin_generated: true` so it
skips the normal mutual-interest gate — both sides get an email saying the
committee proposes this match; normal signing flow follows. The pairing
screen computes and displays the same score and cross-institution warning
as the algorithmic flow, so admin can see why the algorithm didn't surface
the pair and decide whether to proceed anyway. Ad-hoc pairs that cross the
institution filter require the same explicit acknowledgement as in §10.3.

### 10.7 Re-enrollment queue

View of `graduated` mentors whose engagement ended more than 30 days ago.
Checkbox column "Re-opened for matching" with an **Invite** button that
emails: "Would you like to mentor another cycle?" Responses update their
status back to `accepted`.

### 10.8 Taxonomy editors

Interfaces for the `Topic Areas`, `Focus Areas`, `Time Zones`, and `Settings`
tables so admin can tune weights and update the vocabulary without
engineering help.

---

## 11. Ad-Hoc and Re-Enrollment Flows

Ad-hoc pairing is described in §10.6. The re-enrollment flow works like this:

1. Match ends at month 12; automation marks match `completed` and sets a
   30-day cooldown.
2. At day 30 post-completion, the mentor record flips to `re-enrollable` and
   appears in the §10.7 queue.
3. Admin clicks Invite. Email: "Would you like to mentor another mentee in
   the next cycle? Your existing profile is on file." Two buttons (mailto
   links or Airtable form responses) — Yes, re-open me / No, thanks for the
   invitation.
4. Yes → status `accepted`, profile goes back into the matching pool with
   the next cycle label.
5. The mentor can update their profile before re-entering (pre-fill a form
   with their prior answers).

Mentees follow the same flow but default to "not re-enrollable" — the
program is not intended as a recurring service for the same mentee.

---

## 12. Language Changes

A single language pass tightens the messaging that the program is professional
development, not technical research advice. Specific edits:

| Location | Before | After |
|---|---|---|
| Hero tagline | "Mentorship that actually fits." | "Professional development mentorship tailored to the EV field." |
| Hero lede | "…based on training goals, career stage…" | "…based on career-development goals, career stage…" |
| About | "training goals" × N | "professional-development goals" |
| Eligibility (mentee) | "…navigating a postdoc move" | "…navigating a postdoc move. The program supports career and professional growth, not project-specific technical guidance." |
| FAQ | New item: "Is this for technical research advice?" | "No. This program supports career development — networking, career transitions, leadership, grant writing, communication. For technical guidance on specific experiments, please use your lab mentors and peer networks." |
| Apply (step 4 mentee header) | "What you're hoping to get out of mentorship" | "Professional-development goals" |
| Apply consent | (new checkbox) | "I understand this program is for professional development and not for direct scientific or technical advice on specific experiments or projects." |
| Prototype narrative | "Your mentor" | "Your professional-development mentor" |
| All "six months" | "six months" / "6 months" | "12 months" |
| Apply availability | "Monthly (1 hr)" first option | "Bi-monthly (every other month)" first option, aligning with the compact |
| Apply help text | "~1 hr/month for 6 months" | "~1 hour every other month for 12 months" |

Also add a prominent "Have a question?" button on `apply.html` that opens a
mailto link to the committee address with a pre-filled subject.

---

## 13. Security, Privacy, Data Retention

### 13.1 Confidentiality

The compact §4 binds mentor and mentee to confidentiality of shared
information. The program committee is held to the same standard.

### 13.2 Data at rest

- **Airtable**: enterprise-grade encryption at rest. Only committee members
  with Airtable user accounts can access the base. Roles: Admin (all edit),
  Reviewer (read + match review, no taxonomy editing), Viewer (read-only for
  trainees or rotating committee observers).
- **Dropbox Sign**: signed PDFs stored in Dropbox Sign's archive + mirrored
  as Airtable attachments on the Match record.
- **GitHub**: public repo contains only non-sensitive static code. No
  personal data.

### 13.3 Data in transit

Everything is HTTPS. The form endpoint uses TLS. Dropbox Sign webhooks are
HMAC-signed.

### 13.4 Access control

- 2-Step Verification required for every committee Airtable account and the
  Google/Cloudflare account running the webhook proxy.
- Quarterly access review: remove accounts for committee members who rotated
  off.
- Principle of least privilege on Dropbox Sign (only the automation account
  has API-key access).

### 13.5 Privacy notice

A short notice linked from `apply.html`:

- What we collect (form fields).
- How it is used (matching, program administration, automated emails).
- Who can see it (ISEV–SNEV matching committee and the named counterpart
  after mutual selection and admin approval).
- How long we keep it (see retention, below).
- How to request correction or deletion (committee email).

### 13.6 Retention

- **Active applications and matches**: retained for the cycle duration plus
  24 months for program-evaluation reporting.
- **After retention window**: applicant personal fields are scrubbed
  (name, email, affiliation) but de-identified records (role, timezone
  bucket, topic ranks, match score, duration) are retained indefinitely for
  program effectiveness analysis.
- **Signed compacts**: retained for 6 years (conservative policy for any
  dispute resolution under compact §7).
- **Withdrawn / declined applications**: purged after 6 months.

### 13.7 Audit trail

Admin actions (accept, decline, approve, terminate, manual override) are
logged in the Audit Log table with timestamp and acting account.

---

## 14. Cost Estimate

Recurring (monthly):

| Item | Plan | Cost |
|---|---|---|
| Airtable Team plan | Required for Interface Designer + sync + scripting | ~$20/user/month |
| Dropbox Sign Standard | 3 senders, API, templates | ~$25/month |
| Cloudflare (Workers) | Free tier sufficient for webhook proxy | $0 |
| GitHub Pages | Public repo | $0 |
| Google Workspace (if using Gmail sending) | N/A — use Airtable email | $0 |
| Domain (optional) | e.g. `mentorship.isev.org` | ~$1–2/month amortized |
| **Total** | | **~$45–70/month** |

One-time setup effort (not dollars, but hours): roughly 30–50 hours of
engineering and content work to implement the roadmap below.

Scale note: Airtable's per-base record limit on Team plan is 50,000 records.
At a few hundred applicants per cycle we're comfortably within that for a
decade.

---

## 15. Implementation Roadmap

Six phases, each with a clear deliverable and test criterion. Phases can run
in parallel where dependencies allow; I've listed them in the order I'd
suggest tackling them.

### Phase 0 — Content and language pass (1–2 days)

- Apply every edit in §12 to `index.html`, `apply.html`, `prototype.html`.
- Add the "Have a question?" admin-email button on `apply.html`.
- Add the professional-development acknowledgement checkbox to the apply
  form's consent section.
- Replace free-text training goals with ranked topic areas and focus-area
  multi-select. Add time-zone dropdown.
- Update FAQ with the "not for technical advice" item.

Deliverable: refreshed static site, form still posts to the existing Apps
Script for now (backward compatible).

Test: full read-through by committee; form submit still works.

### Phase 1 — Airtable base + taxonomies (2–3 days)

- Create Airtable base, all five tables per §4.
- Populate `Topic Areas`, `Focus Areas`, `Time Zones`, `Settings` lookup tables.
- Build a temporary "Applicants" form in Airtable (we won't use it publicly)
  just to test the schema.
- Configure team access roles.

Deliverable: the base, documented in `AIRTABLE.md`.

Test: admin can create a sample applicant and see all fields behave.

### Phase 2 — Form → Airtable pipeline (1–2 days)

- Write a Cloudflare Worker (or replace the Apps Script) that accepts form
  POSTs, validates, and writes to Airtable via the API.
- Swap `apply.html`'s action URL to the new endpoint.
- Retire the current Google Sheet path (or keep as a read-only mirror for a
  few cycles).

Deliverable: live form submits land in Airtable's Applicants table.

Test: submit five test applications, verify all fields populate correctly;
verify that malformed submissions are rejected.

### Phase 3 — Admin dashboard (3–5 days)

- Build Interface Designer pages per §10 (Home, Applications, Proposed
  Matches, Active Pairs, Ad-hoc, Re-enrollment).
- Configure the Accept/Decline/Approve automations and their emails.
- Wire up bulk-email templates.

Deliverable: admins can run the whole review-and-approve flow for applications
and for manually-generated matches.

Test: admin walks through a hypothetical cycle with 5 applicants of each
role, approving matches end-to-end (signing flow still stubbed).

### Phase 4 — Matching algorithm (2–3 days)

- Nightly Automation script per §6.
- Regenerate button on applicant detail view.
- Thin Cloudflare Worker that renders the applicant's unique blinded-match
  page from a token.
- Applicant-selection round-trip.

Deliverable: applicants receive candidate match emails and can record their
picks; mutual-interest matches surface in the admin queue.

Test: run a synthetic cycle with 10 mentors and 15 mentees, confirm match
distribution looks sensible; sanity-check edge cases (thin pool, ties,
below-threshold).

### Phase 5 — Dropbox Sign integration (2–3 days)

- Upload the compact to Dropbox Sign as a template with two signer roles.
- Admin Approve automation → Dropbox Sign API.
- Webhook endpoint back to Airtable.
- Reminder automations and failure-mode handling (§8.3).

Deliverable: admin-approved matches trigger signature requests; fully signed
matches flip to compact-signed automatically.

Test: end-to-end run with a test mentor and mentee, including the case where
one signer delays past a reminder threshold.

### Phase 6 — Toolkit delivery, reminders, close-out (1–2 days)

- Toolkit PDFs uploaded to `Resources`.
- `compact-signed` → active automation sends toolkit emails.
- Month-6 and month-11 check-in automations.
- Month-12 close-out survey and re-enrollment flow.

Deliverable: full end-to-end lifecycle from application to graduation runs on
its own.

Test: synthetic end-to-end run using Airtable's time simulation (manually
adjusting dates).

### Phase 7 — Production launch (1 day)

- Privacy notice live.
- Committee training (1-hour walkthrough + recorded screencast).
- Soft-launch with the first real cohort, capped at a manageable size.
- Post-launch monitoring: check automation logs daily for the first two
  weeks.

Deliverable: program in production.

**Total estimated calendar time if one person is working on it: ~4 weeks.**
In practice, allow 6–8 weeks with normal review cycles, content writing, and
stakeholder sign-off.

---

## 16. Open Questions and Inputs Needed

Resolved during the 2026-04-22 spec review (most items settled; a few
deferred to implementation time):

| # | Item | Status |
|---|---|---|
| 1 | Mentor and mentee toolkit PDFs | Pending upload. User will provide when Phase 6 begins. |
| 2 | Committee email for admin notifications | **isevmentorship@gmail.com** |
| 3 | Airtable seat count | 2–3 seats, **Team plan** |
| 4 | Cycle cadence | **Rolling admission** (the `cycle_label` field becomes informational rather than a hard boundary). |
| 5 | Decline reasons | **Fixed list** with admin ability to customize the outgoing message on a per-application basis. Proposed list: "Ineligible for program", "Pool imbalance", "Incomplete application", "Other". |
| 6 | Institutional approvals | **Not required.** Proceeding without DPO review. |
| 7 | Branding | Current plain monogram and palette are **approved** to continue. |
| 8 | Closeout survey | **Drafted** — see `CLOSEOUT_SURVEY.md` alongside this document. |

Still pending (nothing blocking; resolve during the relevant phase):

- The mentor toolkit PDF and the mentee toolkit PDF, uploaded to Airtable
  Resources records in Phase 6.
- Final wording of the applicant acknowledgement email, decline email, and
  the "would you like to mentor again?" re-enrollment email — drafts in
  Phase 3, committee sign-off before Phase 7.
- The list of consumer email domains for the cross-institution filter's
  allow-list (§6.7) may need expansion based on applicant demographics;
  revisit after the first cycle.

---

## 17. Glossary

- **Applicant** — any individual who submits the form, regardless of role.
- **Mentor / Mentee** — applicants in each role.
- **Pool** — the set of `accepted` applicants currently eligible to be
  matched.
- **Cycle** — a named period (e.g., "Spring 2026"); rolling admission is
  possible within it.
- **Match** — a record representing a potential or actual pairing of one
  mentor and one mentee.
- **Mutual interest** — both sides of a proposed match have selected each
  other.
- **Compact** — the Mentorship Program Compact PDF, signed by both parties
  before the relationship is official.
- **Toolkit** — role-specific PDF delivered on compact signing.
- **Blinded** — view where names and identifying details are redacted.
- **Unblinded** — full profile visible to the counterpart after mutual
  interest + admin approval + compact signing.

---

*End of document. This specification is versioned; future revisions should
keep §16 updated with what's been answered. Reviewers: please leave comments
inline on the GitHub version rather than editing paragraphs, so we can keep
track of who proposed what.*
