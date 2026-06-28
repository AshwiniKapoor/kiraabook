/**
 * KiraaBook — server-side scheduled auto-billing.
 *
 * Runs every day at 02:00 IST on Google Cloud (no owner login required).
 * It mirrors the client logic in assets/js/owner.js (autoCreateMonthlyBills):
 *   - one bill per calendar month per auto-billing tenant
 *   - backfills any missing month (up to 6 months back)
 *   - due date follows the owner-set Rent Due Day, else the move-in anniversary
 *   - writes newBillAlert so the tenant is notified on next login
 *
 * The job is idempotent: it only creates bills that don't already exist, so a
 * daily run is safe — the month's bill simply appears the first run on/after
 * the 1st, and any month an owner was offline for is caught up automatically.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ── helpers (kept byte-for-byte equivalent to the client) ──────────────────

// Normalize "2026-06" vs "2026-6" so month comparisons are safe
function normMK(mk) {
  if (!mk) return "";
  let [y, m] = String(mk).split("-");
  return y + "-" + parseInt(m, 10);
}

// Rent + Maintenance + custom charges
function buildBillItems(t) {
  let items = [];
  if (Number(t.rent) > 0) items.push({ name: "Rent", amount: Number(t.rent) });
  if (Number(t.maintenance) > 0) items.push({ name: "Maintenance", amount: Number(t.maintenance) });
  (t.otherCharges || []).forEach((c) => {
    if (c.name && Number(c.amount) > 0) items.push({ name: c.name, amount: Number(c.amount) });
  });
  return items;
}

// Due date for a specific billing month:
//   dueDay set (1–28) → that day of the bill month
//   else              → 1 day before the next month's move-in day (anniversary cycle)
function calcBillDueForMonth(t, billMonthDate) {
  let day = Number(t.dueDay);
  if (day >= 1 && day <= 28) {
    return new Date(billMonthDate.getFullYear(), billMonthDate.getMonth(), day);
  }
  let moveIn = new Date(t.date || billMonthDate);
  let nextAnniv = new Date(billMonthDate.getFullYear(), billMonthDate.getMonth() + 1, moveIn.getDate());
  return new Date(nextAnniv - 864e5);
}

// Trial gate — same rule as checkTrialStatus(): only a 'trial' plan whose
// subExpiry is before today is considered expired (paid/lifetime never expire).
function ownerExpired(owner) {
  if (!owner) return false;
  if (owner.plan !== "trial") return false;
  if (!owner.subExpiry) return false;
  let exp = new Date(owner.subExpiry); exp.setHours(0, 0, 0, 0);
  let today = new Date(); today.setHours(0, 0, 0, 0);
  return exp < today;
}

// Format a Date as YYYY-MM-DD from its calendar fields (no UTC shift)
function toYMD(d) {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// ── the scheduled job ──────────────────────────────────────────────────────
exports.autoBill = onSchedule(
  {
    schedule: "0 2 * * *",        // 02:00 every day
    timeZone: "Asia/Kolkata",
    region: "asia-south1",         // Mumbai
    retryCount: 2,
  },
  async () => {
    // Work in IST wall-clock so month/day boundaries match the owner's day.
    // (Server runs in UTC by default; this trick gives an IST-fielded Date.)
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    const [tenantsSnap, billsSnap, ownersSnap] = await Promise.all([
      db.collection("tenants").get(),
      db.collection("bills").get(),
      db.collection("owners").get(),
    ]);

    const bills = billsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Owners are referenced by oid OR doc id (kb_owner_id = found.oid || found.id)
    const ownerByKey = {};
    ownersSnap.docs.forEach((d) => {
      const o = { id: d.id, ...d.data() };
      ownerByKey[d.id] = o;
      if (o.oid) ownerByKey[o.oid] = o;
    });

    const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Don't backfill more than 6 months back (matches the client cap)
    const earliestAllowed = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    let created = 0;
    let notified = 0;
    const summary = [];

    for (const d of tenantsSnap.docs) {
      const t = { id: d.id, ...d.data() };
      if (!(t.approved && t.rent && t.billMode === "auto")) continue;
      if (ownerExpired(ownerByKey[t.ownerID])) continue;

      const moveIn = t.date ? new Date(t.date) : new Date(now);
      const moveInMonthStart = new Date(moveIn.getFullYear(), moveIn.getMonth(), 1);
      let cursor = moveInMonthStart > earliestAllowed ? moveInMonthStart : earliestAllowed;

      let guard = 0;
      let latestNew = null;

      while (cursor <= nowMonthStart && guard < 12) {
        guard++;
        const mKey = cursor.getFullYear() + "-" + (cursor.getMonth() + 1);
        const exists = bills.find(
          (b) => b.tenantId === t.id && normMK(b.monthKey) === normMK(mKey)
        );
        if (!exists) {
          const due = calcBillDueForMonth(t, cursor);
          const items = buildBillItems(t);
          const total = items.reduce((s, i) => s + Number(i.amount), 0);
          const mLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric" });

          await db.collection("bills").add({
            tenantId: t.id,
            tenantName: t.name || "",
            tenantPhone: t.phone || "",
            ownerID: t.ownerID || "",
            monthKey: mKey,
            monthLabel: mLabel,
            dueDate: toYMD(due),
            items,
            total,
            status: "pending",
            createdOn: now.toLocaleDateString("en-IN"),
            autoCreated: true,
            lastReminded: null,
            createdAt: FieldValue.serverTimestamp(),
          });

          latestNew = { month: mLabel, total, dueDate: toYMD(due) };
          created++;
          summary.push(`${t.name} — ${mLabel} (₹${total})`);
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }

      // Notify the tenant once, about the most recent new bill (no backfill spam)
      if (latestNew) {
        await db.collection("tenants").doc(t.id).update({
          newBillAlert: { ...latestNew, createdOn: new Date().toISOString() },
        });
        notified++;
      }
    }

    // Audit trail in the same logs collection the app reads
    if (created > 0) {
      await db.collection("logs").add({
        action: "Auto Bills Generated (Scheduled)",
        details: `${created} bill(s) created, ${notified} tenant(s) notified: ${summary.join(", ")}`,
        user: "System",
        timestamp: new Date().toISOString(),
        dateLabel: now.toLocaleDateString("en-IN", {
          day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        }),
      });
    }

    logger.info(`autoBill done: ${created} bills created, ${notified} tenants notified`);
  }
);
