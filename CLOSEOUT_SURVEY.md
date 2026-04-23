# ISEV–SNEV Mentorship Program — Closeout Survey

Draft v0.2 · April 2026 · for committee review

Changelog:
- v0.2 — Resolved the four open questions per committee direction:
  demographic data pulled from applicant profile (not re-asked here); NPS
  retained over CSAT; no counterpart-feedback questions; public-facing annual
  report confirmed as a design goal.
- v0.1 — Initial draft.

Two parallel surveys, one for mentors and one for mentees, sent automatically
on the 12-month anniversary of the compact signing. Both are short (~5
minutes), anonymous to the counterpart, visible to the matching committee for
program evaluation. Each section lists the question as it appears to the
respondent, the field type, and a short comment on why we're asking it.

General principles:

- **Keep it short.** Response rate halves past 12 questions.
- **Separate program evaluation from feedback on the counterpart.** The
  counterpart never sees answers about them.
- **Default to optional.** Only the core rating is required.
- **Avoid leading language.** "How would you describe…" not "How great was…".

---

## Mentor survey

### Section 1 — Your experience with the program

**Q1. Overall, how would you rate your experience of this mentorship cycle?**
(Required · 1–5 scale · 1 = Poor, 5 = Excellent)

**Q2. In one or two sentences, what worked well?**
(Optional · long text)

**Q3. In one or two sentences, what could have worked better?**
(Optional · long text)

### Section 2 — Program fit

**Q4. How good was the match we produced for you?**
(Required · 1–5 scale · 1 = Poor fit, 5 = Excellent fit)

**Q5. What, if anything, would have improved the match?**
(Optional · multi-select)

- Better alignment on career topics
- Better alignment on focus areas
- Better alignment on availability or time zone
- Better alignment on working style
- Different career stage
- Nothing — the match was right
- Other (free text)

**Q6. How often did you actually meet?**
(Required · single-select)

- More than bi-monthly
- Bi-monthly, as expected
- Less than bi-monthly
- We started but stopped early
- We never met

**Q7. Roughly how many hours total did you spend on the mentorship over the
year?**
(Optional · number)

### Section 3 — Outcomes for the mentee (mentor's perspective)

**Q8. From what you observed, did the mentee make meaningful progress on the
goals they set at the start?**
(Required · 1–5 scale · 1 = No progress, 5 = Substantial progress)

**Q9. Which of these, if any, did you help the mentee with? (select all
that apply)**
(Optional · multi-select, topic-area list from §3.1 of the architecture doc)

### Section 4 — Professional development value (mentor's own benefit)

**Q10. Did mentoring in this program deliver professional-development value
for you?**
(Required · 1–5 scale · 1 = No, 5 = Yes, significantly)

**Q11. If yes, in what form?**
(Optional · multi-select)

- Fresh perspective on the field
- Opportunity to refine my mentoring skills
- Visibility within ISEV/SNEV
- Expanded network
- Contribution to the community
- Other (free text)

### Section 5 — Program mechanics

**Q12. How useful was the Mentorship Program Compact?**
(Optional · 1–5 scale)

**Q13. How useful was the mentor toolkit?**
(Optional · 1–5 scale)

**Q14. How clear was the committee's communication throughout the year?**
(Optional · 1–5 scale)

### Section 6 — Looking forward

**Q15. Would you be willing to mentor again in a future cycle?**
(Required · single-select)

- Yes, please re-enrol me automatically
- Yes, ask me again in 6 months
- Not right now
- No, please do not ask again

**Q16. Would you recommend the program to a colleague?**
(Required · 0–10 NPS scale)

**Q17. Is there anything else the committee should know?**
(Optional · long text)

---

## Mentee survey

### Section 1 — Your experience with the program

**Q1. Overall, how would you rate your experience of this mentorship cycle?**
(Required · 1–5 scale · 1 = Poor, 5 = Excellent)

**Q2. In one or two sentences, what worked well?**
(Optional · long text)

**Q3. In one or two sentences, what could have worked better?**
(Optional · long text)

### Section 2 — Program fit

**Q4. How good was the match we produced for you?**
(Required · 1–5 scale · 1 = Poor fit, 5 = Excellent fit)

