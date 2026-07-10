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
const BACKUP_FOLDER = 'ISEV-SNEV Mentorship Backups';
const BACKUPS_TO_KEEP = 26;
const DIGEST_EMAIL = 'isevmentorship@gmail.com';

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
  ['max_candidates_per_mentee', 3, 'Top-N candidates proposed per mentee (§6.5)']
];

/* ---------------- Setup, menu, triggers ---------------- */

function setupMentorshipSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. status column on Applications
  const apps = ss.getSheets()[APPLICATIONS_SHEET_INDEX];
  const headers = apps.getRange(1, 1, 1, apps.getLastColumn()).getValues()[0];
  if (headers.indexOf('status') === -1) {
    apps.getRange(1, apps.getLastColumn() + 1).setValue('status');
  }

  // 2. Settings tab
  let settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS_SHEET);
    settings.getRange(1, 1, 1, 3).setValues([['key', 'value', 'notes']])
      .setFontWeight('bold');
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    settings.setColumnWidths(1, 3, 240);
  }

  // 3. Proposed Matches tab
  let matches = ss.getSheetByName(MATCHES_SHEET);
  if (!matches) {
    matches = ss.insertSheet(MATCHES_SHEET);
    matches.getRange(1, 1, 1, MATCH_HEADERS.length)
      .setValues([MATCH_HEADERS]).setFontWeight('bold');
    matches.setFrozenRows(1);
  }

  // 4. Never Match tab (§6.8)
  let never = ss.getSheetByName(NEVER_MATCH_SHEET);
  if (!never) {
    never = ss.insertSheet(NEVER_MATCH_SHEET);
    never.getRange(1, 1, 1, 3)
      .setValues([['email_a', 'email_b', 'reason']]).setFontWeight('bold');
  }

  // 5. Triggers (idempotent: remove ours, re-add)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['nightlyMatchRun', 'weeklySnapshot'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('nightlyMatchRun').timeBased().everyDays(1).atHour(2).create();
  ScriptApp.newTrigger('weeklySnapshot').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();

  SpreadsheetApp.getUi().alert(
    'Mentorship system ready.\n\n' +
    '- Mark applicants "accepted" in the new status column to admit them to the pool.\n' +
    '- Matching runs nightly at ~2am and writes to "Proposed Matches".\n' +
    '- Backups run Mondays ~4am into the Drive folder "' + BACKUP_FOLDER + '".\n' +
    '- Use the Mentorship menu to run either on demand.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mentorship')
    .addItem('Generate matches now', 'generateMatchesFromMenu')
    .addItem('Send committee digest now', 'sendDigestFromMenu')
    .addItem('Snapshot backup now', 'weeklySnapshot')
    .addSeparator()
    .addItem('Setup / repair (run once)', 'setupMentorshipSystem')
    .addToUi();
}

function generateMatchesFromMenu() {
  const result = generateMatches();
  SpreadsheetApp.getUi().alert(
    'Matching complete.\n\nProposals written: ' + result.written +
    '\nHeld below threshold: ' + result.held +
    '\nAccepted mentees in pool: ' + result.mentees +
    '\nAccepted mentors in pool: ' + result.mentors);
}

function sendDigestFromMenu() {
  sendCommitteeDigest(generateMatches());
  SpreadsheetApp.getUi().alert('Digest sent to ' + DIGEST_EMAIL + '.');
}

function nightlyMatchRun() {
  sendCommitteeDigest(generateMatches());
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
   'max_candidates_per_mentee'].forEach(function (k) { out[k] = Number(out[k]); });
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
  'institution_flag', 'status', 'committee_notes', 'pair_key'
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

function sendCommitteeDigest(result) {
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
  lines.push('');
  lines.push('Review proposals in the "Proposed Matches" tab of the applications Sheet.');

  // Skip the email only when there is truly nothing to say.
  if (!result.written && !submitted.length && !menteesWaiting.length && !mentorsIdle.length) return;

  MailApp.sendEmail({
    to: DIGEST_EMAIL,
    subject: 'Mentorship digest: ' + result.written + ' new proposal(s), ' +
             submitted.length + ' awaiting review',
    body: lines.join('\n')
  });
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
