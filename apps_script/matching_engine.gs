/* ============================================================
   ISEV-SNEV Mentorship Program -- Sheets matching engine
   Implements ARCHITECTURE.md §6 (matching), §7 (no-match handling),
   plus a weekly Drive snapshot backup of the whole spreadsheet.

   INSTALL (one time, ~3 minutes)
   1. Open the applications Google Sheet -> Extensions -> Apps Script.
      This is the same project that holds the form handler (doPost).
   2. Click + next to Files -> Script. Name it "matching_engine".
      Paste this entire file. Save.
   3. In the toolbar function dropdown pick `setupMentorshipSystem`
      and click Run. Authorize when prompted. This:
        - adds a `status` column to the Applications sheet (if missing)
        - creates the `Settings`, `Proposed Matches`, and `Never Match` tabs
        - installs the nightly matching trigger (~2am) and the weekly
          snapshot trigger (Mondays ~4am)
   4. Reload the Sheet. A "Mentorship" menu appears with manual actions.

   DAILY USE
   - New applications arrive with a blank status (= "submitted").
   - The committee reviews each row and sets status to `accepted`
     (or `declined` / `withdrawn`). Only accepted applicants are matched.
   - The engine writes candidate pairs to `Proposed Matches`. Rows it
     generated stay in status `proposed` (or `held-below-threshold`) and
     are re-derived on every run; the committee advances good ones to
     `mutual-interest` -> `admin-approved` -> `active` (those are never
     touched by regeneration). Set `declined` to permanently retire a pair.
   - Mentor capacity: a mentor stays in the pool until their count of
     matches in status {admin-approved, compact-sent, compact-signed,
     active} reaches their `mentor_slots`.
   ============================================================ */

const APPLICATIONS_SHEET_INDEX = 0; // applications must stay the first tab
const MATCHES_SHEET = 'Proposed Matches';
const SETTINGS_SHEET = 'Settings';
const NEVER_MATCH_SHEET = 'Never Match';
const PROFILE_LINKS_SHEET = 'Profile Links';
const COMPACTS_SHEET = 'Compacts';
const SURVEYS_SHEET = 'Surveys';
// Drive folder holding 'Mentor Toolkit.pdf' and 'Mentee Toolkit.pdf' to
// attach to onboarding emails. If the folder/file is missing, the email
// still goes out and says the toolkit will follow separately.
const TOOLKIT_FOLDER = 'Mentorship Toolkits';
const BACKUP_FOLDER = 'ISEV-SNEV Mentorship Backups';
const BACKUPS_TO_KEEP = 26;
const DIGEST_EMAIL = 'isevmentorship@gmail.com';
// Named MENTORSHIP_* to avoid colliding with the form handler's consts
// (duplicate top-level consts across files crash the whole project).
const MENTORSHIP_SITE_URL = 'https://isevmentorship.github.io/isev-snev-mentorship/';
const MENTORSHIP_PROGRAM = 'ISEV-SNEV Mentorship Program';

// Topic id -> human label (must match apply.js / ARCHITECTURE §3.1).
const TOPIC_LABELS = {
  career_transition: 'Career transitions',
  industry_advancement: 'Industry career advancement',
  academic_career: 'Academic career development',
  grant_writing: 'Grant and fellowship writing',
  networking: 'Networking in the EV community',
  job_search: 'Job search and interviewing',
  communication: 'Scientific communication and presentation',
  leadership: 'Leadership and management',
  long_term_trajectory: 'Long-term career trajectory',
  work_life: 'Work-life balance and sustainability',
  dei: 'Diversity, equity and inclusion',
  publishing: 'Publishing strategy',
  mentoring_others: 'Mentoring others',
  international_moves: 'International moves and relocation'
};

// §6.2 rank weight table (rank 1..5)
const RANK_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08];

// Match statuses the committee owns; regeneration never deletes these.
const PRESERVED_MATCH_STATUSES = [
  'mutual-interest', 'admin-approved', 'compact-sent', 'compact-signed',
  'active', 'completed', 'terminated-early', 'declined'
];
// Statuses that consume a mentor slot (§3.4 mentor capacity rule).
const SLOT_CONSUMING_STATUSES = [
  'admin-approved', 'compact-sent', 'compact-signed', 'active'
];

// UTC offsets for the form's timezone dropdown (standard time; the 5-hour
// window makes DST drift immaterial).
const TZ_OFFSETS = {
  'America/Los_Angeles': -8, 'America/Denver': -7, 'America/Chicago': -6,
  'America/New_York': -5, 'America/Mexico_City': -6, 'America/Bogota': -5,
  'America/Sao_Paulo': -3, 'America/Buenos_Aires': -3,
  'Europe/London': 0, 'Europe/Paris': 1, 'Europe/Helsinki': 2,
  'Africa/Johannesburg': 2, 'Asia/Dubai': 4, 'Asia/Tehran': 3.5,
  'Asia/Kolkata': 5.5, 'Asia/Singapore': 8, 'Asia/Tokyo': 9,
  'Australia/Sydney': 10, 'Pacific/Auckland': 12
};

// §4.7 defaults; the Settings tab overrides these.
const DEFAULT_SETTINGS = [
  ['weight_topic_overlap', 0.70, 'Score weight for topic overlap (§6.4)'],
  ['weight_focus_overlap', 0.30, 'Score weight for focus-area overlap (§6.4)'],
  ['secondary_topic_weight', 0.30, 'Multiplier on mentee secondary-tier overlap (§6.2)'],
  ['locality_window_hours', 5, 'Max UTC-offset difference (§6.1); mentee time-zone flexibility can widen it'],
  ['allow_same_institution', 'FALSE', 'TRUE bypasses the same-institution filter (§6.7)'],
  ['consumer_email_domains', 'gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, proton.me, protonmail.com', 'Domains ignored by the shared-domain heuristic'],
  ['match_threshold_percent', 50, 'Below this, pair is written as held-below-threshold (§7)'],
  ['mentor_unfilled_escalation_days', 30, 'Digest flags mentors idle this long (§7)'],
  ['unmatched_mentee_escalation_days', 30, 'Digest flags mentees waiting this long (§7)'],
  ['max_candidates_per_mentee', 3, 'Top-N candidates proposed per mentee (§6.5)'],
  ['reminder_after_days', 7, 'One reminder email after this many days without a response (profiles, compacts, surveys)'],
  ['stalled_after_days', 14, 'Digest flags a person as unresponsive after this many days'],
  ['checkin_after_days', 180, '6-month check-in survey goes out this many days after match_start'],
  ['closeout_after_days', 365, '12-month closeout survey goes out this many days after match_start']
];

/* ---------------- Setup, menu, triggers ---------------- */

function setupMentorshipSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. status + matched_with columns on Applications
  const apps = ss.getSheets()[APPLICATIONS_SHEET_INDEX];
  ['status', 'matched_with'].forEach(function (col) {
    const headers = apps.getRange(1, 1, 1, apps.getLastColumn()).getValues()[0];
    if (headers.indexOf(col) === -1) {
      apps.getRange(1, apps.getLastColumn() + 1).setValue(col);
    }
  });

  // 2. Settings tab
  let settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS_SHEET);
    settings.getRange(1, 1, 1, 3).setValues([['key', 'value', 'notes']])
      .setFontWeight('bold');
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    settings.setColumnWidths(1, 3, 240);
  }

  // 3. Proposed Matches tab (header row is re-written so upgrades that add
  //    columns, like match_start, migrate existing installs)
  let matches = ss.getSheetByName(MATCHES_SHEET);
  if (!matches) {
    matches = ss.insertSheet(MATCHES_SHEET);
    matches.setFrozenRows(1);
  }
  matches.getRange(1, 1, 1, MATCH_HEADERS.length)
    .setValues([MATCH_HEADERS]).setFontWeight('bold');

  // 4. Never Match tab (§6.8)
  let never = ss.getSheetByName(NEVER_MATCH_SHEET);
  if (!never) {
    never = ss.insertSheet(NEVER_MATCH_SHEET);
    never.getRange(1, 1, 1, 3)
      .setValues([['email_a', 'email_b', 'reason']]).setFontWeight('bold');
  }

  // 4b. Token-tracked tabs: Profile Links, Compacts, Surveys. Header rows
  //     are re-written on every setup run so column additions migrate.
  [[PROFILE_LINKS_SHEET, PROFILE_LINK_HEADERS],
   [COMPACTS_SHEET, COMPACT_HEADERS],
   [SURVEYS_SHEET, SURVEY_HEADERS]].forEach(function (spec) {
    let sh = ss.getSheetByName(spec[0]);
    if (!sh) { sh = ss.insertSheet(spec[0]); sh.setFrozenRows(1); }
    sh.getRange(1, 1, 1, spec[1].length).setValues([spec[1]]).setFontWeight('bold');
  });

  // 5. Triggers (idempotent: remove ours, re-add)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['nightlyMatchRun', 'weeklySnapshot'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('nightlyMatchRun').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('weeklySnapshot').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();

  notify_(
    'Mentorship system ready.\n\n' +
    '- Mark applicants "accepted" in the new status column to admit them to the pool.\n' +
    '- Matching runs nightly at ~2am and writes to "Proposed Matches".\n' +
    '- Backups run Mondays ~4am into the Drive folder "' + BACKUP_FOLDER + '".\n' +
    '- Use the Mentorship menu to run either on demand.');
}

// Show a message without ever blocking: when run from the script editor
// there is no dialog UI to click, and a blocking alert() looks like a hang.
// toast() is non-blocking; Logger covers headless runs (triggers/editor).
function notify_(message) {
  Logger.log(message);
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Mentorship', 10);
  } catch (e) { /* no UI available (e.g. time-driven trigger) - log only */ }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mentorship')
    .addItem('Generate matches now', 'generateMatchesFromMenu')
    .addItem('Send blinded profiles to MENTEE of selected row', 'sendProfilesToMentee')
    .addItem('Send blinded profiles to MENTOR of selected row', 'sendProfilesToMentor')
    .addItem('Run full daily pipeline now (incl. digest)', 'sendDigestFromMenu')
    .addItem('Snapshot backup now', 'weeklySnapshot')
    .addSeparator()
    .addItem('Setup / repair (run once)', 'setupMentorshipSystem')
    .addToUi();
}

function generateMatchesFromMenu() {
  const result = generateMatches();
  notify_(
    'Matching complete. Proposals written: ' + result.written +
    ' (held below threshold: ' + result.held +
    '). Pool: ' + result.mentees + ' mentee(s), ' + result.mentors + ' mentor(s).');
}

function sendDigestFromMenu() {
  nightlyMatchRun();
  notify_('Pipeline ran; digest sent to ' + DIGEST_EMAIL + '.');
}

// The daily pipeline, in deliberate order:
//   1. retire matched people from the pool (so step 4 never re-proposes them)
//   2. detect mutual interest from submitted picks
//   3. lifecycle: compacts out for admin-approved pairs, activation + intro
//      email when both have signed, reminders, stall detection, surveys
//   4. generate fresh matches on the reduced pool
//   5. one digest email covering all of it
function nightlyMatchRun() {
  const retired = retireMatchedFromPool_();
  const mutual = detectMutualInterest_();
  const lifecycle = progressLifecycle_();
  const result = generateMatches();
  sendCommitteeDigest(result, { retired: retired, mutual: mutual, lifecycle: lifecycle });
}

/* ---------------- Data access ---------------- */

function getSettings() {
  const out = {};
  DEFAULT_SETTINGS.forEach(function (r) { out[r[0]] = r[1]; });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0]) out[String(r[0]).trim()] = r[1];
    });
  }
  ['weight_topic_overlap', 'weight_focus_overlap', 'secondary_topic_weight',
   'locality_window_hours', 'match_threshold_percent',
   'mentor_unfilled_escalation_days', 'unmatched_mentee_escalation_days',
   'max_candidates_per_mentee', 'reminder_after_days', 'stalled_after_days',
   'checkin_after_days', 'closeout_after_days'
  ].forEach(function (k) { out[k] = Number(out[k]); });
  out.allow_same_institution = String(out.allow_same_institution).toUpperCase() === 'TRUE';
  out.consumer_email_domains = String(out.consumer_email_domains)
    .split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(String);
  return out;
}

function readApplicants() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[APPLICATIONS_SHEET_INDEX];
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = function (name) { return headers.indexOf(name); };
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const get = function (name) {
      const i = idx(name);
      return i === -1 ? '' : String(values[r][i] || '').trim();
    };
    const email = get('email').toLowerCase();
    if (!email) continue;
    rows.push({
      row: r + 1,
      timestamp: get('timestamp'),
      role: get('role').toLowerCase(),
      name: get('full_name'),
      email: email,
      affiliation: get('affiliation'),
      timezone: get('timezone'),
      status: (get('status') || 'submitted').toLowerCase(),
      flex: get('mentee_timezone_flex'),
      slots: Number(get('mentor_slots')) || 1,
      stage: get('career_stage'),
      languages: get('languages'),
      experience: get('mentor_experience'),
      focus: get('focus_areas').split(';').map(function (s) { return s.trim(); }).filter(String),
      primary: parseRanked(get('career_topics_primary_ranked')),
      secondary: parseRanked(get('career_topics_secondary_ranked'))
    });
  }
  // Latest application per email wins (re-submissions supersede).
  const byEmail = {};
  rows.forEach(function (a) { byEmail[a.email + '|' + a.role] = a; });
  return Object.keys(byEmail).map(function (k) { return byEmail[k]; });
}

function parseRanked(cell) {
  if (!cell) return [];
  try {
    const arr = JSON.parse(cell);
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (t) {
      return t && t.topic && t.rank >= 1 && t.rank <= 5;
    });
  } catch (e) { return []; }
}

function readNeverMatch() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NEVER_MATCH_SHEET);
  const set = {};
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const a = String(r[0]).trim().toLowerCase(), b = String(r[1]).trim().toLowerCase();
      if (a && b) { set[a + '|' + b] = true; set[b + '|' + a] = true; }
    });
  }
  return set;
}

/* ---------------- Scoring (§6.2-6.4) ---------------- */

function rankWeight(rank) {
  return RANK_WEIGHTS[rank - 1] || 0;
}

// Per-topic contribution is the geometric mean sqrt(w_mentee * w_mentor),
// not the raw product in the original §6.2 text: the raw product caps at
// 0.226 for a perfect five-for-five match, which contradicts §6.2's own
// "hits 1.00" claim and would leave every match below the §4.7 50% hold
// threshold. The geometric mean keeps rank-position weighting and makes a
// perfect same-rank overlap score exactly 1.00. (ARCHITECTURE.md §6.2 has
// been corrected to match.)
function topicScore(mentee, mentor, secondaryWeight) {
  const offered = {};
  mentor.primary.forEach(function (t) { offered[t.topic] = t.rank; });
  let primaryOverlap = 0, secondaryOverlap = 0;
  mentee.primary.forEach(function (t) {
    if (offered[t.topic]) primaryOverlap += Math.sqrt(rankWeight(t.rank) * rankWeight(offered[t.topic]));
  });
  mentee.secondary.forEach(function (t) {
    if (offered[t.topic]) secondaryOverlap += Math.sqrt(rankWeight(t.rank) * rankWeight(offered[t.topic]));
  });
  return Math.min(1.0, primaryOverlap + secondaryWeight * secondaryOverlap);
}