**Q5. What, if anything, would have improved the match?**
(Optional · multi-select · same list as mentor Q5)

**Q6. How often did you actually meet?**
(Required · same choices as mentor Q6)

**Q7. Roughly how many hours total did you spend on the mentorship over the
year?**
(Optional · number)

### Section 3 — Outcomes for you

**Q8. Looking back at the professional-development goals you listed when you
applied, how much progress did you make on them?**
(Required · 1–5 scale · 1 = None, 5 = Substantial)

**Q9. Which of these did the mentorship help you with? (select all that
apply)**
(Optional · multi-select, topic-area list from §3.1 of the architecture doc)

**Q10. Did anything concrete come out of the mentorship in the past year?
(select all that apply)**
(Optional · multi-select)

- Submitted a grant or fellowship application
- Accepted a new position
- Co-authored a paper
- Presented at a conference
- Expanded my professional network
- Clarified my career direction
- Developed specific skills (communication, leadership, etc.)
- Other (free text)
- None of the above yet, but I feel better positioned

### Section 4 — Program mechanics

**Q11. How useful was the Mentorship Program Compact?**
(Optional · 1–5 scale)

**Q12. How useful was the mentee toolkit?**
(Optional · 1–5 scale)

**Q13. How clear was the committee's communication throughout the year?**
(Optional · 1–5 scale)

### Section 5 — Looking forward

**Q14. Would you apply to the program again in a future cycle if you were
eligible?**
(Optional · single-select · Yes / Maybe / No / Not eligible)

**Q15. Would you recommend the program to a colleague or trainee?**
(Required · 0–10 NPS scale)

**Q16. Would you be interested in becoming a mentor in this program in the
future (perhaps after 2–3 years)?**
(Optional · single-select · Yes / Maybe / No)

**Q17. Is there anything else the committee should know?**
(Optional · long text)

---

## Implementation notes

- **Delivery.** Two Airtable forms (one per role), each with a unique
  pre-filled `match_id` token so responses can be linked to the match without
  asking the respondent to identify themselves to the system.
- **Privacy.** The link between a survey response and the mentor/mentee
  identity is accessible only to committee admins with full base access. When
  the committee publishes aggregate stats (e.g., in annual reports), they
  must de-identify — report medians and distributions, not individual quotes
  attributable to a specific pairing.
- **Reminders.** Automation sends the survey on day 365, a reminder on day
  378, and a final reminder on day 392. After that the survey closes for
  that match.
- **Reporting.** A quarterly Airtable Interface view shows rolling averages:
  overall experience (Q1), match fit (Q4), NPS (mentor Q16 / mentee Q15),
  "re-enrolment interest" rate (mentor Q15). These become the committee's
  core program health metrics.
- **Free-text review.** Free-text answers are read by the committee but not
  used as quotes unless the respondent has given explicit permission. Add an
  optional checkbox below the long-text fields: "You may quote this
  anonymously in program reports."

---

## Resolved design decisions

The four items the committee reviewed in v0.1 are resolved as follows:

1. **Demographic data** — Not re-asked in the closeout survey. Career stage,
   country, and any other demographics reported in aggregate are pulled from
   the applicant profile at the time of application. If a profile edit would
   change a participant's demographic bucket between application and closeout,
   the committee uses the profile value at application time as the stable
   reference. This keeps the survey short and avoids asking for data we
   already have.
2. **NPS retained.** Mentor Q16 and mentee Q15 remain on the 0–10 NPS scale.
   The 1–5 CSAT alternative is not adopted.
3. **No counterpart feedback questions.** The surveys do not ask for feedback
   about the individual mentor or mentee. If a specific concern arises, the
   "Is there anything else the committee should know?" free-text field in
   both surveys is the channel for that — and participants can also email
   the committee directly at any time, separately from the survey.
4. **Public-facing annual report.** Confirmed as a goal. The ordinal scales
   (Q1, Q4, Q8, Q10, Q12–Q14) and yes/no-style items already produce
   chartable data. The reporting view in Airtable will aggregate:
   overall-experience averages, match-fit averages, NPS, re-enrolment
   interest rate, and concrete-outcome tallies (mentee Q10) across the
   cohort, all de-identified.
