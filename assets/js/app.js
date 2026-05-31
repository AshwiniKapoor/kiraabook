// ── KiraaBook App Entry Point ────────────────────────────────────────────────
// Imports trigger module-level side effects (window.* registrations)
import { db, fbGetDoc, fbGet, logActivity } from './firebase.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, closeModal } from './helpers.js';
import './auth.js';
import './owner.js';
import './tenant.js';
import './admin.js';
import './features/account.js';
import './features/properties.js';
import './features/maintenance.js';
import './features/rent-agreement.js';
import './ui.js';

// ── Global state — initialise ALL variables from the original monolith globals
// block on window so every strict-mode ES module can reference them as bare names.
// (In strict-mode modules, bare writes only work if the property already exists on
// the global object; reads follow normal scope → global lookup.)
window.tenants        = [];
window.bills          = [];
window.rooms          = [];
window.paymentClaims  = [];
window.properties     = [];
window.tickets        = [];
window._rawBills      = [];

window.currentTenantId  = null;
window.currentOwnerData = null;

window.currentFilter = "all";
window.billFilter    = "all";
window.pkPlanSel     = "monthly";

window.unsubT     = null;
window.unsubB     = null;
window.unsubR     = null;
window.unsubC     = null;
window.unsubNotif = null;
window.unsubRH    = null;

window.dbCurrColl     = "";
window.dbRecs         = [];
window.currentGenKey2 = "";

window.pendingKeyId      = "";
window.pendingFlow       = "";
window.forgotTenantDocId = "";
window.forgotOwnerDocId  = "";

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const urlParams   = new URLSearchParams(window.location.search);
  const inviteOwner = urlParams.get("owner");

  setTimeout(async () => {
    document.getElementById("loading-screen").style.opacity = "0";
    setTimeout(async () => {
      document.getElementById("loading-screen").style.display = "none";

      if (inviteOwner) {
        localStorage.setItem("kb_invite_owner", inviteOwner);
        window.goTenantLogin();
        return;
      }

      const savedAdmin    = localStorage.getItem("kb_admin_session");
      const savedOwnerID  = localStorage.getItem("kb_owner_id");
      const savedTenantID = localStorage.getItem("kb_tenant_id");

      try {
        if (savedAdmin === "1") {
          show("screen-admin");
          window.initAdmin();
          return;
        }
        if (savedOwnerID) {
          const o = await fbGetDoc("owners", savedOwnerID);
          if (o && o.active !== false) {
            window.currentOwnerData = o;
            show("screen-owner");
            window.initOwner();
            return;
          } else {
            localStorage.removeItem("kb_owner_id");
            localStorage.removeItem("kb_owner_name");
            localStorage.removeItem("kb_owner_user");
          }
        }
        if (savedTenantID) {
          const t = await fbGetDoc("tenants", savedTenantID);
          if (t && t.active !== false && t.approved) {
            window.currentTenantId = t.id;
            show("screen-tenant");
            await window.renderTenantView(t);
            return;
          } else {
            localStorage.removeItem("kb_tenant_id");
          }
        }
      } catch(e) { console.warn("Auto-login failed:", e); }

      window.goLanding();
    }, 400);
  }, 1100);

  // Animate loading text
  const texts = ["● Initializing...", "● Connecting Firebase...", "● Loading interface...", "● Ready ✓"];
  let i = 0;
  const lt = document.getElementById("load-txt");
  const iv = setInterval(() => {
    if (i >= texts.length) { clearInterval(iv); return; }
    if (lt) lt.textContent = texts[i++];
  }, 280);
}

window.closeModal = closeModal;

boot();