function focusScore(mentee, mentor) {
  if (!mentee.focus.length || !mentor.focus.length) return 0;
  const a = {}, union = {};
  let inter = 0;
  mentee.focus.forEach(function (f) { a[f] = true; union[f] = true; });
  mentor.focus.forEach(function (f) { if (a[f]) inter++; union[f] = true; });
  return inter / Object.keys(union).length;
}

/* ---------------- Filters (§6.1, §6.7) ---------------- */

function offsetDelta(a, b) {
  const oa = TZ_OFFSETS[a.timezone], ob = TZ_OFFSETS[b.timezone];
  if (oa === undefined || ob === undefined) return null; // unknown: pass, but flag
  return Math.abs(oa - ob);
}

function localityWindow(mentee, settings) {
  if (mentee.flex === 'any') return 99;
  if (mentee.flex === 'within_8') return 8;
  return settings.locality_window_hours;
}

function normalizeAffiliation(s) {
  return String(s).toLowerCase()
    .replace(/university of|institute of|school of|department of|dept\.?|the|institutet|institute|university|hospital|center|centre/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = [];
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function institutionConflict(a, b, settings) {
  const na = normalizeAffiliation(a.affiliation), nb = normalizeAffiliation(b.affiliation);
  if (na && nb) {
    if (na === nb) return true;
    if (na.length >= 8 && nb.indexOf(na) !== -1) return true;
    if (nb.length >= 8 && na.indexOf(nb) !== -1) return true;
    const longer = Math.max(na.length, nb.length);
    if (longer > 0 && levenshtein(na, nb) / longer < 0.20) return true;
  }
  const da = a.email.split('@')[1] || '', db = b.email.split('@')[1] || '';
  if (da && da === db && settings.consumer_email_domains.indexOf(da) === -1) return true;
  return false;
}

/* ---------------- Match generation (§6.5-6.6, §7) ---------------- */

const MATCH_HEADERS = [
  'generated_at', 'mentee_email', 'mentee_name', 'mentor_email', 'mentor_name',
  'score_total_pct', 'score_topic', 'score_focus', 'offset_delta_hours',
  'institution_flag', 'status', 'committee_notes', 'pair_key', 'match_start'
];

function generateMatches() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const settings = getSettings();
    const applicants = readApplicants();
    const neverMatch = readNeverMatch();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(MATCHES_SHEET);
    if (!sheet) throw new Error('Run Setup first: "' + MATCHES_SHEET + '" tab is missing.');

    // Existing match rows: preserve committee-owned statuses.
    const existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, MATCH_HEADERS.length).getValues()
      : [];
    const statusCol = MATCH_HEADERS.indexOf('status');
    const pairCol = MATCH_HEADERS.indexOf('pair_key');
    const preserved = existing.filter(function (r) {
      return PRESERVED_MATCH_STATUSES.indexOf(String(r[statusCol]).trim().toLowerCase()) !== -1;
    });
    const retiredPairs = {};   // pairs we must not re-propose
    const slotUse = {};        // mentor email -> consumed slots
    preserved.forEach(function (r) {
      retiredPairs[String(r[pairCol])] = true;
      const st = String(r[statusCol]).trim().toLowerCase();
      if (SLOT_CONSUMING_STATUSES.indexOf(st) !== -1) {
        const mentorEmail = String(r[MATCH_HEADERS.indexOf('mentor_email')]).toLowerCase();
        slotUse[mentorEmail] = (slotUse[mentorEmail] || 0) + 1;
      }
    });

    const mentees = applicants.filter(function (a) {
      return a.role === 'mentee' && a.status === 'accepted';
    });
    const mentors = applicants.filter(function (a) {
      return a.role === 'mentor' && a.status === 'accepted' &&
        (a.slots - (slotUse[a.email] || 0)) > 0;
    });

    const now = new Date().toISOString();
    const proposals = [];
    let held = 0;

    mentees.forEach(function (mentee) {
      // A mentee with a slot-consuming match is already taken care of.
      const menteeTaken = preserved.some(function (r) {
        return String(r[MATCH_HEADERS.indexOf('mentee_email')]).toLowerCase() === mentee.email &&
          SLOT_CONSUMING_STATUSES.indexOf(String(r[statusCol]).trim().toLowerCase()) !== -1;
      });
      if (menteeTaken) return;

      const window = localityWindow(mentee, settings);
      const scored = [];
      mentors.forEach(function (mentor) {
        const pairKey = mentee.email + '|' + mentor.email;
        if (retiredPairs[pairKey] || neverMatch[mentee.email + '|' + mentor.email]) return;
        const delta = offsetDelta(mentee, mentor);
        if (delta !== null && delta > window) return;
        const conflict = institutionConflict(mentee, mentor, settings);
        if (conflict && !settings.allow_same_institution) return;
        const sTopic = topicScore(mentee, mentor, settings.secondary_topic_weight);
        const sFocus = focusScore(mentee, mentor);
        const total = settings.weight_topic_overlap * sTopic +
                      settings.weight_focus_overlap * sFocus;
        scored.push({
          mentor: mentor, delta: delta, conflict: conflict,
          sTopic: sTopic, sFocus: sFocus, total: total,
          slotsLeft: mentor.slots - (slotUse[mentor.email] || 0),
          pairKey: pairKey
        });
      });

      scored.sort(function (x, y) {
        if (y.total !== x.total) return y.total - x.total;
        const dx = x.delta === null ? 99 : x.delta, dy = y.delta === null ? 99 : y.delta;
        if (dx !== dy) return dx - dy;
        if (y.slotsLeft !== x.slotsLeft) return y.slotsLeft - x.slotsLeft;
        return x.mentor.email < y.mentor.email ? -1 : 1;
      });

      scored.slice(0, settings.max_candidates_per_mentee).forEach(function (c) {
        const pct = Math.round(c.total * 100);
        const below = pct < settings.match_threshold_percent;
        if (below) held++;
        proposals.push([
          now, mentee.email, mentee.name, c.mentor.email, c.mentor.name,
          pct, round2(c.sTopic), round2(c.sFocus),
          c.delta === null ? 'unknown' : c.delta,
          c.conflict ? 'FLAG' : '',
          below ? 'held-below-threshold' : 'proposed',
          '', c.pairKey
        ]);
      });
    });

    // Rewrite the sheet: header + preserved + fresh proposals.
    sheet.clearContents();
    sheet.getRange(1, 1, 1, MATCH_HEADERS.length)
      .setValues([MATCH_HEADERS]).setFontWeight('bold');
    const rows = preserved.concat(proposals);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, MATCH_HEADERS.length).setValues(rows);
    }
    sheet.setFrozenRows(1);

    return {
      written: proposals.length, held: held,
      mentees: mentees.length, mentors: mentors.length,
      applicants: applicants, preserved: preserved, proposals: proposals,
      settings: settings
    };
  } finally {
    lock.releaseLock();
  }
}

function round2(x) { return Math.round(x * 100) / 100; }

/* ---------------- Committee digest (§7) ---------------- */

