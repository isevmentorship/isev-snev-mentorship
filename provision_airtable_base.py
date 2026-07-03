#!/usr/bin/env python3
"""
ISEV-SNEV Mentorship Program -- Airtable base provisioner.

Creates (or updates) the Airtable schema described in ARCHITECTURE.md §4
for a base you already own. Idempotent -- re-running skips tables/fields
that already exist and only adds what is missing.

USAGE
-----
1. In Airtable: create an empty base called "ISEV-SNEV Mentorship"
   (or any name you like) in the workspace of your choice.
2. Get a Personal Access Token at
   https://airtable.com/create/tokens with these scopes:
        schema.bases:read
        schema.bases:write
        data.records:read
        data.records:write
   and grant it access to the base you just created.
3. Run:
        python3 provision_airtable_base.py
   It will prompt you for:
        - the token (input is hidden; paste it and press Enter)
        - the base name (default: "ISEV-SNEV Mentorship")
4. On success the script prints the base ID. Send that ID back
   to the assistant so the form->Airtable pipeline can be wired up.

This script talks ONLY to https://api.airtable.com and stores nothing
locally. The token never touches disk.
"""

import getpass
import json
import os
import sys
import urllib.error
import urllib.request

API_ROOT = "https://api.airtable.com/v0"


# ---------------------------------------------------------------------------
# Canonical taxonomies (must match ARCHITECTURE.md §3).
# ---------------------------------------------------------------------------

TOPIC_AREAS = [
    "Career transition",
    "Industry career advancement",
    "Academic career advancement",
    "Grant writing and fellowship applications",
    "Professional networking",
    "Job search and interviewing",
    "Communication and presentation",
    "Leadership and management",
    "Long-term career trajectory",
    "Work-life integration and wellbeing",
    "DEI in STEM",
    "Publishing strategy",
    "Mentoring and supervising others",
    "International career moves",
]

FOCUS_AREAS = [
    "EV biology and biogenesis",
    "EV biomarkers",
    "EV therapeutics and delivery",
    "EV imaging and single-vesicle characterization",
    "EV proteomics / lipidomics / nucleic acids",
    "EVs in neurodegeneration",
    "EVs in cancer",
    "EVs in infectious disease",
    "EVs in cardiovascular disease",
    "EVs in reproductive biology",
    "EVs in immunology and inflammation",
    "EVs in development and regeneration",
    "EV isolation and purification methods",
    "EV standardization and MISEV guidelines",
    "Other",
]

TIME_ZONES = [
    ("America/Los_Angeles", "Pacific - US/Canada West",        -8),
    ("America/Denver",      "Mountain - US/Canada",            -7),
    ("America/Chicago",     "Central - US/Canada/Mexico",      -6),
    ("America/New_York",    "Eastern - US/Canada",             -5),
    ("America/Mexico_City", "Mexico City",                     -6),
    ("America/Bogota",      "Bogotá / Lima",                   -5),
    ("America/Sao_Paulo",   "São Paulo / Brasília",            -3),
    ("America/Buenos_Aires","Buenos Aires",                    -3),
    ("Europe/London",       "London / Lisbon",                  0),
    ("Europe/Paris",        "Paris / Berlin / Madrid / Rome",   1),
    ("Europe/Helsinki",     "Helsinki / Athens / Istanbul",     2),
    ("Africa/Johannesburg", "Johannesburg / Cairo",             2),
    ("Asia/Dubai",          "Dubai / Abu Dhabi",                4),
    ("Asia/Tehran",         "Tehran",                           3),  # nominal
    ("Asia/Kolkata",        "India",                            5),  # nominal (5:30)
    ("Asia/Singapore",      "Singapore / Beijing / Hong Kong",  8),
    ("Asia/Tokyo",          "Tokyo / Seoul",                    9),
    ("Australia/Sydney",    "Sydney / Melbourne",              10),
    ("Pacific/Auckland",    "Auckland / Wellington",           12),
    ("Other",               "Other",                            0),
]

APPLICATION_STATUSES = [
    "submitted",
    "accepted",
    "declined",
    "withdrawn",
    "matched",
    "graduated",
    "re-enrollable",
]

MATCH_STATUSES = [
    "proposed",
    "mutual-interest",
    "admin-approved",
    "compact-sent",
    "compact-signed",
    "active",
    "completed",
    "terminated-early",
]

