# Airtable base provisioning — runbook

One-shot setup to turn an empty Airtable base into the full ISEV–SNEV
Mentorship base described in `ARCHITECTURE.md` §4. After this runs, eight
tables exist with all fields, single-select options, link fields, seeded
taxonomies, and one row of default Settings.

Total time: about 5 minutes.

## Prerequisites

- A Python 3 interpreter on your machine (`python3 --version` should print 3.8+).
- Your Airtable personal access token. Must include these scopes:
  - `schema.bases:read`
  - `schema.bases:write`
  - `data.records:read`
  - `data.records:write`
- The token must be granted access to the base you're going to provision.

## Steps

1. **Create an empty base.** In Airtable, click *Add a base* → *Start from scratch*.
   Name it **ISEV-SNEV Mentorship** (or any name — you'll tell the script).
   Leave the default "Table 1" in place; the script won't touch it, but you can
   delete it afterward.

2. **Download the script.** Pull `provision_airtable_base.py` from this folder
   onto your machine.

3. **Run it.** In a terminal:
   ```bash
   cd /path/to/isev-snev-mentorship
   python3 provision_airtable_base.py
   ```
   It will prompt you for:
   - Your Airtable token (input is hidden).
   - The base name (press Enter to accept the default).

4. **Watch the output.** You should see something like:
   ```
   Looking for base 'ISEV-SNEV Mentorship'…
   Found base: appXXXXXXXXXXXXXX

   Provisioning tables…
     + creating table 'Topic Areas'
     + creating table 'Focus Areas'
     + creating table 'Time Zones'
     + creating table 'Applicants'
     + creating table 'Matches'
     + creating table 'Toolkit Deliveries'
     + creating table 'Audit Log'
     + creating table 'Settings'

   Topping up missing fields on pre-existing tables…
     + Matches.mentor (link to Applicants)
     + Matches.mentee (link to Applicants)

   Seeding taxonomies…
     + seeding Topic Areas with 14 rows
     + seeding Focus Areas with 15 rows
     + seeding Time Zones with 20 rows
     + inserting default Settings row

   Done.
   Base ID: appXXXXXXXXXXXXXX
   ```

5. **Send the Base ID back.** That `appXXXXXXXXXXXXXX` is what's needed to
   wire the form submissions into the base. Paste it in the next message.

## What this script does *not* do

- It doesn't set up Interface Designer dashboards (that has to be done in the
  UI — it's a separate product from the base API).
- It doesn't create views or filters — those go on top of the tables and are
  quick to create once the schema exists.
- It doesn't connect Dropbox Sign — that's Phase 5.

## Re-running

Safe. The script is idempotent:
- Existing tables are left alone.
- Missing fields on existing tables are added.
- Seeded taxonomies are only inserted if the table is empty.
- The Settings row is only created if none exists.

So you can safely re-run it if you want to add future schema updates.

## Troubleshooting

**"NOT_FOUND: Could not find base …"** — The token doesn't have access to that
base. Open the token at <https://airtable.com/create/tokens>, scroll to
*Access*, add the base, save.

**"INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND"** — The token is missing a scope.
Recreate it with all four scopes listed in *Prerequisites*.

**"FIELD_NAME_ALREADY_EXISTS" on a topping-up pass** — Harmless; the script
expected the field to be missing but someone else already added it. Re-run.

**Anything else** — The script prints the full Airtable error body. If it's
unclear, paste it back and we'll diagnose.

## After the script finishes

1. **Rotate the token** at <https://airtable.com/create/tokens>. Revoke the
   old one and issue a new one (the same scopes). Paste the new token into
   whatever Phase 2 plumbing we set up.
2. **Delete the placeholder "Table 1"** that the base was created with.
3. **Add Interface Designer dashboards** (Phase 3) — I'll send mock layouts.