function sendCommitteeDigest(result, extra) {
  extra = extra || {};
  const applicants = result.applicants;
  const settings = result.settings;
  const now = Date.now();
  const days = function (ts) {
    const t = new Date(ts).getTime();
    return isNaN(t) ? null : Math.floor((now - t) / 86400000);
  };

  const submitted = applicants.filter(function (a) { return a.status === 'submitted'; });
  const menteesWaiting = [];
  const mentorsIdle = [];

  applicants.forEach(function (a) {
    if (a.status !== 'accepted') return;
    const d = days(a.timestamp);
    const proposalsFor = result.proposals.filter(function (p) {
      return p[1] === a.email || p[3] === a.email;
    }).length;
    const activeFor = result.preserved.filter(function (p) {
      return (String(p[1]).toLowerCase() === a.email || String(p[3]).toLowerCase() === a.email) &&
        SLOT_CONSUMING_STATUSES.indexOf(String(p[10]).trim().toLowerCase()) !== -1;
    }).length;
    if (a.role === 'mentee' && !activeFor && !proposalsFor &&
        d !== null && d >= settings.unmatched_mentee_escalation_days) {
      menteesWaiting.push(a.name + ' <' + a.email + '> - ' + d + ' days, no candidates');
    }
    if (a.role === 'mentor' && !activeFor && !proposalsFor &&
        d !== null && d >= settings.mentor_unfilled_escalation_days) {
      mentorsIdle.push(a.name + ' <' + a.email + '> - ' + d + ' days, unfilled slots');
    }
  });

  const lines = [];
  lines.push('ISEV-SNEV Mentorship - nightly matching digest');
  lines.push('');
  lines.push('Pool: ' + result.mentors + ' accepted mentor(s), ' +
             result.mentees + ' accepted mentee(s) seeking a match.');
  lines.push('Fresh proposals written tonight: ' + result.written +
             (result.held ? ' (' + result.held + ' held below the ' +
              settings.match_threshold_percent + '% threshold)' : ''));
  if (submitted.length) {
    lines.push('');
    lines.push('AWAITING REVIEW (' + submitted.length + ') - set status to accepted/declined:');
    submitted.forEach(function (a) {
      lines.push('  - ' + a.role + ': ' + a.name + ' <' + a.email + '>');
    });
  }
  if (menteesWaiting.length) {
    lines.push('');
    lines.push('MENTEES WAITING ' + settings.unmatched_mentee_escalation_days + '+ DAYS WITH NO CANDIDATES:');
    menteesWaiting.forEach(function (s) { lines.push('  - ' + s); });
  }
  if (mentorsIdle.length) {
    lines.push('');
    lines.push('MENTORS IDLE ' + settings.mentor_unfilled_escalation_days + '+ DAYS:');
    mentorsIdle.forEach(function (s) { lines.push('  - ' + s); });
  }
  // ---- Lifecycle sections (present when the full pipeline ran) ----
  const pairLabel = function (r) {
    return r[mcol_('mentee_name')] + ' <-> ' + r[mcol_('mentor_name')] +
      ' (' + r[mcol_('score_total_pct')] + '% fit)';
  };
  const mut = extra.mutual || {};
  const sug = mut.suggestion || { assigned: [], conflicted: [] };
  if ((mut.newlyMutual || []).length || sug.assigned.length || sug.conflicted.length) {
    lines.push('');
    lines.push('MUTUAL INTEREST - ready for committee approval:');
    if (sug.assigned.length) {
      lines.push('  Suggested assignment (fit-maximizing within mentor slots) - set these to admin-approved:');
      sug.assigned.forEach(function (r) { lines.push('    - ' + pairLabel(r)); });
    }
    if (sug.conflicted.length) {
      lines.push('  Also mutual, but conflicts with the suggestion (mentee or mentor slot already used):');
      sug.conflicted.forEach(function (r) { lines.push('    - ' + pairLabel(r)); });
    }
  }
  const life = extra.lifecycle || {};
  if ((life.compactsSent || []).length) {
    lines.push('');
    lines.push('COMPACTS SENT (approved pairs now signing): ' + life.compactsSent.length + ' pair(s).');
  }
  if ((life.activated || []).length) {
    lines.push('');
    lines.push('ACTIVATED - both signed, introduced, 12-month clock started:');
    life.activated.forEach(function (pk) { lines.push('  - ' + pk); });
  }
  if ((life.surveysSent || []).length) {
    lines.push('');
    lines.push('SURVEYS SENT: ' + life.surveysSent.join(', '));
  }
  if ((life.reminders || []).length) {
    lines.push('');
    lines.push('REMINDERS SENT (1 week, no response): ' + life.reminders.join('; '));
  }
  if ((life.stalled || []).length) {
    lines.push('');
    lines.push('*** UNRESPONSIVE 2+ WEEKS - needs committee follow-up ***');
    life.stalled.forEach(function (s) { lines.push('  - ' + s); });
  }
  if ((extra.retired || []).length) {
    lines.push('');
    lines.push('POOL CHANGES: ' + extra.retired.join('; '));
  }

  lines.push('');
  lines.push('Review everything here: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());

  // Skip the email only when there is truly nothing to say.
  const lifecycleNews = (mut.newlyMutual || []).length || (life.compactsSent || []).length ||
    (life.activated || []).length || (life.reminders || []).length ||
    (life.stalled || []).length || (life.surveysSent || []).length ||
    (extra.retired || []).length;
  if (!result.written && !submitted.length && !menteesWaiting.length &&
      !mentorsIdle.length && !lifecycleNews) return;

  sendMail_(DIGEST_EMAIL,
    'Mentorship digest: ' + result.written + ' new proposal(s), ' +
    (sug.assigned.length ? sug.assigned.length + ' mutual match(es) to approve, ' : '') +
    submitted.length + ' awaiting review',
    lines.join('\n'), DIGEST_EMAIL);
}

// GmailApp (not MailApp): sends through the real Gmail account, so messages
// carry its reputation, land in its Sent folder, and show a proper sender
// name - MailApp mail is far more likely to be spam-foldered.
function sendMail_(to, subject, body, replyTo) {
  GmailApp.sendEmail(to, subject, body, {
    name: 'ISEV-SNEV Mentorship Committee',
    replyTo: replyTo || DIGEST_EMAIL
  });
}

/* ---------------- Blinded profile pages (§5.2) ----------------
   Committee selects a row in "Proposed Matches" and uses the Mentorship
   menu to send that applicant an email linking to
   <MENTORSHIP_SITE_URL>matches.html?t=<secret token>. The page calls doGet() below,
   which serves that person's anonymized candidate set as JSON and records
   the picks they submit back. Names, affiliations, emails, and free text
   never leave the server. */

const PROFILE_LINK_HEADERS = [
  'token', 'role', 'email', 'name', 'payload_json',
  'created_at', 'sent_at', 'viewed_at', 'responded_at', 'picks', 'reminders'
];

const COMPACT_HEADERS = [
  'token', 'pair_key', 'role', 'email', 'name', 'counterpart_email',
  'sent_at', 'viewed_at', 'signed_at', 'signed_name', 'reminders'
];

const SURVEY_HEADERS = [
  'token', 'pair_key', 'wave', 'role', 'email', 'name',
  'sent_at', 'viewed_at', 'responded_at', 'reminders', 'answers_json'
];

function sendProfilesToMentee() { sendProfiles_('mentee'); }
function sendProfilesToMentor() { sendProfiles_('mentor'); }

function sendProfiles_(side) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== MATCHES_SHEET) {
    notify_('Select a row in the "' + MATCHES_SHEET + '" tab first, then rerun this menu item.');
    return;
  }
  const rowIndex = sheet.getActiveRange().getRow();
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
    notify_('Select a data row (not the header) in "' + MATCHES_SHEET + '".');
    return;
  }
  const emailCol = MATCH_HEADERS.indexOf(side === 'mentee' ? 'mentee_email' : 'mentor_email') + 1;
  const targetEmail = String(sheet.getRange(rowIndex, emailCol).getValue()).trim().toLowerCase();
  if (!targetEmail) { notify_('That row has no ' + side + ' email.'); return; }

  const result = buildCandidatePayload_(side, targetEmail);
  if (!result.candidates.length) {
    notify_('No rows in status "proposed" for ' + targetEmail + ' - nothing to send.');
    return;
  }

  const token = upsertProfileLink_(side, targetEmail, result.name, result.candidates);
  const link = MENTORSHIP_SITE_URL + 'matches.html?t=' + token;
  const counterpart = side === 'mentee' ? 'mentor' : 'mentee';

  sendMail_(targetEmail,
    MENTORSHIP_PROGRAM + ' - your blinded ' + counterpart + ' candidates',
    'Hi ' + (result.name || 'there') + ',\n\n' +
    'Good news - the matching committee has candidate ' + counterpart + 's for you. ' +
    'Names and affiliations stay hidden until both sides agree to a pairing.\n\n' +
    'View your candidates and make your picks here:\n' + link + '\n\n' +
    'This link is personal to you - please don\'t forward it. If anything looks ' +
    'off, just reply to this email.\n\n' +
    '- The ISEV-SNEV Mentorship Committee',
    DIGEST_EMAIL);
  notify_('Sent ' + result.candidates.length + ' blinded profile(s) to ' + targetEmail + '.');
}

