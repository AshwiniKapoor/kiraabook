import { db, fbGetDoc, fbUpdate } from '../firebase.js';
import { state } from '../state.js';
import { g, sv, toast, fmtDate, fmtMoney, esc, closeModal } from '../helpers.js';

// v13: DIGITAL RENT AGREEMENT BUILDER
// ═════════════════════════════════════════════════════════════

window.openRentAgreementBuilder = async(tenantId)=>{
  let t = await fbGetDoc("tenants", tenantId);
  if(!t){ toast("Tenant not found","error"); return; }
  let owner = currentOwnerData || (t.ownerID ? await fbGetDoc("owners", t.ownerID) : null);
  let property = t.propertyId ? properties.find(p=>p.id===t.propertyId) : null;

  // Close the tenant detail modal so user sees the builder
  closeModal("tenant-detail-modal");

  // Pre-fill all fields
  sv("ra-tenant-id", tenantId);
  sv("ra-owner-name", owner?.name || "");
  sv("ra-owner-phone", owner?.phone || "");
  sv("ra-tenant-name", t.name || "");
  sv("ra-tenant-phone", t.phone || "");
  sv("ra-property-address", property?.address || t.address || "");
  sv("ra-room", t.room || "");
  let typeSel = document.getElementById("ra-prop-type");
  if(typeSel){
    let propTypeMap = {apartment:"Apartment", house:"House", villa:"Villa", pg:"PG Room", commercial:"Commercial Space", other:"Other"};
    typeSel.value = propTypeMap[property?.type] || "Apartment";
  }
  sv("ra-rent", t.rent || "");
  sv("ra-security", t.securityDeposit || "");
  // Advance rent in months (if balance exists, divide by rent)
  let advMonths = "";
  if(t.advanceRentBalance && t.rent){
    advMonths = Math.round(Number(t.advanceRentBalance)/Number(t.rent));
  }
  sv("ra-advance-months", advMonths);
  sv("ra-escalation", "5");
  sv("ra-latefee", "50");
  sv("ra-rentday", "5");
  sv("ra-start-date", t.date || new Date().toISOString().split("T")[0]);
  // Default end date: start + 11 months
  let startD = t.date ? new Date(t.date) : new Date();
  let endD = new Date(startD); endD.setMonth(endD.getMonth()+11);
  sv("ra-end-date", endD.toISOString().split("T")[0]);
  sv("ra-notice-days", "30");
  sv("ra-sig-landlord", owner?.name || "");
  sv("ra-sig-tenant", t.name || "");
  sv("ra-sign-date", new Date().toISOString().split("T")[0]);
  sv("ra-place", "");

  // Reset to defaults for the textareas (they may have been edited last time)
  document.getElementById("ra-maintenance").value = "Tenant is responsible for day-to-day upkeep. Major structural repairs are the landlord's responsibility.";
  document.getElementById("ra-utilities").value = "Electricity and water bills are payable by the tenant based on actual usage. Gas connection charges are tenant's responsibility.";
  document.getElementById("ra-rules").value = "No subletting without written permission. No structural alterations without landlord consent. No illegal activities on the premises.";
  sv("ra-custom", "");

  // Template change handler
  let templateSel = document.getElementById("ra-template");
  templateSel.onchange = ()=> applyAgreementTemplate(templateSel.value);

  document.getElementById("rent-agreement-modal").classList.add("open");
};

