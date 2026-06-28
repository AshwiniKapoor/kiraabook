# KiraaBook — Scheduled Auto-Billing (Firebase Functions)

`autoBill` runs **daily at 02:00 IST** on Google Cloud and generates monthly
bills for every auto-billing tenant **without anyone logging in**. It mirrors the
client logic in `assets/js/owner.js` and is **idempotent** (only creates bills
that don't already exist), so a daily run is safe.

## One-time setup

1. **Install the Firebase CLI** (if you don't have it):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. **Enable the Blaze (pay-as-you-go) plan** for project `kiraabook-326bc`:
   Firebase Console → ⚙️ → Usage and billing → Modify plan → Blaze.
   (Scheduled functions require Blaze. This job runs once/day on a few documents,
   so it stays well inside the free monthly allowance.)

3. **Install dependencies**:
   ```bash
   cd functions
   npm install
   ```

## Deploy

From the project root:
```bash
firebase deploy --only functions
```
On first deploy, Google enables Cloud Scheduler, Cloud Functions, Pub/Sub, and
Artifact Registry automatically — approve any prompts.

## Verify / operate

```bash
firebase functions:log            # see each run's output
```
You can also trigger it manually in Google Cloud Console → Cloud Scheduler →
`firebase-schedule-autoBill-asia-south1` → **Run now**.

Every run that creates bills also writes an entry to the `logs` collection
("Auto Bills Generated (Scheduled)"), visible in the app's admin activity log.

## Change the schedule

Edit `schedule` (cron, IST) in `index.js` and redeploy. Examples:
- `"0 2 * * *"`   → 02:00 every day (current)
- `"0 2 1 * *"`   → 02:00 on the 1st of each month only