CAREER_STAGES = [
    "Undergraduate",
    "Master's student",
    "PhD candidate",
    "Postdoc",
    "Staff scientist",
    "Assistant professor / junior PI",
    "Associate / Full professor",
    "Clinician-scientist",
    "Industry researcher",
    "Other",
]

LANGUAGE_OPTIONS = [
    "English", "Spanish", "Portuguese", "French", "German", "Italian",
    "Mandarin", "Japanese", "Korean", "Hindi", "Arabic", "Other",
]

MEMBERSHIP_OPTIONS = ["Neither", "SNEV only", "ISEV only", "Both"]

AVAILABILITY_WINDOWS = [
    "Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends",
]

MEETING_FREQUENCIES = [
    "Bi-monthly (program default)",
    "Monthly",
    "Flexible",
]

# Color cycling for single-select option records -- Airtable requires us to
# specify a color, but any valid color works.
COLORS = [
    "blueLight2", "cyanLight2", "tealLight2", "greenLight2", "yellowLight2",
    "orangeLight2", "redLight2", "pinkLight2", "purpleLight2", "grayLight2",
]


def as_choice(name, i):
    return {"name": name, "color": COLORS[i % len(COLORS)]}


def to_choices(seq):
    return [as_choice(s, i) for i, s in enumerate(seq)]


# ---------------------------------------------------------------------------
# HTTP helpers.
# ---------------------------------------------------------------------------

class APIError(Exception):
    pass