function applyAgreementTemplate(template){
  // Adjust default clauses based on template type
  let maintEl = document.getElementById("ra-maintenance");
  let utilEl = document.getElementById("ra-utilities");
  let rulesEl = document.getElementById("ra-rules");
  if(template==="commercial"){
    maintEl.value = "Tenant shall maintain the premises in good condition. Any structural repairs, exterior maintenance, and statutory compliance are the landlord's responsibility.";
    utilEl.value = "All utility bills (electricity, water, internet, gas) are the tenant's responsibility based on actual usage. Property taxes are the landlord's responsibility.";
    rulesEl.value = "Premises to be used solely for the agreed commercial purpose. No residential use. No hazardous materials. All operations must comply with local laws and licenses.";
  } else if(template==="pg"){
    maintEl.value = "Owner provides basic furniture and amenities as listed in the inventory. Tenant is responsible for keeping the room and common areas clean.";
    utilEl.value = "Electricity, water, and Wi-Fi are included in the monthly rent. Food, if provided, is per the separate meal plan.";
    rulesEl.value = "Guest visits only in common areas till 9 PM. No smoking or alcohol on premises. Gates close at 11 PM. No outside food in common dining area.";
  } else if(template==="custom"){
    maintEl.value = "";
    utilEl.value = "";
    rulesEl.value = "";
  } else {
    // residential — reset to defaults
    maintEl.value = "Tenant is responsible for day-to-day upkeep. Major structural repairs are the landlord's responsibility.";
    utilEl.value = "Electricity and water bills are payable by the tenant based on actual usage. Gas connection charges are tenant's responsibility.";
    rulesEl.value = "No subletting without written permission. No structural alterations without landlord consent. No illegal activities on the premises.";
  }
}

