import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity } from './firebase.js';
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, escAttr, daysBetween, closeModal, genUID } from './helpers.js';

function renderAccountTab(){
  let el=document.getElementById("account-details");
  if(!el||!currentOwnerData) return;
  let o=currentOwnerData;
  let st=checkTrialStatus(o);
  // Refresh profile pic in circle
  let circle=document.getElementById("owner-pic-circle");
  if(circle){
    if(o.profilePic) circle.innerHTML=`<img src="${o.profilePic}"/>`;
    else circle.textContent=(o.name||"").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)||"👤";
  }
  let planLbl=o.plan==="trial"?`Free Trial (${st.daysLeft<=0?"Expired":st.daysLeft+" days left"})`:
              o.plan==="lifetime"?"♾️ Lifetime":
              o.plan==="annual"?"Annual":"Monthly";
  let statusColor = st.expired?"var(--red)":st.isTrial&&st.daysLeft<=7?"var(--orange)":"var(--green)";
  el.innerHTML=`
    <div style="background:var(--s3);border-radius:var(--rs);padding:14px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div style="font-size:16px;font-weight:800">${esc(o.name)}</div>
        <span style="background:${statusColor};color:#fff;padding:4px 10px;border-radius:99px;font-size:10px;font-weight:700">${planLbl}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Owner ID</div><div style="font-weight:700;font-family:'JetBrains Mono',monospace">${esc(o.oid||"–")}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Username</div><div style="font-weight:700">${esc(o.username)}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Phone</div><div style="font-weight:700">${esc(o.phone||"–")}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Email</div><div style="font-weight:700;word-break:break-all">${esc(o.email||"–")}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Plan</div><div style="font-weight:700">${esc(o.plan)}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Expires</div><div style="font-weight:700">${fmtDate(o.subExpiry)}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Tenants</div><div style="font-weight:700">${tenants.length}${o.plan==="trial"?" / 3":""}</div></div>
        <div><div style="color:var(--text3);font-size:10px;font-weight:600;margin-bottom:2px">Created</div><div style="font-weight:700">${esc(o.createdOn||"–")}</div></div>
      </div>
    </div>
    ${o.plan==="trial"?`
      <div style="background:var(--gold-g);border:1px solid rgba(245,166,35,.3);border-radius:var(--rs);padding:14px;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px;color:var(--gold);margin-bottom:6px">💎 Upgrade to a Paid Plan</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px;font-weight:500">Unlock unlimited tenants, priority support, and never lose access.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-success" href="${PAY_LINKS.monthly}" target="_blank" style="flex:1">💳 Monthly ₹40</a>
          <a class="btn btn-gold" href="${PAY_LINKS.annual}" target="_blank" style="flex:1">💰 Annual ₹499</a>
          <button class="btn btn-edit" onclick="upgradeAccount()" style="flex:1">📋 View Plans</button>
        </div>
      </div>`:""}
  `;
}
window.upgradeAccount=()=>{ show("screen-sub"); };

