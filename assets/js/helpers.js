import { state, CURRENCY, setCurrency } from "./state.js";

// ── DOM helpers ──────────────────────────────────────────────────────────────
export function g(id) { return (document.getElementById(id)?.value || "").trim(); }
export function sv(id, v) { const e = document.getElementById(id); if (e) e.value = v ?? ""; }

export function show(id) {
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0, 0);
  if (id === "screen-owner" && typeof window.startV12Subscriptions === "function") {
    setTimeout(() => { try { window.startV12Subscriptions(); } catch(e) { console.warn(e); } }, 200);
  }
}
window.show = show;

export function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }
window.closeModal = closeModal;

// ── Notifications ────────────────────────────────────────────────────────────
export function toast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast" + (type === "error" ? " error" : type === "info" ? " info" : "");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

// ── Formatting ────────────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return "–";
  try { return new Date(d).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }); }
  catch(e) { return d || "–"; }
}
export function fmtDateNice(d) {
  if (!d) return null;
  try {
    const dt = new Date(d);
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return { day: days[dt.getDay()], date: dt.getDate(), month: months[dt.getMonth()], year: dt.getFullYear() };
  } catch(e) { return null; }
}
export function fmtMoney(n) {
  const cur = localStorage.getItem("kb_currency") || CURRENCY || "₹";
  const v = parseFloat(n) || 0;
  if (cur === "₹") return cur + v.toLocaleString("en-IN");
  return cur + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
export function genUID() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "KB";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
export function daysBetween(a, b) {
  const d1 = new Date(a); d1.setHours(0,0,0,0);
  const d2 = new Date(b); d2.setHours(0,0,0,0);
  return Math.round((d2 - d1) / 864e5);
}
export function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
export function escAttr(s) { return String(s || "").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

// ── Rentable-unit noun per property type ─────────────────────────────────────
// So the UI says "Flats / Beds / Units / Rooms Vacant" instead of always "Rooms",
// which is wrong for apartments, PGs, commercial spaces, etc.
export function unitNoun(type) {
  switch (type) {
    case "apartment":  return { one: "Flat",  many: "Flats"  };
    case "villa":      return { one: "Villa", many: "Villas" };
    case "pg":         return { one: "Bed",   many: "Beds"   };
    case "commercial": return { one: "Unit",  many: "Units"  };
    case "bnb":        return { one: "Room",  many: "Rooms"  };
    case "house":      return { one: "Unit",  many: "Units"  };
    default:           return { one: "Unit",  many: "Units"  };
  }
}

// ── PDF: reference-only watermark + legal disclaimer ─────────────────────────
// Stamps EVERY page of a jsPDF document with a faint diagonal "REFERENCE ONLY"
// watermark and a footer disclaimer, so nothing this app generates can be
// mistaken for a legally binding / certified document. Call once, right before
// pdf.save()/pdf.output(). Fails silently so a PDF still downloads if anything
// in the stamping goes wrong.
const PDF_NOTES = {
  invoice:  "This is a system-generated reference invoice from KiraaBook, provided for record-keeping and informational purposes only. It is NOT a tax invoice, official payment receipt, or legally certified document, and must not be relied upon for any legal, judicial, or taxation purpose.",
  summary:  "This is a system-generated reference summary from KiraaBook, provided for informational purposes only. It is NOT a certified financial statement, tax document, or legally binding record.",
  agreement:"This document is a system-generated reference template produced by KiraaBook. It is NOT a legally executed, stamped, notarized, or registered agreement, and does not constitute legal advice. To be legally valid and enforceable, the parties must execute it on the appropriate stamp paper and complete any registration/attestation required by applicable local law. Please consult a qualified legal professional before relying on this document.",
  document: "This is a system-generated reference document from KiraaBook, provided for informational purposes only. It is NOT a legally binding, certified, or notarized document and must not be used for any legal, judicial, or official purpose."
};

export function stampPdfReference(pdf, opts = {}) {
  try {
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const pages = pdf.internal.getNumberOfPages();
    const watermark = opts.watermark || "REFERENCE ONLY";
    const note = opts.note || PDF_NOTES[opts.type] || PDF_NOTES.document;
    const hasGState = typeof pdf.GState === "function" && typeof pdf.setGState === "function";

    for (let p = 1; p <= pages; p++) {
      pdf.setPage(p);

      // ── Diagonal watermark ──
      if (pdf.saveGraphicsState) pdf.saveGraphicsState();
      if (hasGState) { try { pdf.setGState(pdf.GState({ opacity: 0.12 })); } catch (e) {} }
      pdf.setTextColor(hasGState ? 120 : 205, hasGState ? 120 : 205, hasGState ? 120 : 205);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(46);
      pdf.text(watermark, W / 2, H / 2, { align: "center", angle: 35 });
      pdf.setFontSize(15);
      pdf.text("Not a legal document", W / 2, H / 2 + 13, { align: "center", angle: 35 });
      if (pdf.restoreGraphicsState) pdf.restoreGraphicsState();

      // ── Footer disclaimer (sits just above any existing generated-on footer) ──
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(6.5);
      pdf.setTextColor(115, 115, 115);
      const lines = pdf.splitTextToSize(note, W - 24);
      const startY = H - 16 - (lines.length - 1) * 2.6;
      pdf.text(lines, W / 2, startY, { align: "center" });
    }
  } catch (e) { console.warn("[stampPdfReference]", e); }
}

// ── Photo upload ───────────────────────────────────────────────────────────────
window.triggerFile = (fileId, dataId, prevId, selfie) => {
  const inp = document.getElementById(fileId);
  if (selfie) inp.setAttribute("capture", "user");
  else inp.removeAttribute("capture");
  inp.click();
};
window.handlePhotoFile = (fileId, dataId, prevId, isRound) => {
  const file = document.getElementById(fileId)?.files?.[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast("Please choose an image file (JPG/PNG).", "error"); return; }
  if (file.size > 5 * 1024 * 1024)  { toast("Image too large — please pick one under 5 MB.", "error"); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSz = isRound ? 400 : 600;
      const ratio = Math.min(maxSz / img.width, maxSz / img.height, 1);
      canvas.width  = img.width  * ratio;
      canvas.height = img.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL("image/jpeg", 0.6);
      const prev = document.getElementById(prevId);
      const radius = isRound ? "50%" : "calc(var(--rs) - 2px)";
      if (prev) prev.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:${radius}"/>`;
      const dataEl = document.getElementById(dataId);
      if (dataEl) dataEl.value = compressed;
      toast("📸 Photo loaded!", "info");
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.updateMoveinDisplay = () => {
  const d = g("tr-date");
  const disp = document.getElementById("movein-display");
  if (!d) { disp.style.display = "none"; return; }
  const info = fmtDateNice(d);
  if (!info) { disp.style.display = "none"; return; }
  disp.style.display = "block";
  document.getElementById("movein-big").textContent = `${info.date} ${info.month} ${info.year}`;
  document.getElementById("movein-sub").textContent = info.day;
};
window.showIdUpload = () => {
  const t = g("tr-idtype");
  document.getElementById("id-upload-area").style.display = t ? "block" : "none";
  if (t) document.getElementById("id-type-lbl").textContent = t;
};


// ── Data export (owner) ────────────────────────────────────────────────────────
window.exportMyData = () => {
  const ownerID = localStorage.getItem("kb_owner_id");
  const data = {
    owner:   state.currentOwnerData,
    tenants: state.tenants,
    bills:   state.bills,
    rooms:   state.rooms,
    exported: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `kiraabook-export-${ownerID}-${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast("📥 Data exported!", "info");
};

// ── Global error handlers ──────────────────────────────────────────────────────
window.addEventListener("error", e => {
  console.error("Global error:", e.error || e.message);
  const t = document.getElementById("toast");
  if (t) { t.textContent = "⚠️ Error: " + (e.message || "unknown"); t.className = "toast error"; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 5000); }
});
window.addEventListener("unhandledrejection", e => { console.error("Unhandled promise:", e.reason); });

// ── Emergency reset ────────────────────────────────────────────────────────────
window.kbReset = () => {
  if (confirm("Reset KiraaBook session?\n\nThis clears your local login state but does NOT delete any data in Firebase.")) {
    localStorage.clear(); location.reload();
  }
};