window.generateRentAgreementPdf = async()=>{
  if(!window.jspdf){ toast("PDF library not loaded — wait a moment and retry","error"); return; }
  let tenantId = g("ra-tenant-id");
  let t = await fbGetDoc("tenants", tenantId);
  if(!t){ toast("Tenant not found","error"); return; }

  // Gather all fields
  let ownerName = g("ra-owner-name"), ownerPhone = g("ra-owner-phone");
  let tenantName = g("ra-tenant-name"), tenantPhone = g("ra-tenant-phone");
  let propAddr = g("ra-property-address"), room = g("ra-room");
  let propType = document.getElementById("ra-prop-type").value;
  let rent = Number(g("ra-rent"))||0, security = Number(g("ra-security"))||0;
  let advanceMonths = Number(g("ra-advance-months"))||0;
  let escalation = g("ra-escalation"), lateFee = g("ra-latefee");
  let rentDay = g("ra-rentday");
  let startDate = g("ra-start-date"), endDate = g("ra-end-date");
  let noticeDays = g("ra-notice-days");
  let maintenance = g("ra-maintenance"), utilities = g("ra-utilities");
  let rules = g("ra-rules"), customClauses = g("ra-custom");
  let sigLandlord = g("ra-sig-landlord"), sigTenant = g("ra-sig-tenant");
  let place = g("ra-place"), signDate = g("ra-sign-date");
  let template = document.getElementById("ra-template").value;
  let templateName = ({residential:"Residential Lease Agreement", commercial:"Commercial Lease Agreement", pg:"Paying Guest (PG) Stay Agreement", custom:"Rent Agreement"})[template] || "Rent Agreement";

  // ASCII currency for PDF (jsPDF default font can't render ₹)
  let curName = ({"₹":"Rs.","$":"USD","€":"EUR","£":"GBP","¥":"JPY","A$":"AUD","C$":"CAD","₽":"RUB","﷼":"SAR","د.إ":"AED"})[CURRENCY] || CURRENCY;
  let m = (v)=>`${curName} ${Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
  let fmtSignDate = signDate ? new Date(signDate).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}) : "";
  let fmtStartDate = startDate ? new Date(startDate).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}) : "";
  let fmtEndDate = endDate ? new Date(endDate).toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}) : "month-to-month";

  let { jsPDF } = window.jspdf;
  let pdf = new jsPDF();
  let pageW = pdf.internal.pageSize.getWidth();
  let pageH = pdf.internal.pageSize.getHeight();
  let margin = 18, contentW = pageW - margin*2;
  let y = margin;

  let addText = (text, opts={})=>{
    let size = opts.size || 10;
    let bold = opts.bold || false;
    let color = opts.color || [30,30,30];
    let lineH = opts.lineH || (size*0.42);
    let align = opts.align || "left";
    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setTextColor(...color);
    let lines = pdf.splitTextToSize(text, contentW);
    lines.forEach(line=>{
      if(y > pageH - 25){ pdf.addPage(); y = margin; }
      let x = margin;
      if(align==="center") x = pageW/2;
      pdf.text(line, x, y, {align});
      y += lineH * 1.2;
    });
  };
  let space = (px=4)=>{ y += px; };
  let hr = ()=>{
    if(y > pageH - 25){ pdf.addPage(); y = margin; }
    pdf.setDrawColor(180,180,180);
    pdf.setLineWidth(0.2);
    pdf.line(margin, y, pageW-margin, y);
    y += 4;
  };

  // Header bar
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, pageW, 26, "F");
  pdf.setTextColor(245, 166, 35);
  pdf.setFontSize(18); pdf.setFont("helvetica", "bold");
  pdf.text("KiraaBook", pageW/2, 12, {align:"center"});
  pdf.setFontSize(10); pdf.setTextColor(200,200,200);
  pdf.text("Smart Rental Management", pageW/2, 19, {align:"center"});
  y = 36;

  // Title
  addText(templateName.toUpperCase(), {size:15, bold:true, align:"center", color:[15,23,42]});
  space(2);
  addText(`Executed at ${place||"________"} on ${fmtSignDate||"________"}`, {size:9, align:"center", color:[100,100,100]});
  space(4); hr(); space(2);

  // Parties
  addText("THIS RENT AGREEMENT IS EXECUTED BETWEEN:", {bold:true, size:10});
  space(2);
  addText(`(1) ${ownerName||"________"}, residing at the address known to both parties, hereinafter referred to as the "LANDLORD" (Phone: ${ownerPhone||"—"}).`, {size:10});
  space(2);
  addText("AND", {bold:true, size:10, align:"center"});
  space(2);
  addText(`(2) ${tenantName||"________"}, hereinafter referred to as the "TENANT" (Phone: ${tenantPhone||"—"}).`, {size:10});
  space(4); hr(); space(2);

  // 1. Property
  addText("1. PROPERTY", {bold:true, size:11, color:[15,23,42]});
  addText(`The Landlord hereby lets out the following premises to the Tenant: ${propType}, Room/Unit No. ${room||"—"}, located at: ${propAddr||"—"}.`, {size:10});
  space(3);

  // 2. Term
  addText("2. LEASE PERIOD", {bold:true, size:11, color:[15,23,42]});
  addText(`The lease commences on ${fmtStartDate} and shall continue until ${fmtEndDate}. Either party may terminate this agreement by giving ${noticeDays||"30"} days' prior written notice to the other party.`, {size:10});
  space(3);

  // 3. Rent
  addText("3. RENT", {bold:true, size:11, color:[15,23,42]});
  addText(`The Tenant agrees to pay a monthly rent of ${m(rent)} payable on or before the ${rentDay||"5"}th day of each calendar month. A late fee of ${m(lateFee)} per day shall apply for any delay beyond the due date.`, {size:10});
  if(escalation && Number(escalation)>0){
    addText(`Annual rent escalation: ${escalation}% per year on the anniversary of the lease commencement.`, {size:10});
  }
  space(3);

  // 4. Security & Advance
  addText("4. SECURITY DEPOSIT & ADVANCE", {bold:true, size:11, color:[15,23,42]});
  addText(`The Tenant has deposited ${m(security)} as an interest-free, refundable security deposit. This amount shall be refunded by the Landlord at the time of vacating the premises, after deducting any pending dues, repair costs for damage beyond normal wear and tear, and any other lawful charges.`, {size:10});
  if(advanceMonths>0){
    addText(`Additionally, the Tenant has paid an advance rent equivalent to ${advanceMonths} month(s) which shall be adjusted against future monthly rent as mutually agreed.`, {size:10});
  }
  space(3);

  // 5. Maintenance
  if(maintenance){
    addText("5. MAINTENANCE", {bold:true, size:11, color:[15,23,42]});
    addText(maintenance, {size:10});
    space(3);
  }

  // 6. Utilities
  if(utilities){
    addText("6. UTILITIES", {bold:true, size:11, color:[15,23,42]});
    addText(utilities, {size:10});
    space(3);
  }

  // 7. House Rules
  if(rules){
    addText("7. RULES & RESTRICTIONS", {bold:true, size:11, color:[15,23,42]});
    addText(rules, {size:10});
    space(3);
  }

  // 8. Custom
  if(customClauses){
    addText("8. ADDITIONAL TERMS", {bold:true, size:11, color:[15,23,42]});
    addText(customClauses, {size:10});
    space(3);
  }

  // Termination & Jurisdiction (standard)
  addText("GENERAL PROVISIONS", {bold:true, size:11, color:[15,23,42]});
  addText("This agreement is governed by the laws of the jurisdiction where the property is located. Any dispute arising out of or in connection with this agreement shall be settled amicably and, failing that, through appropriate legal channels in that jurisdiction.", {size:10});
  space(6); hr(); space(4);

  // Signatures
  if(y > pageH - 55){ pdf.addPage(); y = margin; }
  addText("IN WITNESS WHEREOF, the parties hereto have signed this agreement on the date first above written.", {size:10, bold:true});
  space(10);
  // Two columns for signatures
  let colW = (contentW - 10) / 2;
  let yStart = y;
  pdf.setFontSize(10); pdf.setFont("helvetica","normal");
  pdf.setDrawColor(60,60,60);
  pdf.setLineWidth(0.3);
  // Landlord side
  pdf.line(margin, y+10, margin+colW, y+10);
  pdf.text(`Signature: ${sigLandlord||""}`, margin, y+16);
  pdf.text(`(LANDLORD)`, margin, y+22);
  pdf.text(`Name: ${ownerName||"—"}`, margin, y+28);
  pdf.text(`Date: ${fmtSignDate||"—"}`, margin, y+34);
  // Tenant side
  let x2 = margin + colW + 10;
  pdf.line(x2, y+10, x2+colW, y+10);
  pdf.text(`Signature: ${sigTenant||""}`, x2, y+16);
  pdf.text(`(TENANT)`, x2, y+22);
  pdf.text(`Name: ${tenantName||"—"}`, x2, y+28);
  pdf.text(`Date: ${fmtSignDate||"—"}`, x2, y+34);
  y = yStart + 42;

  // Footer
  pdf.setFontSize(8); pdf.setTextColor(120,120,120);
  let footerY = pageH - 8;
  pdf.text(`Generated by KiraaBook on ${new Date().toLocaleString()} · Agreement ID: ${tenantId.slice(0,12)}`, pageW/2, footerY, {align:"center"});

  // Save the PDF
  let fname = `rent-agreement-${(tenantName||"tenant").replace(/\s+/g,"-")}-${signDate||"draft"}.pdf`;
  pdf.save(fname);

  // Also store a record on the tenant document so the tenant can re-download
  try{
    let pdfBase64 = pdf.output("datauristring"); // includes data:application/pdf;base64,...
    // Save metadata only (full base64 may be too large for Firestore single field — store summary)
    let agreementMeta = {
      generatedOn: new Date().toISOString(),
      template: template,
      startDate, endDate, rent, security,
      sigLandlord, sigTenant, signDate, place,
      filename: fname
    };
    // Save the full PDF as a separate field, but check size first (Firestore field limit ~1MB)
    if(pdfBase64.length < 900000){
      agreementMeta.pdfData = pdfBase64;
    }
    await fbUpdate("tenants", tenantId, {
      rentAgreement: agreementMeta,
      hasRentAgreement: true
    });
    toast("✅ Rent agreement generated and saved","info");
    try{ await logActivity("Rent Agreement Generated", `Tenant: ${tenantName}, Template: ${template}`, "Owner"); }catch(e){}
  }catch(e){
    console.warn("Could not save agreement to tenant record:", e);
    toast("✅ PDF downloaded (note: too large to save to tenant record)","info");
  }
  closeModal("rent-agreement-modal");
};

// Tenant-side: download their saved rent agreement
window.downloadMyRentAgreement = async()=>{
  let t = tenants.find(x=>x.id===currentTenantId);
  if(!t){ try{ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }catch(e){} }
  if(!t || !t.rentAgreement || !t.rentAgreement.pdfData){
    toast("No rent agreement available yet. Ask your owner to generate one.","info");
    return;
  }
  // Trigger download from base64 datauristring
  let link = document.createElement("a");
  link.href = t.rentAgreement.pdfData;
  link.download = t.rentAgreement.filename || "rent-agreement.pdf";
  link.click();
  toast("📥 Downloading rent agreement...","info");
};

// ═════════════════════════════════════════════════════════════