// ── TENANT VIEW ───────────────────────────────────────────────
async function renderTenantView(t){
  let ini=t.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  let av=document.getElementById("tv-avatar");
  if(t.profPhoto) av.innerHTML=`<img src="${t.profPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>`;
  else av.textContent=ini;
  document.getElementById("tv-name").textContent=t.name;
  document.getElementById("tv-room").textContent="Room "+(t.room||"–");
  document.getElementById("tv-uid").textContent=t.tid||t.id;
  let statusEl=document.getElementById("tv-status");
  let st=t.paid?"✓ Paid This Month":isOverdue(t)?"🔴 Rent Overdue":"⚠️ Rent Pending";
  statusEl.textContent=st;
  statusEl.style.background=t.paid?"rgba(34,197,94,.15)":isOverdue(t)?"rgba(244,63,94,.15)":"rgba(245,166,35,.15)";
  statusEl.style.color=t.paid?"var(--green)":isOverdue(t)?"var(--red)":"var(--gold)";
  document.getElementById("tv-rent").textContent=fmtMoney(t.rent);
  document.getElementById("tv-mo").textContent=new Date().toLocaleString("default",{month:"long",year:"numeric"});

  // v11: Profile-completion banner for owner-added tenants
  let needsComp = t.needsProfileCompletion || !t.profPhoto || !t.idPhoto || !t.pvPhoto || !t.address;
  let compBanner=document.getElementById("tv-complete-banner");
  if(!compBanner){
    let alertBar=document.getElementById("tv-alert");
    if(alertBar && alertBar.parentNode){
      compBanner=document.createElement("div");
      compBanner.id="tv-complete-banner";
      compBanner.style.cssText="background:linear-gradient(135deg,rgba(59,130,246,.12),rgba(79,156,249,.08));border:1px solid rgba(59,130,246,.3);border-radius:var(--rs);padding:14px;margin-bottom:12px;display:none";
      alertBar.parentNode.insertBefore(compBanner, alertBar.nextSibling);
    }
  }
  if(compBanner){
    if(needsComp){
      compBanner.style.display="block";
      compBanner.innerHTML=`<div style="font-weight:700;font-size:13px;color:var(--blue);margin-bottom:6px">📋 Complete Your Profile</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:10px;font-weight:500;line-height:1.5">Your owner added your account. Please complete your profile with your photo, ID, and other details.</div>
        <button class="btn btn-primary" style="font-size:12px" onclick="goTenantEditProfile()">✏️ Complete Profile Now</button>`;
    } else {
      compBanner.style.display="none";
    }
  }

  // Tenant bills
  let allBills=await fbGet("bills");
  let myBills=allBills.filter(b=>b.tenantId===t.id).sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
  let bl=document.getElementById("tv-bills-list");
  if(!myBills.length){ bl.innerHTML=`<div style="font-size:12px;color:var(--text3);font-weight:500;text-align:center;padding:8px 0">No bills yet</div>`; }
  else {
    bl.innerHTML=myBills.slice(0,6).map(b=>{
      let s=getBillStatus(b);
      let badge=b.status==="paid"?`<span style="color:var(--green);font-weight:700">✅ Paid</span>`
        :s==="overdue"?`<span style="color:var(--red);font-weight:700">🔴 Overdue</span>`
        :s==="due"?`<span style="color:var(--orange);font-weight:700">⏰ Due Soon</span>`
        :`<span style="color:var(--text3);font-weight:600">Pending</span>`;
      let items=(b.items||[]).map(i=>`<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);padding:2px 0"><span>${esc(i.name||i.label||"")}</span><span>${fmtMoney(i.amount)}</span></div>`).join("");
      return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="font-weight:700;font-size:12px">${esc(b.monthLabel||"")}</div><div style="font-weight:800;font-size:14px;color:var(--gold)">${fmtMoney(b.total)}</div></div>
        ${items?`<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">${items}</div>`:""}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text3);margin-top:8px;gap:6px">
          <span>Due: ${fmtDate(b.dueDate)}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${badge}
            <button class="btn pdf-btn" style="padding:3px 8px;font-size:10px" onclick="downloadBillPdf('${b.id}')">⬇️ PDF</button>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  // Alert bar — v13.x: aggregate ALL unpaid bills (not just the latest one)
  let alert=document.getElementById("tv-alert");
  let unpaidBills=myBills.filter(b=>b.status!=="paid");
  if(unpaidBills.length){
    // Categorize each
    let overdue=[], due=[], upcoming=[];
    unpaidBills.forEach(b=>{
      let s=getBillStatus(b);
      if(s==="overdue") overdue.push(b);
      else if(s==="due") due.push(b);
      else upcoming.push(b);
    });
    let totalPending=unpaidBills.reduce((sum,b)=>sum+Number(b.total||0),0);
    let count=unpaidBills.length;
    // Stash for the modal
    window._tenantUnpaidBills = unpaidBills;
    // Choose alert tone based on worst category present
    alert.style.display="flex";
    alert.style.cursor="pointer";
    alert.onclick=()=>openPendingDetailsModal(t.name);
    alert.title="Click to see all pending bills";
    let txt=document.getElementById("tv-alert-txt");
    let ico=document.getElementById("tv-alert-icon");
    if(overdue.length){
      alert.style.background="var(--red-g)"; alert.style.borderColor="rgba(244,63,94,.3)";
      ico.textContent="🚨";
      txt.style.color="var(--red)";
      if(count===1){
        txt.innerHTML=`Your ${esc(overdue[0].monthLabel)} rent of <strong>${fmtMoney(overdue[0].total)}</strong> is overdue! <span style="opacity:.7;font-weight:600;font-size:10px;margin-left:6px">tap for details ›</span>`;
      } else {
        txt.innerHTML=`<strong>${count} pending bills</strong> — total <strong>${fmtMoney(totalPending)}</strong>${overdue.length?` · ${overdue.length} overdue 🚨`:""} <span style="opacity:.7;font-weight:600;font-size:10px;margin-left:6px">tap for details ›</span>`;
      }
    } else if(due.length){
      alert.style.background="var(--orange-g)"; alert.style.borderColor="rgba(251,146,60,.3)";
      ico.textContent="⏰";
      txt.style.color="var(--orange)";
      if(count===1){
        txt.innerHTML=`Rent due ${fmtDate(due[0].dueDate)}. Amount: <strong>${fmtMoney(due[0].total)}</strong> <span style="opacity:.7;font-weight:600;font-size:10px;margin-left:6px">tap for details ›</span>`;
      } else {
        txt.innerHTML=`<strong>${count} bills awaiting payment</strong> — total <strong>${fmtMoney(totalPending)}</strong> <span style="opacity:.7;font-weight:600;font-size:10px;margin-left:6px">tap for details ›</span>`;
      }
    } else {
      // Only upcoming bills
      alert.style.display="none";
    }
  } else {
    alert.style.display="none";
    alert.onclick=null;
  }

  // Pending claim check
  let allClaims=await fbGet("paymentClaims");
  let pendingClaim=allClaims.find(c=>c.tenantId===t.id&&c.status==="pending");
  let payContent=document.getElementById("tv-pay-content");
  if(pendingClaim){
    payContent.innerHTML=`<div style="background:var(--orange-g);border:1px solid rgba(251,146,60,.3);border-radius:var(--rs);padding:12px;text-align:center"><div style="font-size:18px;margin-bottom:4px">⏳</div><div style="font-weight:700;font-size:12px;color:var(--orange)">Awaiting Owner Approval</div><div style="font-size:11px;color:var(--text3);margin-top:4px;font-weight:500">You submitted ${fmtMoney(pendingClaim.amount)} via ${esc(pendingClaim.method)}. Owner will confirm shortly.</div></div>`;
  } else {
    payContent.innerHTML=`<button class="tv-pay-btn" onclick="openPaymentModal()">💳 Pay via UPI / Online</button><button class="tv-claim-btn" onclick="openClaimModal()">✅ I Have Paid — Notify Owner</button>`;
  }

  // Info rows (v11: includes Owner info)
  let ownerInfo=null;
  if(t.ownerID){
    try{ ownerInfo=await fbGetDoc("owners",t.ownerID); }catch(e){}
  }
  let info=[
    ["Tenant ID",t.tid||t.id],["Phone",t.phone||"–"],["Alt Phone",t.alt||"–"],
    ["Email",t.email||"–"],
    ["Address",t.address||"–"],["ID Proof",t.idType||"–"],["Move-in",t.date?fmtDate(t.date):"–"]
  ];
  if(ownerInfo){
    info.push(["🏠 Owner Name", ownerInfo.name||"–"]);
    info.push(["Owner ID", ownerInfo.oid||ownerInfo.id]);
    if(ownerInfo.phone) info.push(["Owner Phone", ownerInfo.phone]);
    if(ownerInfo.email) info.push(["Owner Email", ownerInfo.email]);
  }
  document.getElementById("tv-info-rows").innerHTML=info.map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px;gap:8px"><span style="color:var(--text3);font-weight:500">${l}</span><span style="font-weight:600;text-align:right;word-break:break-all">${esc(v)}</span></div>`).join("");

  // Docs
  let docs="";
  if(t.idPhoto) docs+=`<div class="doc-item"><img src="${t.idPhoto}" onclick="viewImg('${t.idPhoto}')"/><div class="doc-label">${esc(t.idType||"ID")}</div></div>`;
  if(t.pvPhoto) docs+=`<div class="doc-item"><img src="${t.pvPhoto}" onclick="viewImg('${t.pvPhoto}')"/><div class="doc-label">Police</div></div>`;
  // v13: Rent Agreement download tile
  if(t.hasRentAgreement || t.rentAgreement){
    docs+=`<div class="doc-item" onclick="downloadMyRentAgreement()" style="cursor:pointer;background:linear-gradient(135deg,rgba(245,166,35,.18),rgba(245,166,35,.05));border:1px solid rgba(245,166,35,.4)">
      <div style="font-size:36px;text-align:center;padding-top:12px">📄</div>
      <div class="doc-label" style="color:var(--gold);font-weight:700">Rent Agreement</div>
    </div>`;
  }
  document.getElementById("tv-docs").innerHTML=docs||`<div style="font-size:11px;color:var(--text3);font-weight:500;text-align:center;padding:6px 0">No documents uploaded</div>`;

  // History
  let hist=(t.history||[]).map(h=>`<div class="pay-row"><span class="ok">✓ ${esc(h.month)}</span><span>${fmtMoney(h.amount)} · ${esc(h.date)}${h.method?" · "+esc(h.method):""}</span></div>`).join("");
  document.getElementById("tv-hist").innerHTML=hist?`<div class="pay-hist">${hist}</div>`:`<div style="font-size:11px;color:var(--text3);font-weight:500;text-align:center;padding:6px 0">No payment history yet</div>`;

  // v12 hooks: financial summary + maintenance list (defined later in script)
  try{ if(typeof renderTenantFinancialSummary==="function") await renderTenantFinancialSummary(t); }catch(e){ console.warn("fin summary:",e); }
  try{ if(typeof renderTenantMaintList==="function") await renderTenantMaintList(t.id); }catch(e){ console.warn("maint list:",e); }
}

window.openPaymentModal=()=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ fetchAndOpenPay(); return; }
  document.getElementById("pay-amount").value=t.rent||"";
  document.getElementById("payment-modal").classList.add("open");
};
async function fetchAndOpenPay(){
  let all=await fbGet("tenants");
  let t=all.find(x=>x.id===currentTenantId);
  if(t){ document.getElementById("pay-amount").value=t.rent||""; document.getElementById("payment-modal").classList.add("open"); }
}
window.payViaUPI=(app)=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  let amt=g("pay-amount")||(t?.rent||0);
  let upi="kiraabook@upi";
  let url=`upi://pay?pa=${upi}&pn=KiraaBook&am=${amt}&cu=INR&tn=Rent`;
  if(app==="phonepe") url="phonepe://pay?"+url.split("?")[1];
  else if(app==="paytm") url="paytmmp://pay?"+url.split("?")[1];
  else if(app==="gpay") url="tez://upi/pay?"+url.split("?")[1];
  window.location.href=url;
  setTimeout(()=>toast(`Opening ${app}...`,"info"),100);
  closeModal("payment-modal");
};