// Candidates for a mentee are its proposed mentors, and vice versa.
function buildCandidatePayload_(side, targetEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MATCHES_SHEET);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, MATCH_HEADERS.length).getValues()
    : [];
  const col = function (name) { return MATCH_HEADERS.indexOf(name); };

  const applicants = readApplicants();
  const byKey = {};
  applicants.forEach(function (a) { byKey[a.email + '|' + a.role] = a; });
  const me = byKey[targetEmail + '|' + side] || {};

  const candidates = [];
  rows.forEach(function (r) {
    if (String(r[col('status')]).trim().toLowerCase() !== 'proposed') return;
    const rowMentee = String(r[col('mentee_email')]).trim().toLowerCase();
    const rowMentor = String(r[col('mentor_email')]).trim().toLowerCase();
    if ((side === 'mentee' ? rowMentee : rowMentor) !== targetEmail) return;

    const otherRole = side === 'mentee' ? 'mentor' : 'mentee';
    const otherEmail = side === 'mentee' ? rowMentor : rowMentee;
    const other = byKey[otherEmail + '|' + otherRole];
    if (!other) return;

    const prefix = otherRole === 'mentor' ? 'M-' : 'T-';
    candidates.push({
      code: prefix + shortHash_(String(r[col('pair_key')])),
      pair_key: String(r[col('pair_key')]),        // server-side only; stripped before serving
      fit: Number(r[col('score_total_pct')]) || 0,
      stage: other.stage || '',
      experience: otherRole === 'mentor' ? (other.experience || '') : '',
      topics: (other.primary || []).slice().sort(function (a, b) { return a.rank - b.rank; })
        .map(function (t) { return TOPIC_LABELS[t.topic] || t.topic; }),
      focus: other.focus || [],
      languages: other.languages || '',
      tz: formatOffset_(other.timezone),
      delta: r[col('offset_delta_hours')] === 'unknown' ? null : Number(r[col('offset_delta_hours')])
    });
  });
  candidates.sort(function (a, b) { return b.fit - a.fit; });
  return { candidates: candidates, name: me.name || '' };
}

function shortHash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s);
  let out = '';
  for (let i = 0; i < 2; i++) {
    out += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  }
  return out.toUpperCase();
}

function formatOffset_(tz) {
  const o = TZ_OFFSETS[tz];
  if (o === undefined) return 'unspecified';
  return 'UTC' + (o >= 0 ? '+' : '-') + Math.abs(o);
}

// One live link per (role, email): re-sending refreshes the payload but
// keeps the same token, so earlier emails keep working.
function upsertProfileLink_(role, email, name, candidates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PROFILE_LINKS_SHEET);
  if (!sheet) throw new Error('Run Setup first: "' + PROFILE_LINKS_SHEET + '" tab is missing.');
  const now = new Date().toISOString();
  const payload = JSON.stringify(candidates);

  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROFILE_LINK_HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][1]) === role && String(rows[i][2]).toLowerCase() === email) {
        sheet.getRange(i + 2, 5).setValue(payload);       // payload_json
        sheet.getRange(i + 2, 7).setValue(now);           // sent_at
        return String(rows[i][0]);
      }
    }
  }
  const token = Utilities.getUuid().replace(/-/g, '');
  sheet.appendRow([token, role, email, name, payload, now, now, '', '', '', 0]);
  return token;
}

/* --------- doGet: JSON API for matches.html ---------
   GET ?action=profiles&t=<token>          -> the candidate set (anonymized)
   GET ?action=interest&t=<token>&picks=A,B -> record picks + notify committee
   NOTE: adding doGet requires redeploying the web app IN PLACE
   (Deploy -> Manage deployments -> edit -> New version). */

// Also defined in the form-handler file; duplicate *function* declarations
// are harmless in Apps Script (unlike duplicate consts), and defining it
// here keeps the engine self-sufficient if the handler is older.
function jsonReply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'profiles') return serveProfiles_(p);
    if (p.action === 'interest') return recordInterest_(p);
    if (p.action === 'compact') return serveCompact_(p);
    if (p.action === 'sign') return signCompact_(p);
    if (p.action === 'survey') return serveSurvey_(p);
    if (p.action === 'survey_submit') return submitSurvey_(p);
    return jsonReply_({ ok: true, service: MENTORSHIP_PROGRAM });
  } catch (err) {
    return jsonReply_({ ok: false, error: String(err) });
  }
}

function findProfileLinkRow_(token) {
  if (!token || String(token).length < 16) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROFILE_LINKS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROFILE_LINK_HEADERS.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(token)) return { sheet: sheet, index: i + 2, values: rows[i] };
  }
  return null;
}

