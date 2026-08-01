import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getAuth, signInAnonymously }
  from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

export { collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
         onSnapshot, serverTimestamp, query, orderBy, limit };

export const firebaseConfig = {
  apiKey:            "AIzaSyBIGAjGU3OF8D_vU9mbC8jkxvTFKk2EYMA",
  authDomain:        "kiraabook-326bc.firebaseapp.com",
  projectId:         "kiraabook-326bc",
  storageBucket:     "kiraabook-326bc.firebasestorage.app",
  messagingSenderId: "304152304903",
  appId:             "1:304152304903:web:217175f03668e3fadf39a2"
};

export const ADMIN_PASS   = "Geetansh2013";
export const LIFETIME_KEY = "Geetansh2013";

export const RZP_HANDLE = "kiraabook";
export function payLink(amount){ return `https://razorpay.me/@${RZP_HANDLE}?amount=${amount}`; }

// Tenant-capacity pricing ladder (India). Owner picks the tier matching their
// portfolio size; annual ≈ 8× monthly (~33% off). cap = max active tenants.
export const PLAN_CATALOG = [
  { id:"starter",   name:"Starter",   cap:10,       monthly:99,  annual:799,  tagline:"For small landlords" },
  { id:"pro",       name:"Pro",       cap:25,       monthly:199, annual:1599, tagline:"Growing portfolio", popular:true },
  { id:"plus",      name:"Plus",      cap:50,       monthly:349, annual:2799, tagline:"Multiple properties" },
  { id:"business",  name:"Business",  cap:100,      monthly:599, annual:4999, tagline:"PG / hostels" },
  { id:"unlimited", name:"Unlimited", cap:Infinity, monthly:999, annual:7999, tagline:"No limits" }
];
export const LIFETIME_PLAN = { id:"lifetime", name:"Lifetime", cap:Infinity, oneTime:9999, tagline:"Pay once, use forever" };

// Kept for backward-compat with any legacy references
export const PAY_LINKS = {
  monthly: payLink(199),
  annual:  payLink(1599)
};

export const DB_COLLS = [
  { id:"tenants",           label:"Tenants",           icon:"🏠" },
  { id:"bills",             label:"Bills",             icon:"📄" },
  { id:"owners",            label:"Owners",            icon:"👑" },
  { id:"properties",        label:"Properties",        icon:"🏘️" },
  { id:"rooms",             label:"Rooms",             icon:"🏢" },
  { id:"maintenanceTickets",label:"Maintenance Tickets",icon:"🔧" },
  { id:"supportTickets",    label:"Support Tickets",   icon:"📞" },
  { id:"logs",              label:"Activity Logs",     icon:"📊" },
  { id:"vacantNotices",     label:"Vacant Notices",    icon:"📦" },
  { id:"paymentClaims",     label:"Payment Claims",    icon:"💰" },
  { id:"notifications",     label:"Notifications",     icon:"🔔" }
];

const fapp = initializeApp(firebaseConfig);
export const db = getFirestore(fapp);
export const storage = getStorage(fapp);
export const auth = getAuth(fapp);

// ── SECURE DOCUMENT UPLOADS ───────────────────────────────────
// Tenant KYC/ID images used to be stored as base64 strings inside the Firestore
// tenant record — which meant every image was broadcast in every snapshot and
// could not be access-controlled separately. We now upload them to Firebase
// Storage and keep only a URL in Firestore.
//
// Writes are gated by Firebase Anonymous Auth so the Storage rules can require a
// signed request (an interim step before full owner/tenant Auth). If Anonymous
// sign-in or Storage isn't enabled yet in the console, everything degrades
// gracefully: uploadImage() falls back to returning the original base64 so the
// app keeps working exactly as before.
export const authReady = signInAnonymously(auth)
  .then(c => c.user)
  .catch(e => { console.warn("[kb] anonymous auth unavailable — docs will fall back to inline storage:", e?.code || e); return null; });

// Upload a compressed data-URL image to Storage and return its download URL.
// - Empty input → "" (nothing to store)
// - Already an http(s) URL → returned unchanged (avoids re-uploading on edits)
// - On any failure → returns the original data-URL so no document is ever lost
export async function uploadImage(path, dataUrl) {
  if (!dataUrl) return "";
  if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
  try {
    await authReady;
    const r = storageRef(storage, path);
    await uploadString(r, dataUrl, "data_url");
    return await getDownloadURL(r);
  } catch (e) {
    console.warn("[kb] Storage upload failed, keeping inline copy:", e?.code || e);
    return dataUrl; // graceful fallback — keep working like before
  }
}

// Best-effort delete of a stored doc (used on tenant offboarding cleanup)
export async function deleteStoredImage(path) {
  try { await authReady; await deleteObject(storageRef(storage, path)); } catch (e) {}
}

export async function fbAdd(c, data) {
  return await addDoc(collection(db, c), { ...data, createdAt: serverTimestamp() });
}
export async function fbSet(c, id, data) {
  return await setDoc(doc(db, c, id), data, { merge: true });
}
export async function fbGet(c) {
  const snap = await getDocs(collection(db, c));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function fbDel(c, id)       { return await deleteDoc(doc(db, c, id)); }
export async function fbUpdate(c, id, data) { return await updateDoc(doc(db, c, id), data); }
export async function fbGetDoc(c, id) {
  const snap = await getDoc(doc(db, c, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function logActivity(action, details = "", user = "System") {
  try {
    await fbAdd("logs", {
      action, details, user,
      timestamp: new Date().toISOString(),
      dateLabel: new Date().toLocaleDateString("en-IN", {
        day:"numeric", month:"short", year:"numeric",
        hour:"2-digit", minute:"2-digit"
      })
    });
  } catch(e) {}
}