// ── TENANT: I HAVE PAID CLAIM ─────────────────────────────────
window.openClaimModal=async()=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ toast("Session expired","error"); return; }
  sv("claim-amount", t.rent||"");
  sv("claim-method","upi");
  sv("claim-ref","");
  sv("claim-date", new Date().toISOString().split("T")[0]);
  sv("claim-notes","");
  document.getElementById("claim-err").textContent="";
  document.getElementById("claim-modal").classList.add("open");
};
window.submitPaymentClaim=async()=>{
  let amount=g("claim-amount"), method=g("claim-method"), ref=g("claim-ref");
  let date=g("claim-date"), notes=g("claim-notes");
  let err=document.getElementById("claim-err");
  if(!amount||!method||!date){ err.textContent="Fill amount, method and date."; return; }
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ err.textContent="Session expired."; return; }
  // Find the latest unpaid bill (best match)
  let allBills=await fbGet("bills");
  let unpaid=allBills.filter(b=>b.tenantId===t.id&&b.status!=="paid").sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
  let billId=unpaid.length?unpaid[0].id:"";
  let monthLabel=unpaid.length?unpaid[0].monthLabel:new Date().toLocaleString("default",{month:"long",year:"numeric"});
  err.textContent="⏳ Submitting...";
  try{
    await fbAdd("paymentClaims",{
      billId,
      tenantId:t.id,
      tenantName:t.name,
      tenantPhone:t.phone||"",
      ownerID:t.ownerID||"",
      amount:Number(amount),
      method, reference:ref, date, notes, monthLabel,
      status:"pending"
    });
    closeModal("claim-modal");
    toast("✅ Submitted! Owner will confirm shortly.");
    // v10: push notify owner
    if(t.ownerID){
      await pushNotification(t.ownerID,
        `💰 Payment claim from ${t.name}`,
        `${fmtMoney(amount)} for ${monthLabel} via ${method}${ref?" (Ref: "+ref+")":""}. Awaiting your approval.`,
        "payment_claim");
    }
    await logActivity("Payment Claim Submitted",`Tenant: ${t.name}, Amount: ${fmtMoney(amount)}, Method: ${method}`,t.name);
    // Optionally also open WhatsApp to owner
    if(t.ownerID){
      let owner=await fbGetDoc("owners",t.ownerID);
      if(owner&&owner.phone){
        let msg=`Hi ${owner.name||""}, I have paid ${fmtMoney(amount)} for ${monthLabel} via ${method}.${ref?" Ref: "+ref+".":""} Please confirm. -${t.name}`;
        let phoneClean=owner.phone.replace(/[^0-9]/g,"");
        let url=`https://wa.me/${phoneClean}?text=${encodeURIComponent(msg)}`;
        setTimeout(()=>window.open(url,"_blank"),500);
      }
    }
    // Refresh tenant view
    setTimeout(()=>renderTenantView(t),800);
  }catch(e){ console.error(e); err.textContent="❌ Error: "+e.message; }
};