function serveProfiles_(p) {
  const hit = findProfileLinkRow_(p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  hit.sheet.getRange(hit.index, 8).setValue(new Date().toISOString()); // viewed_at
  const candidates = JSON.parse(hit.values[4] || '[]').map(function (c) {
    return {
      code: c.code, fit: c.fit, stage: c.stage, experience: c.experience,
      topics: c.topics, focus: c.focus, languages: c.languages,
      tz: c.tz, delta: c.delta
    }; // pair_key deliberately omitted
  });
  return jsonReply_({
    ok: true,
    role: hit.values[1],
    name: String(hit.values[3] || '').split(' ')[0],
    candidates: candidates,
    picks: String(hit.values[9] || '')
  });
}

function recordInterest_(p) {
  const hit = findProfileLinkRow_(p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  const payload = JSON.parse(hit.values[4] || '[]');
  const valid = {};
  payload.forEach(function (c) { valid[c.code] = c; });
  const picks = String(p.picks || '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return valid[s]; });
  if (!picks.length) return jsonReply_({ ok: false, error: 'no_valid_picks' });

  const now = new Date().toISOString();
  hit.sheet.getRange(hit.index, 9).setValue(now);              // responded_at
  hit.sheet.getRange(hit.index, 10).setValue(picks.join(', ')); // picks

  const who = hit.values[3] + ' <' + hit.values[2] + '> (' + hit.values[1] + ')';
  const lines = [who + ' submitted picks:', ''];
  picks.forEach(function (code) {
    lines.push('  ' + code + ' -> pair ' + valid[code].pair_key +
               ' (' + valid[code].fit + '% fit)');
  });
  lines.push('');
  lines.push('Mark reciprocal interest in the Sheet: ' +
             SpreadsheetApp.getActiveSpreadsheet().getUrl());
  sendMail_(DIGEST_EMAIL,
    MENTORSHIP_PROGRAM + ' - picks from ' + hit.values[2],
    lines.join('\n'), String(hit.values[2]));
  return jsonReply_({ ok: true, recorded: picks });
}

/* ---------------- Lifecycle automation ----------------
   Statuses on the applications sheet:
     accepted        in the matching pool
     matched-pending admin-approved pair, compact phase - OUT of the pool
     matched         active pair - OUT of the pool
   A mentor only leaves the pool when ALL their mentor_slots are consumed.
   The matched_with column records counterpart email(s). */

function matchRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MATCHES_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { sheet: sheet, rows: [] };
  return {
    sheet: sheet,
    rows: sheet.getRange(2, 1, sheet.getLastRow() - 1, MATCH_HEADERS.length).getValues()
  };
}
function mcol_(name) { return MATCH_HEADERS.indexOf(name); }

// Step 1: reflect committee approvals in the applications sheet so the
// matcher (step 4) no longer sees those people as available.
function retireMatchedFromPool_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const m = matchRows_();
  const consuming = {};   // email -> {statuses:[], partners:[]}
  m.rows.forEach(function (r) {
    const st = String(r[mcol_('status')]).trim().toLowerCase();
    if (SLOT_CONSUMING_STATUSES.indexOf(st) === -1) return;
    [['mentee_email', 'mentor_email'], ['mentor_email', 'mentee_email']].forEach(function (pair) {
      const email = String(r[mcol_(pair[0])]).toLowerCase();
      if (!consuming[email]) consuming[email] = { statuses: [], partners: [] };
      consuming[email].statuses.push(st);
      consuming[email].partners.push(String(r[mcol_(pair[1])]).toLowerCase());
    });
  });

  const apps = ss.getSheets()[APPLICATIONS_SHEET_INDEX];
  if (apps.getLastRow() < 2) return [];
  const values = apps.getDataRange().getValues();
  const headers = values[0].map(String);
  const cEmail = headers.indexOf('email'), cRole = headers.indexOf('role'),
        cStatus = headers.indexOf('status'), cSlots = headers.indexOf('mentor_slots'),
        cWith = headers.indexOf('matched_with');
  if (cStatus === -1) return [];
  const changed = [];
  for (let i = 1; i < values.length; i++) {
    const email = String(values[i][cEmail] || '').trim().toLowerCase();
    const hit = consuming[email];
    if (!hit) continue;
    const role = String(values[i][cRole] || '').toLowerCase();
    const slots = Number(values[i][cSlots]) || 1;
    // Mentors keep pooling until full; mentees retire on their first pair.
    const full = role === 'mentor' ? hit.partners.length >= slots : true;
    const allActive = hit.statuses.every(function (s) { return s === 'active'; });
    const target = full ? (allActive ? 'matched' : 'matched-pending')
                        : String(values[i][cStatus] || '').toLowerCase();
    const current = String(values[i][cStatus] || '').toLowerCase();
    if (target !== current && ['accepted', 'matched-pending', 'matched'].indexOf(current) !== -1) {
      apps.getRange(i + 1, cStatus + 1).setValue(target);
      changed.push(email + ': ' + current + ' -> ' + target);
    }
    if (cWith !== -1) {
      const partners = hit.partners.filter(function (p, idx, a) { return a.indexOf(p) === idx; }).join('; ');
      if (String(values[i][cWith] || '') !== partners) {
        apps.getRange(i + 1, cWith + 1).setValue(partners);
      }
    }
  }
  return changed;
}

// Step 2: a pair is mutual when the mentee's picks and the mentor's picks
// (from their Profile Links responses) both include this pair. Such rows
// move from 'proposed' to 'mutual-interest' for the committee to approve.
// When picks collide (e.g. two mentees mutually matched with a one-slot
// mentor), suggestOptimalAssignment_ proposes the fit-maximizing subset.
function detectMutualInterest_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const links = ss.getSheetByName(PROFILE_LINKS_SHEET);
  const pickedPairs = { mentee: {}, mentor: {} };
  if (links && links.getLastRow() > 1) {
    links.getRange(2, 1, links.getLastRow() - 1, PROFILE_LINK_HEADERS.length)
      .getValues().forEach(function (r) {
        const role = String(r[1]), picks = String(r[9] || '');
        if (!picks || !pickedPairs[role]) return;
        const byCode = {};
        try {
          JSON.parse(r[4] || '[]').forEach(function (c) { byCode[c.code] = c.pair_key; });
        } catch (e) { return; }
        picks.split(',').forEach(function (code) {
          const pk = byCode[code.trim()];
          if (pk) pickedPairs[role][pk] = true;
        });
      });
  }

  const m = matchRows_();
  const newlyMutual = [];
  const mutualRows = [];
  m.rows.forEach(function (r, i) {
    const st = String(r[mcol_('status')]).trim().toLowerCase();
    const pk = String(r[mcol_('pair_key')]);
    const isMutual = pickedPairs.mentee[pk] && pickedPairs.mentor[pk];
    if (st === 'proposed' && isMutual) {
      m.sheet.getRange(i + 2, mcol_('status') + 1).setValue('mutual-interest');
      newlyMutual.push(r);
      mutualRows.push(r);
    } else if (st === 'mutual-interest') {
      mutualRows.push(r);
    }
  });

  return {
    newlyMutual: newlyMutual,
    suggestion: suggestOptimalAssignment_(mutualRows, m.rows)
  };
}

// Greedy fit-maximizing assignment across mutual-interest pairs, respecting
// one match per mentee and each mentor's remaining slots. Greedy on sorted
// scores is a solid committee suggestion; final say stays human.
function suggestOptimalAssignment_(mutualRows, allRows) {
  const slotUse = {};
  allRows.forEach(function (r) {
    const st = String(r[mcol_('status')]).trim().toLowerCase();
    if (SLOT_CONSUMING_STATUSES.indexOf(st) !== -1) {
      const me = String(r[mcol_('mentor_email')]).toLowerCase();
      slotUse[me] = (slotUse[me] || 0) + 1;
    }
  });
  const applicants = readApplicants();
  const mentorSlots = {};
  applicants.forEach(function (a) { if (a.role === 'mentor') mentorSlots[a.email] = a.slots; });

  const sorted = mutualRows.slice().sort(function (a, b) {
    return Number(b[mcol_('score_total_pct')]) - Number(a[mcol_('score_total_pct')]);
  });
  const menteeTaken = {}, assigned = [], conflicted = [];
  sorted.forEach(function (r) {
    const mentee = String(r[mcol_('mentee_email')]).toLowerCase();
    const mentor = String(r[mcol_('mentor_email')]).toLowerCase();
    const free = (mentorSlots[mentor] || 1) - (slotUse[mentor] || 0);
    if (!menteeTaken[mentee] && free > 0) {
      menteeTaken[mentee] = true;
      slotUse[mentor] = (slotUse[mentor] || 0) + 1;
      assigned.push(r);
    } else {
      conflicted.push(r);
    }
  });
  return { assigned: assigned, conflicted: conflicted };
}

