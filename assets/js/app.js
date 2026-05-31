// ── KiraaBook App Entry Point ────────────────────────────────────────────────
// Imports trigger module-level side effects (window.* registrations)
import { db, fbGetDoc, fbGet, fbAdd, logActivity, collection, onSnapshot } from './firebase.js';
import { state }                        from './state.js';
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

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const urlParams    = new URLSearchParams(window.location.search);
  const inviteOwner  = urlParams.get("owner");

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
            state.currentOwnerData = o;
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
            state.currentTenantId = t.id;
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

// ── Window aliases needed by inline HTML onclick handlers ─────────────────────
// (most are registered in their own modules; these are the stragglers)
window.closeModal = closeModal;

boot();