window.viewImg=(src)=>{ document.getElementById("img-src").src=src; document.getElementById("img-modal").classList.add("show"); };
window.closeImgModal=()=>document.getElementById("img-modal").classList.remove("show");

window.sendVacantNotice=async()=>{
  let date=g("vacant-date"), reason=g("vacant-reason");
  if(!date){ toast("Select a vacating date","error"); return; }
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ toast("Session error","error"); return; }
  await fbAdd("vacantNotices",{
    tenantId:t.id, tenantName:t.name, room:t.room||"", phone:t.phone||"",
    ownerID:t.ownerID||"", vacateDate:date, reason,
    submittedOn:new Date().toLocaleDateString("en-IN"),
    dismissed:false
  });
  // v10: push notify owner
  if(t.ownerID){
    await pushNotification(t.ownerID,
      `📦 Vacating notice from ${t.name}`,
      `Room ${t.room||"–"} · Vacating on ${fmtDate(date)}${reason?" · "+reason:""}`,
      "vacant_notice");
  }
  toast("📨 Vacating notice sent to owner!");
  sv("vacant-date",""); sv("vacant-reason","");
  await logActivity("Vacant Notice Sent",`Tenant: ${t.name}, Date: ${date}`,t.name);
};

// ── Cross-module exports ──────────────────────────────────────
window.renderTenantView = renderTenantView;   // called from auth.js and account.js
window.renderAccountTab = renderAccountTab;   // called from owner.js and account.js