// Step 3: move approved pairs through compact -> activation -> surveys,
// with one reminder per artifact and stall flags for the digest.
function progressLifecycle_() {
  const settings = getSettings();
  const now = Date.now();
  const days = function (iso) {
    const t = new Date(iso).getTime();
    return isNaN(t) ? null : (now - t) / 86400000;
  };
  const report = { compactsSent: [], activated: [], reminders: [], stalled: [], surveysSent: [] };
  const m = matchRows_();

  // 3a. admin-approved -> send compacts + toolkits to both, mark compact-sent
  m.rows.forEach(function (r, i) {
    if (String(r[mcol_('status')]).trim().toLowerCase() !== 'admin-approved') return;
    const pk = String(r[mcol_('pair_key')]);
    [['mentee', 'mentee_email', 'mentee_name', 'mentor_email'],
     ['mentor', 'mentor_email', 'mentor_name', 'mentee_email']].forEach(function (side) {
      const token = upsertCompact_(pk, side[0], String(r[mcol_(side[1])]).toLowerCase(),
        String(r[mcol_(side[2])]), String(r[mcol_(side[3])]).toLowerCase());
      sendCompactEmail_(String(r[mcol_(side[1])]), String(r[mcol_(side[2])]), token);
      sendToolkitEmail_(String(r[mcol_(side[1])]), String(r[mcol_(side[2])]), side[0]);
    });
    m.sheet.getRange(i + 2, mcol_('status') + 1).setValue('compact-sent');
    report.compactsSent.push(pk);
  });

  // 3b. compact-sent -> active when both parties have signed
  const compacts = tokenSheetRows_(COMPACTS_SHEET, COMPACT_HEADERS);
  const signedByPair = {};
  compacts.rows.forEach(function (r) {
    const pk = String(r[1]);
    if (!signedByPair[pk]) signedByPair[pk] = 0;
    if (String(r[8])) signedByPair[pk]++;   // signed_at
  });
  m.rows.forEach(function (r, i) {
    if (String(r[mcol_('status')]).trim().toLowerCase() !== 'compact-sent') return;
    const pk = String(r[mcol_('pair_key')]);
    if ((signedByPair[pk] || 0) >= 2) {
      activatePair_(m.sheet, i + 2, r);
      report.activated.push(pk);
    }
  });

  // 3c. reminders (one each) + stall flags, across all token artifacts
  const artifacts = [
    { name: 'blinded profiles', sheet: PROFILE_LINKS_SHEET, headers: PROFILE_LINK_HEADERS,
      sentCol: 6, doneCol: 8, remCol: 10, emailCol: 2, nameCol: 3,
      link: function (t) { return MENTORSHIP_SITE_URL + 'matches.html?t=' + t; },
      what: 'your blinded candidate matches' },
    { name: 'compact', sheet: COMPACTS_SHEET, headers: COMPACT_HEADERS,
      sentCol: 6, doneCol: 8, remCol: 10, emailCol: 3, nameCol: 4,
      link: function (t) { return MENTORSHIP_SITE_URL + 'compact.html?t=' + t; },
      what: 'the Mentorship Program Compact (your match is waiting on your signature)' },
    { name: 'survey', sheet: SURVEYS_SHEET, headers: SURVEY_HEADERS,
      sentCol: 6, doneCol: 8, remCol: 9, emailCol: 4, nameCol: 5,
      link: function (t) { return MENTORSHIP_SITE_URL + 'survey.html?t=' + t; },
      what: 'your mentorship survey' }
  ];
  artifacts.forEach(function (a) {
    const t = tokenSheetRows_(a.sheet, a.headers);
    t.rows.forEach(function (r, i) {
      if (String(r[a.doneCol])) return;                  // already responded/signed
      const age = days(String(r[a.sentCol]));
      if (age === null) return;
      const reminders = Number(r[a.remCol]) || 0;
      if (age >= settings.reminder_after_days && reminders < 1) {
        sendMail_(String(r[a.emailCol]),
          MENTORSHIP_PROGRAM + ' - reminder: ' + a.name,
          'Hi ' + (String(r[a.nameCol]) || 'there') + ',\n\n' +
          'A quick reminder about ' + a.what + ':\n' +
          a.link(String(r[0])) + '\n\n' +
          'It takes just a few minutes. If anything is unclear, reply to this ' +
          'email and the committee will help.\n\n- The ISEV-SNEV Mentorship Committee');
        t.sheet.getRange(i + 2, a.remCol + 1).setValue(reminders + 1);
        report.reminders.push(a.name + ': ' + String(r[a.emailCol]));
      }
      if (age >= settings.stalled_after_days) {
        report.stalled.push(a.name + ': ' + String(r[a.emailCol]) +
          ' (' + Math.floor(age) + ' days, no response)');
      }
    });
  });

  // 3d. surveys due: 6-month check-in and 12-month closeout per active pair
  const surveys = tokenSheetRows_(SURVEYS_SHEET, SURVEY_HEADERS);
  const surveyKey = {};
  surveys.rows.forEach(function (r) { surveyKey[String(r[1]) + '|' + String(r[2]) + '|' + String(r[4]).toLowerCase()] = true; });
  m.rows.forEach(function (r) {
    if (String(r[mcol_('status')]).trim().toLowerCase() !== 'active') return;
    const started = days(String(r[mcol_('match_start')]));
    if (started === null) return;
    const pk = String(r[mcol_('pair_key')]);
    [['6mo', settings.checkin_after_days], ['12mo', settings.closeout_after_days]].forEach(function (wave) {
      if (started < wave[1]) return;
      [['mentee', 'mentee_email', 'mentee_name'], ['mentor', 'mentor_email', 'mentor_name']].forEach(function (side) {
        const email = String(r[mcol_(side[1])]).toLowerCase();
        if (surveyKey[pk + '|' + wave[0] + '|' + email]) return;
        const token = appendTokenRow_(SURVEYS_SHEET,
          [null, pk, wave[0], side[0], email, String(r[mcol_(side[2])]),
           new Date().toISOString(), '', '', 0, '']);
        sendMail_(email,
          MENTORSHIP_PROGRAM + ' - ' + (wave[0] === '6mo' ? '6-month check-in' : '12-month closeout survey'),
          'Hi ' + String(r[mcol_(side[2])]) + ',\n\n' +
          (wave[0] === '6mo'
            ? 'You are halfway through your mentorship cycle - we would love a 2-minute check-in on how it is going:'
            : 'Your 12-month mentorship cycle is wrapping up - congratulations! Please take ~5 minutes for the closeout survey; it directly shapes the next cycle:') +
          '\n' + MENTORSHIP_SITE_URL + 'survey.html?t=' + token + '\n\n' +
          'Your answers are visible to the program committee only - never to your ' +
          'mentorship counterpart.\n\n- The ISEV-SNEV Mentorship Committee');
        surveyKey[pk + '|' + wave[0] + '|' + email] = true;
        report.surveysSent.push(wave[0] + ': ' + email);
      });
    });
  });

  return report;
}

function activatePair_(sheet, rowIndex, r) {
  const today = new Date().toISOString().slice(0, 10);
  sheet.getRange(rowIndex, mcol_('status') + 1).setValue('active');
  sheet.getRange(rowIndex, mcol_('match_start') + 1).setValue(today);
  const menteeName = String(r[mcol_('mentee_name')]), mentorName = String(r[mcol_('mentor_name')]);
  const menteeEmail = String(r[mcol_('mentee_email')]), mentorEmail = String(r[mcol_('mentor_email')]);
  GmailApp.sendEmail(menteeEmail + ',' + mentorEmail,
    MENTORSHIP_PROGRAM + ' - meet your match!',
    'Dear ' + menteeName + ' and ' + mentorName + ',\n\n' +
    'Both of you have signed the Mentorship Program Compact - your 12-month ' +
    'mentorship officially starts today.\n\n' +
    '  Mentee: ' + menteeName + ' <' + menteeEmail + '>\n' +
    '  Mentor: ' + mentorName + ' <' + mentorEmail + '>\n\n' +
    'Next step: the mentee schedules the first one-hour video call within the ' +
    'next two weeks. Use the compact checklist you both signed as the agenda ' +
    'for that first meeting - goals, meeting cadence, and communication ' +
    'preferences.\n\nWe will check in at the 6-month mark. Questions any time: ' +
    'just reply to this email.\n\n- The ISEV-SNEV Mentorship Committee',
    { name: 'ISEV-SNEV Mentorship Committee', replyTo: DIGEST_EMAIL });
  // Pool status flips (matched-pending -> matched) land on the next daily run.
}