def request(method, path, token, body=None):
    url = API_ROOT + path
    data = None
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise APIError(f"{method} {path} -> {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise APIError(f"{method} {path} -> network error: {e}") from None


# ---------------------------------------------------------------------------
# Top-level provisioning.
# ---------------------------------------------------------------------------

def find_base(token, base_name):
    data = request("GET", "/meta/bases", token)
    for base in data.get("bases", []):
        if base["name"].strip().lower() == base_name.strip().lower():
            return base["id"]
    return None


def list_tables(token, base_id):
    data = request("GET", f"/meta/bases/{base_id}/tables", token)
    return {t["name"]: t for t in data.get("tables", [])}


def create_table(token, base_id, spec):
    existing = list_tables(token, base_id)
    if spec["name"] in existing:
        print(f"  · table '{spec['name']}' already exists, skipping create")
        return existing[spec["name"]]
    print(f"  + creating table '{spec['name']}'")
    return request("POST", f"/meta/bases/{base_id}/tables", token, spec)


def ensure_fields(token, base_id, table, field_specs):
    """Add any fields missing from `table` (by name). Idempotent."""
    existing_names = {f["name"] for f in table.get("fields", [])}
    for spec in field_specs:
        if spec["name"] in existing_names:
            continue
        print(f"    + {table['name']}.{spec['name']} ({spec['type']})")
        try:
            request(
                "POST",
                f"/meta/bases/{base_id}/tables/{table['id']}/fields",
                token,
                spec,
            )
        except APIError as e:
            print(f"    ! failed to add {spec['name']}: {e}")


# ---------------------------------------------------------------------------
# Table specifications.
# ---------------------------------------------------------------------------

def applicants_fields():
    return [
        {"name": "role", "type": "singleSelect",
         "options": {"choices": to_choices(["mentor", "mentee"])}},
        {"name": "status", "type": "singleSelect",
         "options": {"choices": to_choices(APPLICATION_STATUSES)}},
        {"name": "full_name", "type": "singleLineText"},
        {"name": "email", "type": "email"},
        {"name": "affiliation", "type": "singleLineText"},
        {"name": "affiliation_normalized", "type": "formula",
         "options": {"formula":
             "LOWER(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({affiliation},\",\",\"\"),\".\",\"\"),\"  \",\" \"),\"University\",\"\"),\"university\",\"\"),\"Institute\",\"\"),\"institute\",\"\"),\" of \",\" \"))"
         }},
        {"name": "email_domain", "type": "formula",
         "options": {"formula":
             "LOWER(IF(FIND('@',{email}),MID({email},FIND('@',{email})+1,100),''))"
         }},
        {"name": "country", "type": "singleLineText"},
        {"name": "timezone", "type": "singleSelect",
         "options": {"choices": to_choices([tz[0] for tz in TIME_ZONES])}},
        {"name": "languages", "type": "multipleSelects",
         "options": {"choices": to_choices(LANGUAGE_OPTIONS)}},
        {"name": "career_stage", "type": "singleSelect",
         "options": {"choices": to_choices(CAREER_STAGES)}},
        {"name": "membership", "type": "singleSelect",
         "options": {"choices": to_choices(MEMBERSHIP_OPTIONS)}},
        # Primary career topics (shared by both roles).
        # For mentees: their top-priority topics for mentorship.
        # For mentors: their strongest topics to mentor on.
        {"name": "topic_primary_rank_1", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_primary_rank_2", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_primary_rank_3", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_primary_rank_4", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_primary_rank_5", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        # Secondary career topics (mentee-only at the UI layer, but the fields
        # exist for both roles to keep queries uniform; mentors leave them
        # blank).
        {"name": "topic_secondary_rank_1", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_secondary_rank_2", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_secondary_rank_3", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_secondary_rank_4", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "topic_secondary_rank_5", "type": "singleSelect",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        # Legacy multi-select of everything a mentor could mentor on. Kept
        # for ad-hoc admin use but no longer the primary signal.
        {"name": "topic_offered", "type": "multipleSelects",
         "options": {"choices": to_choices(TOPIC_AREAS)}},
        {"name": "focus_areas", "type": "multipleSelects",
         "options": {"choices": to_choices(FOCUS_AREAS)}},
        {"name": "short_bio", "type": "multilineText"},
        {"name": "goals_summary", "type": "multilineText"},
        {"name": "meeting_frequency_pref", "type": "singleSelect",
         "options": {"choices": to_choices(MEETING_FREQUENCIES)}},
        {"name": "availability_windows", "type": "multipleSelects",
         "options": {"choices": to_choices(AVAILABILITY_WINDOWS)}},
        {"name": "mentor_capacity", "type": "number",
         "options": {"precision": 0}},
        {"name": "prof_dev_ack", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "consent_12_month", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "consent_review", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "consent_contact", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "consent_unblind", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "accepted_at", "type": "date",
         "options": {"dateFormat": {"name": "iso"}}},
        {"name": "cycle_label", "type": "singleLineText"},
        {"name": "private_notes", "type": "multilineText"},
        {"name": "submitted_at", "type": "createdTime",
         "options": {"result": {"type": "dateTime",
                                "options": {"dateFormat": {"name": "iso"},
                                            "timeFormat": {"name": "24hour"},
                                            "timeZone": "utc"}}}},
    ]


def matches_fields():
    return [
        {"name": "status", "type": "singleSelect",
         "options": {"choices": to_choices(MATCH_STATUSES)}},
        {"name": "score_total", "type": "number", "options": {"precision": 2}},
        {"name": "score_topic_overlap", "type": "number", "options": {"precision": 2}},
        {"name": "score_focus_overlap", "type": "number", "options": {"precision": 2}},
        {"name": "score_timezone_delta_hours", "type": "number", "options": {"precision": 1}},
        {"name": "admin_generated", "type": "checkbox",
         "options": {"icon": "check", "color": "yellowBright"}},
        {"name": "mentor_selected", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "mentee_selected", "type": "checkbox",
         "options": {"icon": "check", "color": "greenBright"}},
        {"name": "proposed_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "admin_approved_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "dropbox_sign_request_id", "type": "singleLineText"},
        {"name": "compact_signed_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "toolkits_sent_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "start_date", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "completed_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "terminated_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "termination_reason", "type": "multilineText"},
        {"name": "admin_notes", "type": "multilineText"},
    ]


def toolkit_fields():
    return [
        {"name": "delivery_type", "type": "singleSelect",
         "options": {"choices": to_choices(["mentor_toolkit", "mentee_toolkit", "compact", "welcome_email"])}},
        {"name": "status", "type": "singleSelect",
         "options": {"choices": to_choices(["queued", "sent", "failed"])}},
        {"name": "sent_at", "type": "date", "options": {"dateFormat": {"name": "iso"}}},
        {"name": "notes", "type": "multilineText"},
    ]


def audit_log_fields():
    return [
        {"name": "action", "type": "singleSelect",
         "options": {"choices": to_choices([
             "application_accepted",
             "application_declined",
             "application_withdrawn",
             "match_proposed",
             "match_approved",
             "match_manually_generated",
             "compact_sent",
             "compact_signed",
             "match_activated",
             "match_completed",
             "match_terminated_early",
             "settings_changed",
             "data_export",
             "data_purge",
         ])}},
        {"name": "actor_email", "type": "email"},
        {"name": "target_application_id", "type": "singleLineText"},
        {"name": "target_match_id", "type": "singleLineText"},
        {"name": "details", "type": "multilineText"},
        {"name": "logged_at", "type": "createdTime",
         "options": {"result": {"type": "dateTime",
                                "options": {"dateFormat": {"name": "iso"},
                                            "timeFormat": {"name": "24hour"},
                                            "timeZone": "utc"}}}},
    ]


def settings_fields():
    return [
        {"name": "weight_topic_overlap", "type": "number", "options": {"precision": 2}},
        {"name": "weight_focus_overlap", "type": "number", "options": {"precision": 2}},
        {"name": "secondary_topic_weight", "type": "number", "options": {"precision": 2}},
        {"name": "locality_window_hours", "type": "number", "options": {"precision": 0}},
        {"name": "allow_same_institution", "type": "checkbox",
         "options": {"icon": "check", "color": "redBright"}},
        {"name": "consumer_email_domains", "type": "multilineText"},
        {"name": "match_threshold_percent", "type": "number", "options": {"precision": 0}},
        {"name": "mentor_unfilled_escalation_days", "type": "number", "options": {"precision": 0}},
        {"name": "unmatched_mentee_escalation_days", "type": "number", "options": {"precision": 0}},
        {"name": "compact_reminder_days", "type": "singleLineText"},
        {"name": "compact_expiration_days", "type": "number", "options": {"precision": 0}},
        {"name": "cycle_label_default", "type": "singleLineText"},
        {"name": "mentor_toolkit_url", "type": "url"},
        {"name": "mentee_toolkit_url", "type": "url"},
        {"name": "compact_template_url", "type": "url"},
        {"name": "committee_email", "type": "email"},
    ]


def topic_areas_fields():
    return [
        {"name": "topic_label", "type": "singleLineText"},
        {"name": "sort_order", "type": "number", "options": {"precision": 0}},
        {"name": "description", "type": "multilineText"},
        {"name": "synonyms", "type": "singleLineText"},
    ]


def focus_areas_fields():
    return [
        {"name": "focus_label", "type": "singleLineText"},
        {"name": "sort_order", "type": "number", "options": {"precision": 0}},
    ]


def time_zones_fields():
    return [
        {"name": "human_label", "type": "singleLineText"},
        {"name": "utc_offset", "type": "number", "options": {"precision": 1}},
        {"name": "sort_order", "type": "number", "options": {"precision": 0}},
    ]


# ---------------------------------------------------------------------------
# Seed rows.
# ---------------------------------------------------------------------------

def seed_settings(token, base_id, settings_table):
    # Only seed if the table is empty.
    data = request("GET", f"/{base_id}/{settings_table['id']}?maxRecords=1", token)
    if data.get("records"):
        print("  · Settings already has a row, leaving it alone")
        return
    print("  + inserting default Settings row")
    fields = {
        "weight_topic_overlap": 0.70,
        "weight_focus_overlap": 0.30,
        "secondary_topic_weight": 0.30,
        "locality_window_hours": 5,
        "allow_same_institution": False,
        "consumer_email_domains":
            "gmail.com\noutlook.com\nhotmail.com\nyahoo.com\n"
            "icloud.com\nproton.me\nprotonmail.com",
        "match_threshold_percent": 50,
        "mentor_unfilled_escalation_days": 30,
        "unmatched_mentee_escalation_days": 30,
        "compact_reminder_days": "7, 10, 13",
        "compact_expiration_days": 14,
        "cycle_label_default": "Spring 2026",
        "committee_email": "isevmentorship@gmail.com",
    }
    request("POST", f"/{base_id}/{settings_table['id']}",
            token, {"records": [{"fields": fields}]})


def seed_taxonomy(token, base_id, table, label_field, items):
    data = request("GET", f"/{base_id}/{table['id']}?maxRecords=1", token)
    if data.get("records"):
        print(f"  · {table['name']} already populated, leaving it alone")
        return
    print(f"  + seeding {table['name']} with {len(items)} rows")
    records = []
    if isinstance(items[0], tuple):
        for i, row in enumerate(items, start=1):
            iana, label, offset = row
            records.append({"fields": {
                "Name": iana, "human_label": label,
                "utc_offset": offset, "sort_order": i,
            }})
    else:
        for i, name in enumerate(items, start=1):
            records.append({"fields": {
                "Name": name, label_field: name, "sort_order": i,
            }})
    # Airtable caps at 10 records per create call.
    for start in range(0, len(records), 10):
        chunk = records[start:start + 10]
        request("POST", f"/{base_id}/{table['id']}",
                token, {"records": chunk})


# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------

def main():
    print("ISEV-SNEV Mentorship · Airtable base provisioner")
    print("-------------------------------------------------")
    token = os.environ.get("AIRTABLE_TOKEN")
    if not token:
        token = getpass.getpass("Airtable personal access token (hidden): ").strip()
    if not token:
        print("No token provided. Aborting.", file=sys.stderr)
        sys.exit(1)

    base_name = input(
        "Base name [ISEV-SNEV Mentorship]: "
    ).strip() or "ISEV-SNEV Mentorship"

    print(f"\nLooking for base '{base_name}'…")
    try:
        base_id = find_base(token, base_name)
    except APIError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

    if not base_id:
        print(f"Couldn't find a base called '{base_name}'.")
        print("Please create an empty base in Airtable with that exact name,")
        print("make sure your token has access to it, and re-run this script.")
        sys.exit(3)

    print(f"Found base: {base_id}")

    # Build in dependency order: taxonomies first, then Applicants, then
    # Matches (which links to Applicants), then Toolkits, Audit Log, Settings.
    table_plan = [
        ("Topic Areas", topic_areas_fields()),
        ("Focus Areas", focus_areas_fields()),
        ("Time Zones",  time_zones_fields()),
        ("Applicants",  applicants_fields()),
        ("Matches",     matches_fields()),
        ("Toolkit Deliveries", toolkit_fields()),
        ("Audit Log",   audit_log_fields()),
        ("Settings",    settings_fields()),
    ]

    print("\nProvisioning tables…")
    table_cache = {}
    for name, fields in table_plan:
        spec = {
            "name": name,
            "fields": [{"name": "Name", "type": "singleLineText"}] + fields,
        }
        table = create_table(token, base_id, spec)
        # If we skipped creation we must re-fetch to get the id + fields.
        if not table.get("id"):
            table = list_tables(token, base_id).get(name)
        table_cache[name] = table

    # Idempotent field-addition pass for tables that already existed.
    print("\nTopping up missing fields on pre-existing tables…")
    fresh = list_tables(token, base_id)
    for name, fields in table_plan:
        if name in fresh:
            ensure_fields(token, base_id, fresh[name], fields)
    fresh = list_tables(token, base_id)

    # Link fields (Matches -> Applicants). Must be done after both tables exist.
    matches = fresh.get("Matches")
    applicants = fresh.get("Applicants")
    if matches and applicants:
        existing = {f["name"] for f in matches["fields"]}
        for role_name in ("mentor", "mentee"):
            if role_name in existing:
                continue
            print(f"    + Matches.{role_name} (link to Applicants)")
            try:
                request(
                    "POST",
                    f"/meta/bases/{base_id}/tables/{matches['id']}/fields",
                    token,
                    {
                        "name": role_name,
                        "type": "multipleRecordLinks",
                        "options": {
                            "linkedTableId": applicants["id"],
                            "prefersSingleRecordLink": True,
                        },
                    },
                )
            except APIError as e:
                print(f"    ! failed to add link '{role_name}': {e}")

    # Seed taxonomies + Settings.
    print("\nSeeding taxonomies…")
    fresh = list_tables(token, base_id)
    seed_taxonomy(token, base_id, fresh["Topic Areas"], "topic_label", TOPIC_AREAS)
    seed_taxonomy(token, base_id, fresh["Focus Areas"], "focus_label", FOCUS_AREAS)
    seed_taxonomy(token, base_id, fresh["Time Zones"], "human_label", TIME_ZONES)
    seed_settings(token, base_id, fresh["Settings"])

    print("\nDone.")
    print(f"Base ID: {base_id}")
    print("Send that base ID back to the assistant so it can wire up the")
    print("form -> Airtable pipeline in the next phase.")


if __name__ == "__main__":
    main()
