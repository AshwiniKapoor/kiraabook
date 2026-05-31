// Shared mutable state — all modules import this object and mutate its properties directly
export const state = {
  // Data arrays (populated by Firestore listeners)
  tenants:       [],
  bills:         [],
  rooms:         [],
  paymentClaims: [],
  properties:    [],
  tickets:       [],

  // Session
  currentTenantId:  null,
  currentOwnerData: null,

  // UI filters
  currentFilter: "all",
  billFilter:    "all",
  pkPlanSel:     "monthly",

  // Firestore unsubscribe handles
  unsubT:     null,
  unsubB:     null,
  unsubR:     null,
  unsubC:     null,
  unsubNotif: null,
  unsubRH:    null,

  // Admin database viewer
  dbCurrColl: "",
  dbRecs:     [],

  // Signup flow
  pendingKeyId:  "",
  pendingFlow:   "",   // "signup" | "key" | "lifetime"

  // Forgot password
  forgotTenantDocId: "",
  forgotOwnerDocId:  "",

  // Key generation
  currentGenKey2: "",

  // OTP (Firebase phone auth)
  confirmationResult: null
};

// Currency — also updated from localStorage by helpers.js
export let CURRENCY = localStorage.getItem("kb_currency") || "₹";
export function setCurrency(v) {
  CURRENCY = v;
  localStorage.setItem("kb_currency", v);
}