function sendCompactEmail_(email, name, token) {
  sendMail_(email,
    MENTORSHIP_PROGRAM + ' - you have a match! Please sign the compact',
    'Hi ' + name + ',\n\n' +
    'Great news: the committee has approved a mentorship match for you. ' +
    'The final step before we introduce you to each other is the Mentorship ' +
    'Program Compact - a short agreement both sides sign that sets ' +
    'expectations for the year.\n\n' +
    'Read and sign it here (takes ~3 minutes):\n' +
    MENTORSHIP_SITE_URL + 'compact.html?t=' + token + '\n\n' +
    'Once both of you have signed, we will introduce you by email and your ' +
    '12-month cycle begins.\n\n- The ISEV-SNEV Mentorship Committee');
}

function sendToolkitEmail_(email, name, role) {
  const fileName = role === 'mentor' ? 'Mentor Toolkit.pdf' : 'Mentee Toolkit.pdf';
  let attachment = null;
  const folders = DriveApp.getFoldersByName(TOOLKIT_FOLDER);
  if (folders.hasNext()) {
    const files = folders.next().getFilesByName(fileName);
    if (files.hasNext()) attachment = files.next().getBlob();
  }
  GmailApp.sendEmail(email,
    MENTORSHIP_PROGRAM + ' - your ' + role + ' toolkit',
    'Hi ' + name + ',\n\n' +
    (attachment
      ? 'Attached is your ' + role + ' toolkit - practical guidance for getting ' +
        'the most out of the mentorship year. Skim it before your first meeting.'
      : 'Your ' + role + ' toolkit will follow in a separate email from the ' +
        'committee shortly.') +
    '\n\n- The ISEV-SNEV Mentorship Committee',
    Object.assign({ name: 'ISEV-SNEV Mentorship Committee', replyTo: DIGEST_EMAIL },
      attachment ? { attachments: [attachment] } : {}));
}

/* ---- generic token-sheet helpers (Compacts / Surveys) ---- */

function tokenSheetRows_(sheetName, headers) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return { sheet: sheet, rows: [] };
  return { sheet: sheet, rows: sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues() };
}

function appendTokenRow_(sheetName, values) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Run Setup first: "' + sheetName + '" tab is missing.');
  const token = Utilities.getUuid().replace(/-/g, '');
  values[0] = token;
  sheet.appendRow(values);
  return token;
}

// One compact row per (pair, person); re-approving re-sends the same link.
function upsertCompact_(pairKey, role, email, name, counterpartEmail) {
  const t = tokenSheetRows_(COMPACTS_SHEET, COMPACT_HEADERS);
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][1]) === pairKey && String(t.rows[i][3]).toLowerCase() === email) {
      t.sheet.getRange(i + 2, 7).setValue(new Date().toISOString()); // sent_at
      return String(t.rows[i][0]);
    }
  }
  return appendTokenRow_(COMPACTS_SHEET,
    [null, pairKey, role, email, name, counterpartEmail,
     new Date().toISOString(), '', '', '', 0]);
}

function findTokenRow_(sheetName, headers, token) {
  if (!token || String(token).length < 16) return null;
  const t = tokenSheetRows_(sheetName, headers);
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][0]) === String(token)) {
      return { sheet: t.sheet, index: i + 2, values: t.rows[i] };
    }
  }
  return null;
}

/* ---- doGet handlers for compact.html and survey.html ---- */

function serveCompact_(p) {
  const hit = findTokenRow_(COMPACTS_SHEET, COMPACT_HEADERS, p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  hit.sheet.getRange(hit.index, 8).setValue(new Date().toISOString()); // viewed_at
  return jsonReply_({
    ok: true,
    role: String(hit.values[2]),
    name: String(hit.values[4]),
    signed: !!String(hit.values[8]),
    signed_name: String(hit.values[9] || '')
  });
}

function signCompact_(p) {
  const hit = findTokenRow_(COMPACTS_SHEET, COMPACT_HEADERS, p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  const name = String(p.signed_name || '').trim();
  if (!name || String(p.agree) !== '1') {
    return jsonReply_({ ok: false, error: 'signature_required' });
  }
  if (!String(hit.values[8])) {
    hit.sheet.getRange(hit.index, 9).setValue(new Date().toISOString()); // signed_at
    hit.sheet.getRange(hit.index, 10).setValue(name);                    // signed_name
  }
  // If the counterpart already signed, activate the pair right now instead
  // of waiting for the nightly run.
  const pk = String(hit.values[1]);
  const compacts = tokenSheetRows_(COMPACTS_SHEET, COMPACT_HEADERS);
  const signedCount = compacts.rows.filter(function (r) {
    return String(r[1]) === pk && (String(r[8]) || String(r[0]) === String(p.t));
  }).length;
  let activated = false;
  if (signedCount >= 2) {
    const m = matchRows_();
    m.rows.forEach(function (r, i) {
      if (String(r[mcol_('pair_key')]) === pk &&
          String(r[mcol_('status')]).trim().toLowerCase() === 'compact-sent') {
        activatePair_(m.sheet, i + 2, r);
        activated = true;
      }
    });
  }
  sendMail_(DIGEST_EMAIL,
    MENTORSHIP_PROGRAM + ' - compact signed by ' + hit.values[3],
    hit.values[4] + ' <' + hit.values[3] + '> signed the compact for pair ' + pk +
    (activated ? '\n\nBoth parties have now signed - the pair was activated and introduced automatically.' :
     '\n\nWaiting on the counterpart\'s signature.') +
    '\n\nSheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  return jsonReply_({ ok: true, activated: activated });
}

function serveSurvey_(p) {
  const hit = findTokenRow_(SURVEYS_SHEET, SURVEY_HEADERS, p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  hit.sheet.getRange(hit.index, 8).setValue(new Date().toISOString()); // viewed_at
  return jsonReply_({
    ok: true,
    wave: String(hit.values[2]),
    role: String(hit.values[3]),
    name: String(hit.values[5]).split(' ')[0],
    responded: !!String(hit.values[8])
  });
}

function submitSurvey_(p) {
  const hit = findTokenRow_(SURVEYS_SHEET, SURVEY_HEADERS, p.t);
  if (!hit) return jsonReply_({ ok: false, error: 'invalid_link' });
  let answers;
  try { answers = JSON.parse(p.answers || '{}'); } catch (e) {
    return jsonReply_({ ok: false, error: 'bad_answers' });
  }
  hit.sheet.getRange(hit.index, 9).setValue(new Date().toISOString());   // responded_at
  hit.sheet.getRange(hit.index, 11).setValue(JSON.stringify(answers));   // answers_json
  sendMail_(DIGEST_EMAIL,
    MENTORSHIP_PROGRAM + ' - ' + hit.values[2] + ' survey response from ' + hit.values[4],
    hit.values[5] + ' (' + hit.values[3] + ', pair ' + hit.values[1] + ') responded:\n\n' +
    Object.keys(answers).map(function (k) { return k + ': ' + answers[k]; }).join('\n') +
    '\n\nSheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  return jsonReply_({ ok: true });
}

/* ---------------- Weekly snapshot backup ---------------- */

function weeklySnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);

  const stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  file.makeCopy(ss.getName() + ' - backup ' + stamp, folder);

  // Retention: keep the newest BACKUPS_TO_KEEP copies.
  const backups = [];
  const iter = folder.getFiles();
  while (iter.hasNext()) {
    const f = iter.next();
    if (f.getName().indexOf(' - backup ') !== -1) backups.push(f);
  }
  backups.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  backups.slice(BACKUPS_TO_KEEP).forEach(function (f) { f.setTrashed(true); });
}
