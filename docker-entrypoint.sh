#!/bin/sh
set -e

# Migrations run BEFORE the server accepts a request, so the schema is never
# behind the code that expects it. If they fail the container exits rather than
# serving against a stale database — a crash is a better outcome than a page
# that half-works and blames the data.
#
# `migrate deploy` is idempotent and takes an advisory lock, so this is safe on
# every restart and safe if a second instance is ever added.
echo "→ prisma migrate deploy"
npx prisma migrate deploy

# Global reference data: activity types, deliverable types, broad categories.
# The app cannot function without it — with an empty taxonomy, recording any
# activity fails with ACTIVITY_TYPE_NOT_FOUND and every report is permanently
# empty. The script only upserts and deletes nothing, so it is safe on every
# redeploy rather than only the first.
#
# This is emphatically NOT `prisma db seed`, which wipes fourteen tables and
# installs development credentials. That must never run here.
echo "→ reference data"
npm run db:reference-data

echo "→ next start"
exec npm run start
