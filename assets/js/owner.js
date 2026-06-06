import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, PAY_LINKS, collection, onSnapshot, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, genUID, esc, escAttr, daysBetween, closeModal } from './helpers.js';

// ── TRIAL STATUS / LIMITS ────────────────────────────────────
function checkTrialStatus(owner){
  if(!owner) return {isTrial:false,expired:false,daysLeft:9999};
  if(owner.plan!=="trial") return {isTrial:false,expired:false,daysLeft:9999};
  let now=new Date();
  let exp=owner.subExpiry?new Date(owner.subExpiry):null;
  if(!exp) return {isTrial:true,expired:false,daysLeft:30};
  let left=daysBetween(now,exp);
  return {isTrial:true,expired:left<0,daysLeft:left};
}

function renderTrialBanner(){
  let wrap=document.getElementById("trial-banner-wrap");
  if(!wrap||!currentOwnerData){ wrap&&(wrap.innerHTML=""); return; }
  let st=checkTrialStatus(currentOwnerData);
  if(!st.isTrial){ wrap.innerHTML=""; return; }
  if(st.expired){
    wrap.innerHTML=`<div class="trial-banner expired">
      <div class="trial-banner-head">⛔ Your Free Trial Has Expired</div>
      <div class="trial-banner-body">You can no longer add tenants or create bills. Please upgrade to keep using KiraaBook.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn btn-success" href="${PAY_LINKS.monthly}" target="_blank" style="flex:1">💳 Monthly ₹40</a>
        <a class="btn btn-gold" href="${PAY_LINKS.annual}" target="_blank" style="flex:1">💰 Annual ₹499</a>
        <button class="btn btn-edit" onclick="upgradeAccount()" style="flex:1">📋 View Plans</button>
      </div>
    </div>`;
  } else if(st.daysLeft<=7){
    wrap.innerHTML=`<div class="trial-banner warn">
      <div class="trial-banner-head">⚠️ Trial Ending in ${st.daysLeft} day${st.daysLeft===1?"":"s"}</div>
      <div class="trial-banner-body">Your free trial ends on ${fmtDate(currentOwnerData.subExpiry)}. Upgrade now to keep your account active and add unlimited tenants.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn btn-success" href="${PAY_LINKS.monthly}" target="_blank" style="flex:1">💳 Buy Monthly ₹40</a>
        <a class="btn btn-gold" href="${PAY_LINKS.annual}" target="_blank" style="flex:1">💰 Buy Annual ₹499</a>
      </div>
    </div>`;
  } else {
    wrap.innerHTML=`<div class="trial-banner ok">
      <div class="trial-banner-head">🎉 Free Trial Active — ${st.daysLeft} days remaining</div>
      <div class="trial-banner-body">You're on the 30-day free trial (max 3 tenants). Upgrade anytime from My Account.</div>
    </div>`;
  }
}

function canAddTenant(){
  if(!currentOwnerData) return true;
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired){ toast("⛔ Free trial expired. Please upgrade to add tenants.","error"); return false; }
  if(currentOwnerData.plan==="trial" && tenants.length>=3){
    toast("⛔ Trial limit reached (3 tenants). Upgrade to add more.","error");
    return false;
  }
  return true;
}

function renderTenantLimitWarn(){
  let el=document.getElementById("tenant-limit-warn");
  if(!el||!currentOwnerData) return;
  if(currentOwnerData.plan==="trial" && tenants.length>=3){
    el.style.display="block";
    el.innerHTML=`⚠️ <strong>Trial limit reached:</strong> You have 3 tenants (the maximum on the free plan). Upgrade to add unlimited tenants. <a href="javascript:void(0)" onclick="openPlansModal()" style="color:var(--blue);font-weight:700">Buy plan →</a>`;
  } else { el.style.display="none"; }
  // Disable add-tenant button if at cap or expired
  let btn=document.getElementById("add-tenant-btn");
  let info=document.getElementById("add-tenant-info");
  let st=checkTrialStatus(currentOwnerData);
  if(btn){
    if(st.expired||(currentOwnerData.plan==="trial"&&tenants.length>=3)){
      btn.disabled=true;
      btn.style.opacity=".5";
      btn.style.cursor="not-allowed";
      if(info) info.innerHTML=`⛔ ${st.expired?"Trial expired":"Trial limit (3 tenants) reached"}. <a href="javascript:void(0)" onclick="openPlansModal()" style="color:var(--blue);font-weight:700">Upgrade to add more →</a>`;
    } else {
      btn.disabled=false;
      btn.style.opacity="1";
      btn.style.cursor="pointer";
      if(info) info.innerHTML=`💡 Add tenants directly. They can login later via Tenant Portal.`;
    }
  }
}

// ── OWNER INIT ────────────────────────────────────────────────
async function initOwner(){
  let ownerID=localStorage.getItem("kb_owner_id");
  let ownerName=localStorage.getItem("kb_owner_name")||"Owner";
  document.getElementById("owner-display-name").textContent=ownerName;
  let inviteLink=`${window.location.href.split("?")[0]}?owner=${ownerID}`;
  document.getElementById("invite-link-text").textContent=inviteLink;

  // Refresh owner data from DB
  try{
    let ownerDoc=await fbGetDoc("owners",ownerID);
    if(ownerDoc) currentOwnerData=ownerDoc;
  }catch(e){}

  // v10: Profile pic in header circle
  let circle=document.getElementById("owner-pic-circle");
  if(circle){
    if(currentOwnerData?.profilePic) circle.innerHTML=`<img src="${currentOwnerData.profilePic}"/>`;
    else circle.textContent=(ownerName.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2))||"👤";
  }
  // v10: Restore settings
  let sel=document.getElementById("set-currency"); if(sel) sel.value=CURRENCY;
  let nt=document.getElementById("set-notif-toggle");
  if(nt && localStorage.getItem("kb_browser_notif")==="on") nt.classList.add("on");

  renderTrialBanner();

  if(unsubT){unsubT();}
  if(unsubB){unsubB();}
  if(unsubR){unsubR();}
  if(unsubC){unsubC();}

  unsubT=onSnapshot(collection(db,"tenants"),snap=>{
    let ownerDocId = (currentOwnerData && currentOwnerData.id) || ownerID;
    tenants=snap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>
      t.ownerID===ownerID || t.ownerID===ownerDocId
    );
    renderTenantList(); updateOwnerStats(); populateTenantSelect();
    renderOverdueAlerts(); renderVacantNotices();
    renderTenantLimitWarn(); renderRemindersSection();
    // v11 fix: re-filter bills against my tenants list when it changes
    refreshBillsForOwner(ownerID);
    // v13: also re-render maintenance which may match via tenantId
    if(typeof tickets!=="undefined"){
      let mt=document.getElementById("tab-maintenance");
      if(mt && mt.style.display!=="none" && typeof renderMaintenance==="function") window.renderMaintenance && window.renderMaintenance();
    }
    let tab=document.getElementById("tab-roomhist");
    if(tab && tab.style.display!=="none") renderRoomHistory();
  });
  unsubB=onSnapshot(collection(db,"bills"),snap=>{
    window._rawBills = snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshBillsForOwner(ownerID);
  });
  unsubR=onSnapshot(collection(db,"rooms"),snap=>{
    rooms=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.ownerID===ownerID);
    renderRooms();
  });
  unsubC=onSnapshot(collection(db,"paymentClaims"),snap=>{
    paymentClaims=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.ownerID===ownerID);
    renderClaimsSection();
  });

  // v10: notifications + room history
  subscribeOwnerNotifications(ownerID);
  subscribeRoomHistory(ownerID);

  let now=new Date();
  document.getElementById("bill-month").value=now.toISOString().slice(0,7);
  let due=new Date(now.getFullYear(),now.getMonth(),7);
  document.getElementById("bill-due").value=due.toISOString().split("T")[0];
  setTimeout(()=>autoCreateMonthlyBills(),2000);
}

async function autoCreateMonthlyBills(){
  let now=new Date();
  let monthKey=now.getFullYear()+"-"+(now.getMonth()+1);
  let ownerID=localStorage.getItem("kb_owner_id");
  let lastRun=localStorage.getItem("kb_auto_month_"+ownerID);
  if(lastRun===monthKey) return;
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired) return; // don't auto-create bills if expired
  let autoTenants=tenants.filter(t=>t.approved&&t.rent&&t.billMode==="auto");
  for(let t of autoTenants){
    let existingBill=bills.find(b=>b.tenantId===t.id&&b.monthKey===monthKey);
    if(!existingBill){
      let due=new Date(now.getFullYear(),now.getMonth(),7);
      await fbAdd("bills",{
        tenantId:t.id, tenantName:t.name, tenantPhone:t.phone||"",
        ownerID, monthKey,
        monthLabel:now.toLocaleString("default",{month:"long",year:"numeric"}),
        dueDate:due.toISOString().split("T")[0],
        items:[{name:"Rent",amount:Number(t.rent)||0}],
        total:Number(t.rent)||0,
        status:"pending",
        createdOn:now.toLocaleDateString("en-IN"),
        autoCreated:true,
        lastReminded:null
      });
    }
  }
  localStorage.setItem("kb_auto_month_"+ownerID,monthKey);
}

// ── PAYMENT CLAIMS (Owner approves) ──────────────────────────
function renderClaimsSection(){
  let sec=document.getElementById("claims-section");
  let list=document.getElementById("claims-list");
  if(!sec||!list) return;
  let pending=paymentClaims.filter(c=>c.status==="pending");
  if(!pending.length){ sec.style.display="none"; return; }
  sec.style.display="block";
  list.innerHTML=pending.map(c=>`
    <div class="claim-card">
      <div class="claim-head">
        <div>
          <div style="font-weight:700;font-size:13px">${esc(c.tenantName)}</div>
          <div style="font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">${esc(c.tenantId)}</div>
        </div>
        <div style="font-size:18px;font-weight:800;color:var(--gold)">${fmtMoney(c.amount)}</div>
      </div>
      <div class="claim-meta">
        <span>Method: <strong style="color:var(--text)">${esc(c.method)}</strong></span>
        <span>Paid on: <strong style="color:var(--text)">${fmtDate(c.date)}</strong></span>
        ${c.reference?`<span>Ref: <strong style="color:var(--text)">${esc(c.reference)}</strong></span>`:""}
        ${c.monthLabel?`<span>Month: <strong style="color:var(--text)">${esc(c.monthLabel)}</strong></span>`:""}
      </div>
      ${c.notes?`<div style="font-size:11px;color:var(--text3);margin-top:6px;font-style:italic">"${esc(c.notes)}"</div>`:""}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-success" onclick="approvePaymentClaim('${c.id}')">✅ Approve &amp; Mark Paid</button>
        <button class="btn btn-danger" onclick="rejectPaymentClaim('${c.id}')">❌ Reject</button>
      </div>
    </div>`).join("");
}

window.approvePaymentClaim=async(claimId)=>{
  let claim=paymentClaims.find(c=>c.id===claimId);
  if(!claim){ toast("Claim not found","error"); return; }
  try{
    // Update tenant: mark paid + add history
    let t=await fbGetDoc("tenants",claim.tenantId);
    if(t){
      let now=new Date();
      let hist=(t.history||[]);
      hist.unshift({
        month:claim.monthLabel||now.toLocaleString("default",{month:"long",year:"numeric"}),
        date:now.toLocaleDateString("en-IN"),
        amount:claim.amount,
        method:claim.method,
        reference:claim.reference||""
      });
      await fbUpdate("tenants",claim.tenantId,{
        paid:true, history:hist,
        lastPaidDate:now.toISOString().split("T")[0]
      });
    }
    // Update bill if linked
    if(claim.billId){
      let nowD=new Date();
      await fbUpdate("bills",claim.billId,{
        status:"paid",
        paidOn:nowD.toLocaleDateString("en-IN"),
        paidOnIso:nowD.toISOString()
      });
    }
    // Mark claim approved
    await fbUpdate("paymentClaims",claimId,{
      status:"approved",
      approvedOn:new Date().toLocaleDateString("en-IN")
    });
    toast(`✅ Payment from ${claim.tenantName} approved!`);
    await logActivity("Payment Approved",`Tenant: ${claim.tenantName}, Amount: ${fmtMoney(claim.amount)}, Method: ${claim.method}`,"Owner");
  }catch(e){ console.error(e); toast("Error: "+e.message,"error"); }
};

window.rejectPaymentClaim=async(claimId)=>{
  let reason=prompt("Reason for rejection (optional):") || "Owner did not approve";
  try{
    await fbUpdate("paymentClaims",claimId,{
      status:"rejected",
      rejectionReason:reason,
      rejectedOn:new Date().toLocaleDateString("en-IN")
    });
    toast("❌ Payment claim rejected");
    await logActivity("Payment Rejected",`Reason: ${reason}`,"Owner");
  }catch(e){ toast("Error","error"); }
};

// ── REMINDERS (client-side scheduler) ─────────────────────────
function renderRemindersSection(){
  let sec=document.getElementById("reminders-section");
  let list=document.getElementById("reminders-list");
  if(!sec||!list) return;
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired){ sec.style.display="none"; return; }
  let now=new Date();
  let reminders=[];
  bills.forEach(b=>{
    if(b.status==="paid") return;
    if(!b.dueDate) return;
    let t=tenants.find(x=>x.id===b.tenantId);
    if(!t||!t.phone) return;
    let due=new Date(b.dueDate);
    let diff=daysBetween(now,due);
    let lastRem=b.lastReminded?new Date(b.lastReminded):null;
    let hoursSinceLast=lastRem?(now-lastRem)/(1000*60*60):9999;
    let kind=null, label="";
    if(diff===1 && !lastRem){
      kind="day-before"; label="📅 Due Tomorrow";
    } else if(diff===0){
      if(!lastRem){ kind="today-1"; label="🔔 Due TODAY (first reminder)"; }
      else if(hoursSinceLast>=8){ kind="today-2"; label="🔔 Due TODAY (8hr follow-up)"; }
    } else if(diff<0){
      if(!lastRem||hoursSinceLast>=24){ kind="overdue"; label=`🚨 Overdue by ${Math.abs(diff)} day${Math.abs(diff)===1?"":"s"}`; }
    }
    if(kind){
      reminders.push({bill:b, tenant:t, kind, label, diff});
    }
  });
  if(!reminders.length){ sec.style.display="none"; return; }
  sec.style.display="block";
  list.innerHTML=reminders.map(r=>`
    <div class="reminder-card">
      <div class="reminder-info">
        <div style="font-weight:700;font-size:12px">${esc(r.tenant.name)} — Room ${esc(r.tenant.room||"–")}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">${r.label} · ${fmtMoney(r.bill.total)} · ${esc(r.bill.monthLabel||"")}</div>
      </div>
      <button class="btn btn-warn" onclick="sendRentReminder('${r.bill.id}','${escAttr(r.tenant.phone)}','${escAttr(r.tenant.name)}','${r.bill.total}','${escAttr(r.bill.monthLabel||"")}','${r.kind}')">💬 Send WhatsApp</button>
    </div>`).join("");
}

window.sendRentReminder=async(billId,phone,name,amount,monthLabel,kind)=>{
  let msg="";
  if(kind==="day-before"){
    msg=`Dear ${name}, this is a friendly reminder that your rent of ${fmtMoney(amount)} for ${monthLabel} is due TOMORROW. Please pay on time. -KiraaBook`;
  } else if(kind==="today-1"){
    msg=`Dear ${name}, your rent of ${fmtMoney(amount)} for ${monthLabel} is DUE TODAY. Kindly pay at your earliest. -KiraaBook`;
  } else if(kind==="today-2"){
    msg=`Dear ${name}, reminder: your rent of ${fmtMoney(amount)} for ${monthLabel} is still pending today. Please pay soon. -KiraaBook`;
  } else {
    msg=`Dear ${name}, ⚠️ your rent of ${fmtMoney(amount)} for ${monthLabel} is OVERDUE. Please pay immediately. -KiraaBook`;
  }
  let url=`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url,"_blank");
  try{
    await fbUpdate("bills",billId,{lastReminded:new Date().toISOString(),lastReminderKind:kind});
    toast("📨 Reminder opened in WhatsApp","info");
    await logActivity("Rent Reminder Sent",`Tenant: ${name}, Kind: ${kind}, Amount: ${fmtMoney(amount)}`,"Owner");
  }catch(e){}
};

window.sendAllReminders=async()=>{
  let now=new Date();
  let count=0;
  for(let b of bills){
    if(b.status==="paid"||!b.dueDate) continue;
    let t=tenants.find(x=>x.id===b.tenantId);
    if(!t||!t.phone) continue;
    let due=new Date(b.dueDate);
    let diff=daysBetween(now,due);
    let lastRem=b.lastReminded?new Date(b.lastReminded):null;
    let hoursSinceLast=lastRem?(now-lastRem)/(1000*60*60):9999;
    let kind=null;
    if(diff===1 && !lastRem) kind="day-before";
    else if(diff===0 && !lastRem) kind="today-1";
    else if(diff===0 && hoursSinceLast>=8) kind="today-2";
    else if(diff<0 && (!lastRem||hoursSinceLast>=24)) kind="overdue";
    if(kind){
      setTimeout(()=>sendRentReminder(b.id,t.phone,t.name,b.total,b.monthLabel||"",kind),count*800);
      count++;
    }
  }
  if(count) toast(`📨 Opening ${count} WhatsApp tabs...`,"info");
  else toast("No reminders to send","info");
};

// ── OVERDUE ───────────────────────────────────────────────────
function isOverdue(t){
  if(t.paid) return false;
  let ref=t.lastPaidDate?new Date(t.lastPaidDate):t.date?new Date(t.date):null;
  if(!ref) return false;
  return Math.floor((new Date()-ref)/(864e5))>=30;
}

function renderOverdueAlerts(){
  let ovd=tenants.filter(t=>t.approved&&isOverdue(t));
  let sec=document.getElementById("overdue-section"),lst=document.getElementById("overdue-list");
  if(!ovd.length){ sec.style.display="none"; return; }
  sec.style.display="block";
  lst.innerHTML=ovd.map(t=>{
    let msg=`Dear ${t.name}, ⚠️ your rent of ${fmtMoney(t.rent)} is overdue. Please pay immediately. -KiraaBook`;
    let wa=t.phone?`https://wa.me/91${t.phone}?text=${encodeURIComponent(msg)}`:"#";
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(244,63,94,.15);gap:10px">
      <div><span style="font-weight:700;font-size:12px;color:var(--red)">🔴 ${esc(t.name)}</span> <span style="font-size:10px;color:var(--text3)">Room ${esc(t.room||"–")} · ${fmtMoney(t.rent)}/mo</span></div>
      ${t.phone?`<a class="btn btn-danger" href="${wa}" target="_blank" style="font-size:10px;padding:4px 10px;flex-shrink:0">💬 Remind</a>`:""}
    </div>`;
  }).join("");
}

async function renderVacantNotices(){
  let ownerID=localStorage.getItem("kb_owner_id");
  try{
    let notices=await fbGet("vacantNotices");
    let myNotices=notices.filter(n=>n.ownerID===ownerID&&!n.dismissed);
    let sec=document.getElementById("vacant-notices-section"),lst=document.getElementById("vacant-notices-list");
    if(!myNotices.length){ sec.style.display="none"; return; }
    sec.style.display="block";
    lst.innerHTML=myNotices.map(n=>`
      <div style="background:var(--s3);border:1px solid rgba(34,211,238,.2);border-radius:var(--rs);padding:12px;margin-bottom:8px">
        <div style="font-weight:700;font-size:12px;color:var(--cyan);margin-bottom:4px">📦 ${esc(n.tenantName)} — Room ${esc(n.room||"–")}</div>
        <div style="font-size:11px;color:var(--text3);font-weight:500">Vacating: ${fmtDate(n.vacateDate)}${n.reason?` · ${esc(n.reason)}`:""}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-ghost" style="font-size:10px" onclick="dismissNotice('${n.id}')">✓ Noted</button>
          ${n.phone?`<a class="btn btn-warn" href="https://wa.me/91${n.phone}" target="_blank" style="font-size:10px">💬 WhatsApp</a>`:""}
        </div>
      </div>`).join("");
  }catch(e){}
}
window.dismissNotice=async(id)=>{ await fbUpdate("vacantNotices",id,{dismissed:true}); renderVacantNotices(); toast("✓ Noted"); };

// ── OWNER ACTIONS ─────────────────────────────────────────────
window.approveTenant=async(id)=>{
  let t=await fbGetDoc("tenants",id);
  await fbUpdate("tenants",id,{approved:true,active:true});
  if(t && t.room && t.ownerID){
    await recordRoomHistoryEntry(id, t.name, t.room, t.rent, t.ownerID, t.date);
  }
  toast("✅ Tenant approved!");
  await logActivity("Tenant Approved",`ID: ${id}`,"Owner");
};
window.deactivateTenant=async(id,name)=>{
  if(!confirm(`Deactivate ${name}? They will not be able to login. You can reactivate later.`)) return;
  let t=await fbGetDoc("tenants",id);
  await fbUpdate("tenants",id,{active:false,approved:false});
  if(t && t.ownerID) await closeRoomHistoryEntry(id, t.ownerID, "Deactivated by owner");
  toast("⚠️ Tenant deactivated");
  await logActivity("Tenant Deactivated",`Name: ${name}`,"Owner");
};
window.reactivateTenant=async(id,name)=>{
  let t=await fbGetDoc("tenants",id);
  await fbUpdate("tenants",id,{active:true,approved:true});
  if(t && t.room && t.ownerID) await recordRoomHistoryEntry(id, t.name, t.room, t.rent, t.ownerID, new Date().toISOString().split("T")[0]);
  toast(`▶ ${name} reactivated`);
  await logActivity("Tenant Reactivated",`Name: ${name}`,"Owner");
};
window.markPaid=async(id,rent)=>{
  let now=new Date();
  let t=tenants.find(x=>x.id===id);
  let hist=(t?.history||[]);
  let monthStr = now.toLocaleString("default",{month:"long",year:"numeric"});
  let monthKey = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  hist.unshift({month:monthStr,date:now.toLocaleDateString("en-IN"),amount:rent});
  await fbUpdate("tenants",id,{paid:true,history:hist,lastPaidDate:now.toISOString().split("T")[0]});

  // v13.x SYNC FIX: also sync the bills collection so the dashboard Collected/Pending
  // tiles stay in sync with the "Paid This Month" status shown on tenant cards.
  try{
    let ownerID = t?.ownerID || localStorage.getItem("kb_owner_id");
    // Find an existing bill for this tenant + current month
    let allBills = window._rawBills || bills || [];
    let existing = allBills.find(b=>b.tenantId===id && b.monthKey===monthKey);
    let nowIso = now.toISOString();
    let paidOnLabel = now.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
    if(existing){
      // Update its status to paid
      await fbUpdate("bills", existing.id, {
        status:"paid",
        paidOn:paidOnLabel,
        paidOnIso:nowIso
      });
    } else {
      // Create a synthetic bill record so the tile picks it up
      let due = new Date(now.getFullYear(), now.getMonth(), 7);
      await fbAdd("bills", {
        tenantId:id, tenantName:t?.name||"",
        tenantPhone:t?.phone||"",
        ownerID:ownerID,
        monthKey, monthLabel:monthStr,
        items:[{label:"Rent", amount:Number(rent||0)}],
        total:Number(rent||0),
        dueDate:due.toISOString().split("T")[0],
        status:"paid",
        paidOn:paidOnLabel,
        paidOnIso:nowIso,
        createdOn:nowIso,
        autoCreated:true,
        source:"tenant_mark_paid"
      });
    }
  }catch(e){ console.warn("[markPaid] bill sync failed:", e); }

  toast("✅ Rent marked as paid!");
  await logActivity("Rent Paid",`Tenant: ${t?.name}, Amount: ${fmtMoney(rent)}`,"Owner");
};

window.markUnpaid=async(id)=>{
  let t=tenants.find(x=>x.id===id);
  await fbUpdate("tenants",id,{paid:false});

  // v13.x SYNC FIX: also revert the current month's bill to unpaid
  // (always flip status, never delete — otherwise the unpaid rent disappears from Pending)
  try{
    let now=new Date();
    let monthKey = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
    let allBills = window._rawBills || bills || [];
    let existing = allBills.find(b=>b.tenantId===id && b.monthKey===monthKey && b.status==="paid");
    if(existing){
      await fbUpdate("bills", existing.id, {
        status:"unpaid",
        paidOn:null,
        paidOnIso:null
      });
    }
  }catch(e){ console.warn("[markUnpaid] bill sync failed:", e); }

  toast("↩ Marked unpaid");
};
window.deleteTenant=async(id,name)=>{
  if(!confirm(`Delete ${name}? Cannot be undone.`)) return;
  let t=await fbGetDoc("tenants",id);
  if(t && t.ownerID) await closeRoomHistoryEntry(id, t.ownerID, "Deleted by owner");
  await fbDel("tenants",id);
  toast("🗑 Deleted");
  await logActivity("Tenant Deleted",`Name: ${name}`,"Owner");
};

// ── OPEN TENANT DETAIL ────────────────────────────────────────
window.openTenantDetail=(id)=>{
  let t=tenants.find(x=>x.id===id);
  if(!t) return;
  let ini=t.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  let avH=t.profPhoto?`<img src="${t.profPhoto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 10px;display:block;"/>`
    :`<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--gold));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#111;margin:0 auto 10px">${ini}</div>`;
  let docs="";
  if(t.idPhoto)docs+=`<div class="doc-item"><img src="${t.idPhoto}" onclick="viewImg('${t.idPhoto}')"/><div class="doc-label">${esc(t.idType||"ID")}</div></div>`;
  if(t.pvPhoto)docs+=`<div class="doc-item"><img src="${t.pvPhoto}" onclick="viewImg('${t.pvPhoto}')"/><div class="doc-label">Police</div></div>`;
  let hist=(t.history||[]).map(h=>`<div class="pay-row"><span class="ok">✓ ${esc(h.month)}</span><span>${fmtMoney(h.amount)} · ${esc(h.date)}${h.method?" · "+esc(h.method):""}</span></div>`).join("");
  let propertyName = "–";
  if(t.propertyId){
    let p = (properties||[]).find(x=>x.id===t.propertyId);
    if(p) propertyName = p.name || "–";
  }
  let infoRows=[
    ["Tenant ID",t.tid||t.id],
    ["Property",propertyName],
    ["Room",t.room||"–"],["Rent",fmtMoney(t.rent)],
    ["🔒 Security Deposit", fmtMoney(t.securityDeposit||0) + (Number(t.securityDeposit)>0 ? " (refundable)" : "")],
    ["💰 Advance Rent Balance", fmtMoney(t.advanceRentBalance!=null ? t.advanceRentBalance : (t.advanceRent||0))],
    ["Phone",t.phone||"–"],["Alt Phone",t.alt||"–"],
    ["Email",t.email||"–"],
    ["Address",t.address||"–"],
    ["ID",t.idType?(t.idType+(t.idNum?" · "+t.idNum:"")):"–"],
    ["Move-in",t.date?fmtDate(t.date):"–"],
    ["Bill Mode",t.billMode||"auto"],
    ["Status",t.approved?"Approved":"Pending"],
    ["Payment",t.paid?"✅ Paid this month":"⚠️ Unpaid"],
    ["Verification",t.pvPhoto?"✅ Uploaded":"❌ Missing"],
    ["Policy",t.policyAccepted?"✅ Accepted":"–"],
    ["Notes",t.notes||"–"]
  ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;gap:12px"><span style="color:var(--text3);font-weight:500;flex-shrink:0">${l}</span><span style="font-weight:700;text-align:right">${esc(v)}</span></div>`).join("");

  document.getElementById("tenant-detail-content").innerHTML=`
    <div style="text-align:center;margin-bottom:14px">${avH}<div style="font-size:18px;font-weight:800">${esc(t.name)}</div></div>
    ${infoRows}
    ${docs?`<div style="margin-top:12px"><div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Documents</div><div class="doc-grid">${docs}</div></div>`:""}
    ${hist?`<div style="margin-top:12px"><div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Payment History</div><div class="pay-hist">${hist}</div></div>`:""}
  `;
  let msg=`Dear ${t.name}, your rent of ${fmtMoney(t.rent)} is due. -KiraaBook`;
  let wa=t.phone?`https://wa.me/${t.phone.replace(/[^0-9]/g,"")}?text=${encodeURIComponent(msg)}`:"";
  let activeFlag = t.active!==false;
  document.getElementById("tenant-detail-actions").innerHTML=`
    <button class="btn btn-edit" onclick="openOwnerEditTenant('${id}');closeModal('tenant-detail-modal')">✏️ Edit Details</button>
    <button class="btn btn-gold" onclick="openRentAgreementBuilder('${id}')">📄 Rent Agreement</button>
    ${!t.approved?`<button class="btn btn-approve" onclick="approveTenant('${id}');closeModal('tenant-detail-modal')">✓ Approve</button>`:""}
    ${t.approved&&!t.paid?`<button class="btn btn-success" onclick="markPaid('${id}','${t.rent}');closeModal('tenant-detail-modal')">✓ Mark Paid</button>`:""}
    ${t.approved&&t.paid?`<button class="btn btn-undo" onclick="markUnpaid('${id}');closeModal('tenant-detail-modal')">↩ Unpaid</button>`:""}
    ${wa?`<a class="btn btn-warn" href="${wa}" target="_blank">💬 WhatsApp</a>`:""}
    ${activeFlag ? `<button class="btn btn-warn" onclick="deactivateTenant('${id}','${escAttr(t.name)}');closeModal('tenant-detail-modal')">⏸ Deactivate</button>` : `<button class="btn btn-success" onclick="reactivateTenant('${id}','${escAttr(t.name)}');closeModal('tenant-detail-modal')">▶ Reactivate</button>`}
    <button class="btn btn-danger" onclick="deleteTenant('${id}','${escAttr(t.name)}');closeModal('tenant-detail-modal')">🗑 Delete</button>
  `;
  document.getElementById("tenant-detail-modal").classList.add("open");
};

// ── OWNER: ADD TENANT ─────────────────────────────────────────
window.ownerAddTenant=async()=>{
  if(!canAddTenant()) return;
  let name=g("ot-name"), room=g("ot-room"), rent=g("ot-rent");
  if(!name||!room||!rent){ toast("Fill name, room and rent.","error"); return; }
  let phone=g("ot-phone");
  // Default password: phone number's last 6 digits (or "kiraabook" if no phone)
  let defaultPass=phone ? phone.replace(/[^0-9]/g,"").slice(-6).padStart(6,"0") : "kiraabook";
  let ownerID=localStorage.getItem("kb_owner_id")||"";
  let tid=genUID();
  let obj={
    tid, name, room, rent,
    propertyId: g("ot-property")||"",
    securityDeposit: Number(g("ot-security"))||0,
    advanceRent: Number(g("ot-advance"))||0,
    advanceRentBalance: Number(g("ot-advance"))||0,  // remaining unused
    phone, alt:g("ot-alt"),
    email:g("ot-email").toLowerCase(),
    address:g("ot-address"), idType:g("ot-idtype"), idNum:g("ot-idnum"),
    date:g("ot-date")||new Date().toISOString().split("T")[0],
    notes:g("ot-notes"),
    billMode:g("ot-billmode")||"auto",
    profPhoto:"", idPhoto:"", pvPhoto:"",
    paid:false, history:[], approved:true, active:true,
    ownerID, submittedOn:new Date().toLocaleDateString("en-IN"),
    lastPaidDate:null, addedByOwner:true,
    password:defaultPass,
    needsProfileCompletion:true
  };
  let ref=await fbAdd("tenants",obj);
  await recordRoomHistoryEntry(ref.id, name, room, rent, ownerID, obj.date);

  // Create current-month bill immediately so the tenant's rent appears in
  // Pending right away — autoCreateMonthlyBills only runs once per month
  // and would miss tenants added after it already executed.
  if(Number(rent)>0){
    let now2=new Date();
    let mKey=now2.getFullYear()+"-"+(now2.getMonth()+1);
    let due2=new Date(now2.getFullYear(),now2.getMonth(),7);
    let mLabel=now2.toLocaleString("default",{month:"long",year:"numeric"});
    let alreadyExists=bills.find(b=>b.tenantId===ref.id&&b.monthKey===mKey);
    if(!alreadyExists){
      await fbAdd("bills",{
        tenantId:ref.id, tenantName:name, tenantPhone:phone,
        ownerID, monthKey:mKey, monthLabel:mLabel,
        dueDate:due2.toISOString().split("T")[0],
        items:[{name:"Rent",amount:Number(rent)}],
        total:Number(rent),
        status:"pending",
        createdOn:now2.toLocaleDateString("en-IN"),
        autoCreated:true, lastReminded:null
      });
    }
  }

  ["ot-name","ot-room","ot-rent","ot-phone","ot-alt","ot-email","ot-address","ot-idtype","ot-idnum","ot-date","ot-notes","ot-security","ot-advance","ot-property"].forEach(i=>sv(i,""));
  toast(`✅ ${name} added! Default password: ${defaultPass}`);
  alert(`✅ Tenant Added\n\nName: ${name}\nRoom: ${room}\nLogin name: ${name}\nDefault password: ${defaultPass}\n\nSecurity Deposit: ${fmtMoney(obj.securityDeposit)}\nAdvance Rent: ${fmtMoney(obj.advanceRent)}\n\nShare credentials with tenant. They can change password from their portal.`);
  await logActivity("Owner Added Tenant",`Name: ${name}, Room: ${room}, Security: ${fmtMoney(obj.securityDeposit)}, Advance: ${fmtMoney(obj.advanceRent)}`,"Owner");
  let firstTab=document.querySelector(".t-tab"); if(firstTab) firstTab.click();
};

// ── ROOMS ─────────────────────────────────────────────────────
window.addRoom=async()=>{
  let num=g("new-room-num");
  if(!num){ toast("Enter room number.","error"); return; }
  let ownerID=localStorage.getItem("kb_owner_id")||"";
  await fbAdd("rooms",{roomNum:num,floor:g("new-room-floor"),notes:g("new-room-notes"),ownerID,occupied:false});
  sv("new-room-num",""); sv("new-room-floor",""); sv("new-room-notes","");
  toast(`✅ Room ${num} added!`);
};
function renderRooms(){
  let grid=document.getElementById("room-grid");
  let allRooms=[...rooms];
  tenants.filter(t=>t.approved&&t.room).forEach(t=>{
    if(!allRooms.find(r=>r.roomNum===t.room)) allRooms.push({id:"auto-"+t.id,roomNum:t.room,occupied:true,tenantName:t.name});
  });
  let occCount=0,vacCount=0;
  allRooms.forEach(r=>{
    let t=tenants.find(t2=>t2.room===r.roomNum&&t2.approved);
    r.occupied=!!t; r.tenantName=t?.name||"";
    if(r.occupied)occCount++; else vacCount++;
  });
  let oe=document.getElementById("occ-count"),ve=document.getElementById("s-vacant"),vc=document.getElementById("vac-count");
  if(oe)oe.textContent=occCount; if(ve)ve.textContent=vacCount; if(vc)vc.textContent=vacCount;
  if(!allRooms.length){ grid.innerHTML=`<div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-text">No rooms added yet</div></div>`; return; }
  grid.innerHTML=allRooms.map(r=>`
    <div class="room-card ${r.occupied?"occupied":""}">
      <div class="room-number">Room ${esc(r.roomNum)}</div>
      <span class="room-status ${r.occupied?"rs-occ":"rs-vac"}">${r.occupied?"Occupied":"Vacant"}</span>
      <div class="room-tenant">${esc(r.tenantName||"–")}</div>
      ${r.floor?`<div style="font-size:9px;color:var(--text3);margin-top:4px">${esc(r.floor)}</div>`:""}
    </div>`).join("");
}

window.copyInviteLink=()=>{
  let link=document.getElementById("invite-link-text").textContent;
  navigator.clipboard.writeText(link).then(()=>toast("📋 Copied!","info")).catch(()=>toast("Copy: "+link,"info"));
};

// ── BILLING ───────────────────────────────────────────────────
function populateTenantSelect(){
  let sel=document.getElementById("bill-tenant-sel"); if(!sel)return;
  let appr=tenants.filter(t=>t.approved);
  sel.innerHTML=`<option value="">-- Select Tenant --</option>`+
    appr.map(t=>`<option value="${t.id}" data-rent="${t.rent||0}" data-phone="${t.phone||""}" data-name="${esc(t.name)}">${esc(t.name)} — Room ${esc(t.room||"–")}</option>`).join("");
  sel.onchange=function(){
    let opt=this.options[this.selectedIndex];
    if(opt&&opt.dataset.rent){ let ri=document.getElementById("bill-rent-amt"); if(ri)ri.value=opt.dataset.rent; }
    updateBillPreview();
  };
  // v13.x: populate Month + Year dropdowns
  populateBillMonthYear();
}

window.populateBillMonthYear = ()=>{
  let monthSel = document.getElementById("bill-month-sel");
  let yearSel = document.getElementById("bill-year-sel");
  if(!monthSel || !yearSel) return;
  let now = new Date();
  let curYear = now.getFullYear();
  // Year dropdown: last year, this year, next year
  if(!yearSel.options.length){
    let yearOpts = "";
    for(let y=curYear-1; y<=curYear+1; y++){
      yearOpts += `<option value="${y}" ${y===curYear?"selected":""}>${y}</option>`;
    }
    yearSel.innerHTML = yearOpts;
  }
  // Default month to current month if not already chosen
  if(!monthSel.value){
    let curMonth = String(now.getMonth()+1).padStart(2,"0");
    monthSel.value = curMonth;
  }
  syncBillMonthValue();
};

window.syncBillMonthValue = ()=>{
  let monthSel = document.getElementById("bill-month-sel");
  let yearSel = document.getElementById("bill-year-sel");
  let hidden = document.getElementById("bill-month");
  if(!monthSel || !yearSel || !hidden) return;
  if(monthSel.value && yearSel.value){
    hidden.value = `${yearSel.value}-${monthSel.value}`;
  } else {
    hidden.value = "";
  }
};
window.addBillItem=()=>{
  let li=document.getElementById("bill-items-list");
  let row=document.createElement("div"); row.className="bill-item-row";
  row.innerHTML=`<input placeholder="Item name" oninput="updateBillPreview()"/><input type="number" placeholder="₹ Amount" oninput="updateBillPreview()"/><button class="btn btn-danger" style="padding:7px 9px" onclick="removeBillItem(this)">✕</button>`;
  li.appendChild(row);
};
window.removeBillItem=(btn)=>{ btn.parentElement.remove(); updateBillPreview(); };
window.updateBillPreview=()=>{
  let total=0;
  document.querySelectorAll("#bill-items-list .bill-item-row").forEach(row=>{
    let inputs=row.querySelectorAll("input");
    total+=parseFloat(inputs[1]?.value)||0;
  });
  document.getElementById("bill-total-preview").textContent=fmtMoney(total);
};
window.createBill=async()=>{
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired){ toast("⛔ Trial expired. Please upgrade.","error"); return; }
  let sel=document.getElementById("bill-tenant-sel"),tid=sel.value;
  let month=g("bill-month"),due=g("bill-due");
  if(!tid||!month||!due){ toast("Fill required fields.","error"); return; }
  let opt=sel.options[sel.selectedIndex];
  let tName=opt.dataset.name,tPhone=opt.dataset.phone;
  let rows=document.querySelectorAll("#bill-items-list .bill-item-row");
  let items=[],total=0;
  rows.forEach(row=>{ let inp=row.querySelectorAll("input"); let nm=inp[0]?.value.trim(); let amt=parseFloat(inp[1]?.value)||0; if(nm&&amt>0){items.push({name:nm,amount:amt});total+=amt;} });
  if(!items.length){ toast("Add at least one item.","error"); return; }
  let d=new Date(month+"-01");
  let monthLabel=d.toLocaleString("default",{month:"long",year:"numeric"});
  let ownerID=localStorage.getItem("kb_owner_id");
  await fbAdd("bills",{tenantId:tid,tenantName:tName,tenantPhone:tPhone,ownerID,monthKey:month,monthLabel,dueDate:due,items,total,status:"pending",createdOn:new Date().toLocaleDateString("en-IN"),lastReminded:null});
  toast(`✅ Bill ${fmtMoney(total)} created!`);
  await logActivity("Bill Created",`Tenant: ${tName}, Amount: ${fmtMoney(total)}`,"Owner");
  let billsTab=document.querySelectorAll(".t-tab")[3]; if(billsTab) billsTab.click();
};
window.markBillPaid=async(id)=>{
  let now=new Date();
  await fbUpdate("bills",id,{
    status:"paid",
    paidOn:now.toLocaleDateString("en-IN"),
    paidOnIso:now.toISOString()
  });
  toast("✅ Bill paid!");

  // v13.x SYNC FIX: also mark the tenant as "Paid This Month" if this is current month's bill
  try{
    let bill = (window._rawBills||[]).find(b=>b.id===id) || await fbGetDoc("bills", id);
    if(bill && bill.tenantId){
      let monthKey = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
      if(bill.monthKey === monthKey){
        let t = tenants.find(x=>x.id===bill.tenantId);
        if(t && !t.paid){
          let hist = (t.history||[]);
          let monthStr = now.toLocaleString("default",{month:"long",year:"numeric"});
          // Don't double-add if history already has this month
          if(!hist.find(h=>h.month===monthStr)){
            hist.unshift({month:monthStr, date:now.toLocaleDateString("en-IN"), amount:bill.total});
          }
          await fbUpdate("tenants", bill.tenantId, {paid:true, history:hist, lastPaidDate:now.toISOString().split("T")[0]});
        }
      }
    }
  }catch(e){ console.warn("[markBillPaid] tenant sync failed:", e); }
};

window.markBillUnpaid=async(id)=>{
  await fbUpdate("bills",id,{status:"pending",paidOn:""});

  // v13.x SYNC FIX: revert tenant.paid flag if this was current month's bill
  try{
    let bill = (window._rawBills||[]).find(b=>b.id===id) || await fbGetDoc("bills", id);
    if(bill && bill.tenantId){
      let now=new Date();
      let monthKey = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
      if(bill.monthKey === monthKey){
        await fbUpdate("tenants", bill.tenantId, {paid:false});
      }
    }
  }catch(e){ console.warn("[markBillUnpaid] tenant sync failed:", e); }
};
window.deleteBill=async(id)=>{ if(confirm("Delete this bill?")){ await fbDel("bills",id); toast("🗑 Deleted"); } };

function getBillStatus(b){
  if(b.status==="paid")return"paid";
  let due=new Date(b.dueDate),now=new Date(); now.setHours(0,0,0,0);
  let diff=Math.ceil((due-now)/864e5);
  if(diff<0)return"overdue"; if(diff<=3)return"due"; return"upcoming";
}
function getDaysText(b){
  if(b.status==="paid")return"✅ Paid";
  let due=new Date(b.dueDate),now=new Date(); now.setHours(0,0,0,0);
  let diff=Math.ceil((due-now)/864e5);
  if(diff<0)return`Overdue by ${Math.abs(diff)} days`; if(diff===0)return"Due TODAY!"; if(diff===1)return"Due TOMORROW!"; return`Due in ${diff} days`;
}

window.setFilter=(f,el)=>{ currentFilter=f; document.querySelectorAll("#tab-tenants .f-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active"); renderTenantList(); };
window.setBillFilter=(f,el)=>{ billFilter=f; document.querySelectorAll("#tab-allbills .f-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active"); renderAllBills(); };

window.switchOwnerTab=(tab,el)=>{
  document.querySelectorAll(".t-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active");
  ["tenants","add-tenant","billing","allbills","rooms","roomhist","account","properties","maintenance"].forEach(t=>{ let e2=document.getElementById("tab-"+t); if(e2)e2.style.display=tab===t?"block":"none"; });
  try{
    if(tab==="allbills") renderAllBills();
    if(tab==="billing") populateTenantSelect();
    if(tab==="rooms") renderRooms();
    if(tab==="roomhist") renderRoomHistory();
    if(tab==="account") renderAccountTab();
    if(tab==="properties" && typeof window.renderProperties==="function") window.renderProperties();
    if(tab==="maintenance" && typeof window.renderMaintenance==="function") window.renderMaintenance();
    if(tab==="add-tenant" && typeof window.populatePropertySelect==="function") window.populatePropertySelect();
  }catch(e){ console.error("[switchOwnerTab]", tab, "error:", e); }
};

// v13: shortcut to switch tab by name
window.jumpToOwnerTab = (tabKey)=>{
  let btns = document.querySelectorAll(".t-tab");
  for(let btn of btns){
    let inline = btn.getAttribute("onclick")||"";
    if(inline.includes(`'${tabKey}'`)){ btn.click(); btn.scrollIntoView({behavior:"smooth",block:"nearest"}); return; }
  }
};

// v13: FAQ + Contact open as modal overlays (always reachable, no tab needed)
window.openFaqModal = ()=>{
  document.getElementById("faq-modal").classList.add("open");
  // Render content immediately
  if(typeof window.renderFaqList==="function") window.renderFaqList();
  // Focus search box
  setTimeout(()=>{ document.getElementById("faq-search")?.focus(); }, 100);
};
window.openContactModal = ()=>{
  // Populate contact channel tiles using the SUPPORT_EMAIL / SUPPORT_WHATSAPP constants
  let ch = document.getElementById("contact-channels");
  if(ch){
    let waUrl = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent("Hi KiraaBook support, I need help with...")}`;
    ch.innerHTML = `
      <a href="mailto:${SUPPORT_EMAIL}" style="text-decoration:none">
        <div class="ctx-tile">
          <div style="font-size:28px;margin-bottom:6px">📧</div>
          <div style="font-weight:700;font-size:12px;color:var(--text)">Email Support</div>
          <div style="font-size:10px;color:var(--gold);margin-top:3px;font-weight:600">${SUPPORT_EMAIL}</div>
        </div>
      </a>
      <a href="${waUrl}" target="_blank" style="text-decoration:none">
        <div class="ctx-tile">
          <div style="font-size:28px;margin-bottom:6px">💬</div>
          <div style="font-weight:700;font-size:12px;color:var(--text)">WhatsApp</div>
          <div style="font-size:10px;color:var(--text3);margin-top:3px">+${SUPPORT_WHATSAPP}</div>
        </div>
      </a>
      <div class="ctx-tile">
        <div style="font-size:28px;margin-bottom:6px">⏱️</div>
        <div style="font-weight:700;font-size:12px;color:var(--text)">Response Time</div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px">Within 24 hours</div>
      </div>
    `;
  }
  document.getElementById("contact-modal").classList.add("open");
  setTimeout(()=>{ document.getElementById("ct-subject")?.focus(); }, 100);
};

// v13.x: Plans / Upgrade modal
window.openPlansModal = ()=>{
  // Set current plan status text
  let info = currentOwnerData;
  let statusHtml = "";
  if(info){
    if(info.plan==="trial" || !info.plan){
      let st = (typeof getTrialStatus==="function") ? getTrialStatus(info) : null;
      let daysLeft = st?.daysLeft ?? "?";
      statusHtml = `🆓 <strong>Current plan:</strong> Free Trial · ${daysLeft} day${daysLeft===1?"":"s"} remaining`;
    } else if(info.plan==="monthly"){
      statusHtml = `💳 <strong>Current plan:</strong> Monthly · auto-renews ${info.subExpiry?"on "+new Date(info.subExpiry).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):""}`;
    } else if(info.plan==="annual"){
      statusHtml = `🌟 <strong>Current plan:</strong> Annual · expires ${info.subExpiry?new Date(info.subExpiry).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}):"–"}`;
    } else if(info.plan==="lifetime"){
      statusHtml = `♾️ <strong>Current plan:</strong> Lifetime · You're all set!`;
    } else {
      statusHtml = `<strong>Current plan:</strong> ${info.plan}`;
    }
  } else {
    statusHtml = "Pick a plan to unlock unlimited tenants:";
  }
  let curEl = document.getElementById("plans-modal-current");
  if(curEl) curEl.innerHTML = statusHtml;
  document.getElementById("plans-modal").classList.add("open");
};

window.goToPaymentLink = (plan)=>{
  let url = PAY_LINKS[plan];
  if(!url){ toast("Payment link not configured","error"); return; }
  // Open Razorpay payment in a new tab
  let w = window.open(url, "_blank", "noopener,noreferrer");
  if(!w){
    // Popup blocked — show fallback
    alert(`Your browser blocked the payment popup. Please open this link manually:\n\n${url}`);
    return;
  }
  toast("💳 Opening payment page in a new tab...","info");
  // Optional: log activity
  try{ logActivity("Plan Upgrade Initiated", `Plan: ${plan}`, currentOwnerData?.name||"Owner"); }catch(e){}
};

// ── RENDER TENANT LIST ────────────────────────────────────────
function renderTenantList(){
  let q=g("search").toLowerCase();
  let list=document.getElementById("tenant-list"); if(!list)return;
  let filt=tenants.filter(t=>{
    let isDeact = t.active===false;
    // Deactivated filter: show ONLY deactivated; all other filters exclude deactivated
    if(currentFilter==="deactivated"){
      if(!isDeact) return false;
    } else {
      if(isDeact) return false;
      if(currentFilter==="paid" && !t.paid) return false;
      if(currentFilter==="unpaid" && t.paid) return false;
      if(currentFilter==="pending" && t.approved) return false;
      if(currentFilter!=="pending" && currentFilter!=="all" && !t.approved) return false;
      if(currentFilter==="all" && !t.approved) return false;
      if(currentFilter==="nopv" && t.pvPhoto) return false;
      if(currentFilter==="overdue" && !isOverdue(t)) return false;
    }
    if(q){
      let blob=(t.name+" "+(t.room||"")+" "+(t.phone||"")+" "+(t.tid||"")+" "+(t.email||"")).toLowerCase();
      if(!blob.includes(q)) return false;
    }
    return true;
  });
  if(!filt.length){
    list.innerHTML=`<div class="empty-state"><div class="empty-icon">🏠</div><div class="empty-text">No tenants found</div></div>`;
    return;
  }
  list.innerHTML=filt.map(t=>{
    let ini=t.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    let av=t.profPhoto?`<img src="${t.profPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/>`:ini;
    let status,sCls;
    if(t.active===false){ status="⛔ Deactivated"; sCls="stat-overdue"; }
    else if(!t.approved){ status="⏳ Pending Approval"; sCls="stat-pending"; }
    else if(isOverdue(t)){ status=`🔴 Overdue (${Math.floor((new Date()-(t.lastPaidDate?new Date(t.lastPaidDate):new Date(t.date||Date.now())))/864e5)}d)`; sCls="stat-overdue"; }
    else if(t.paid){ status="✓ Paid This Month"; sCls="stat-paid"; }
    else { status="⚠️ Unpaid"; sCls="stat-unpaid"; }
    return `<li class="tenant-card">
      <div class="t-avatar">${av}</div>
      <div class="t-info">
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-meta">Room ${esc(t.room||"–")} · ${fmtMoney(t.rent)}</div>
        <div style="font-size:9px;color:var(--text3);font-family:'JetBrains Mono',monospace;margin-top:2px">${esc(t.tid||t.id)}</div>
        <span class="t-status ${sCls}">${status}</span>
      </div>
      <button class="btn btn-primary" style="font-size:11px;padding:8px 14px;align-self:center;white-space:nowrap" onclick="event.stopPropagation();openTenantDetail('${t.id}')">👁 View Details</button>
    </li>`;
  }).join("");
}

function renderAllBills(){
  let list=document.getElementById("all-bills-list");
  let filt=bills.filter(b=>{
    let s=getBillStatus(b);
    if(billFilter==="due"&&s!=="due")return false;
    if(billFilter==="overdue"&&s!=="overdue")return false;
    if(billFilter==="paid"&&b.status!=="paid")return false;
    return true;
  });
  if(!filt.length){ list.innerHTML=`<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">No bills yet</div></div>`; return; }
  filt.sort((a,b)=>new Date(b.dueDate)-new Date(a.dueDate));
  list.innerHTML=filt.map(b=>{
    let s=getBillStatus(b);
    let cls=s==="paid"?"bill-paid":s==="overdue"?"bill-overdue":s==="due"?"bill-due":"";
    return `<div class="bill-card ${cls}">
      <div class="bill-card-head">
        <div><div class="bill-card-name">${esc(b.tenantName)}</div><div style="font-size:10px;color:var(--text3);font-weight:500">${esc(b.monthLabel)}</div></div>
        <div class="bill-card-amt">${fmtMoney(b.total)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px">
        <div style="font-size:11px;font-weight:600;color:var(--text2)">Due: ${fmtDate(b.dueDate)} · ${getDaysText(b)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn pdf-btn" style="font-size:10px;padding:5px 10px" onclick="downloadBillPdf('${b.id}')">⬇️ PDF</button>
          ${b.status!=="paid"?`<button class="btn btn-success" style="font-size:10px;padding:5px 10px" onclick="markBillPaid('${b.id}')">✓ Paid</button>`:`<button class="btn btn-undo" style="font-size:10px;padding:5px 10px" onclick="markBillUnpaid('${b.id}')">↩ Unpaid</button>`}
          <button class="btn btn-danger" style="font-size:10px;padding:5px 10px" onclick="deleteBill('${b.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function updateOwnerStats(){
  // Active (not deactivated) approved tenants
  let activeAppr = tenants.filter(t=>t.approved && t.active!==false);
  let pendApproval = tenants.filter(t=>!t.approved && t.active!==false);

  // Total tenants tile — clickable, shows paid/unpaid breakdown
  let paidCount   = activeAppr.filter(t=>t.paid).length;
  let unpaidCount = activeAppr.filter(t=>!t.paid).length;
  let st=document.getElementById("s-total"); if(st) st.textContent=activeAppr.length;
  let subParts=[];
  if(paidCount)          subParts.push(`${paidCount} paid`);
  if(unpaidCount)        subParts.push(`${unpaidCount} unpaid`);
  if(pendApproval.length) subParts.push(`${pendApproval.length} awaiting`);
  let subEl=document.getElementById("s-total-sub");
  if(subEl) subEl.textContent=subParts.length ? subParts.join(" · ") : "no tenants yet";
  if(st){
    st.style.cursor="pointer";
    st.title="Click to manage tenants";
    st.onclick=()=>jumpToOwnerTab("tenants");
  }
  let stParent=st?.closest(".stat-card");
  if(stParent){ stParent.style.cursor="pointer"; stParent.onclick=()=>jumpToOwnerTab("tenants"); }

  // Pending-approval banner section
  let pSec=document.getElementById("pending-section"), pVal=document.getElementById("pending-count");
  if(pendApproval.length>0){ if(pSec)pSec.style.display="block"; if(pVal)pVal.textContent=pendApproval.length; }
  else { if(pSec)pSec.style.display="none"; }

  // Collected this month + Pending amount
  let now=new Date();
  let curM=now.getMonth(), curY=now.getFullYear();
  let curMonthKey=curY+"-"+(curM+1);
  let collected=0, pendingAmt=0;

  // Track which tenants already have a bill this month (to avoid double-counting below)
  let billedTenantIds=new Set();
  bills.forEach(b=>{
    let amt=Number(b.total||0);
    if(b.status==="paid"){
      // Determine paid date: prefer paidOnIso, then bill's monthKey, then dueDate
      let paidDate=null;
      if(b.paidOnIso){ try{ paidDate=new Date(b.paidOnIso); }catch(e){} }
      if((!paidDate||isNaN(paidDate)) && b.monthKey){
        let [y,m]=b.monthKey.split("-").map(Number);
        if(y && m) paidDate=new Date(y,m-1,15);
      }
      if((!paidDate||isNaN(paidDate)) && b.dueDate){ paidDate=new Date(b.dueDate); }
      if(paidDate && !isNaN(paidDate) && paidDate.getMonth()===curM && paidDate.getFullYear()===curY){
        collected += amt;
      }
    } else {
      // Unpaid bills count toward pending
      pendingAmt += amt;
    }
    // Track every tenant who has ANY bill this month
    if(b.monthKey===curMonthKey && b.tenantId) billedTenantIds.add(b.tenantId);
  });

  // Approved active tenants with NO bill this month → rent is implicitly pending
  // (covers newly added tenants and tenants added after autoCreateMonthlyBills ran)
  activeAppr.forEach(t=>{
    if(!billedTenantIds.has(t.id) && Number(t.rent)>0){
      pendingAmt += Number(t.rent);
    }
  });

  let sc=document.getElementById("s-col"); if(sc) sc.textContent=fmtMoney(collected);
  let sp=document.getElementById("s-pend"); if(sp) sp.textContent=fmtMoney(pendingAmt);

  // Make Collected/Pending tiles clickable (item 4)
  if(sc){ sc.style.cursor="pointer"; sc.title="Click to see collected bills this month"; sc.onclick=()=>openCollectedModal(); }
  if(sp){ sp.style.cursor="pointer"; sp.title="Click to see pending bills"; sp.onclick=()=>openPendingModal(); }
  let scParent=sc?.closest(".stat-card"); if(scParent){ scParent.style.cursor="pointer"; scParent.onclick=()=>openCollectedModal(); }
  let spParent=sp?.closest(".stat-card"); if(spParent){ spParent.style.cursor="pointer"; spParent.onclick=()=>openPendingModal(); }

  // Rooms vacant count — v13 fix: use properties[].rooms[] (room data lives inside properties now)
  // Build per-property occupancy AND total counts so vacant = sum across all properties
  let totalVacant = 0;
  let totalRoomsCount = 0;
  let perPropertyBreakdown = []; // [{name, occupied, vacant, total}]
  (properties||[]).forEach(p=>{
    let propRooms = Array.isArray(p.rooms) ? p.rooms : [];
    let myT = activeAppr.filter(t=>t.propertyId===p.id);
    // Occupied = unique room nums from active tenants of this property
    let occupiedSet = new Set();
    myT.forEach(t=>{ if(t.room) occupiedSet.add(String(t.room).trim()); });
    // Total rooms = property's room list, plus any tenant rooms not yet in that list (defensive)
    let totalSet = new Set();
    propRooms.forEach(r=>{ if(r.roomNum) totalSet.add(String(r.roomNum).trim()); });
    occupiedSet.forEach(r=>totalSet.add(r));
    let vacantHere = 0;
    totalSet.forEach(r=>{ if(!occupiedSet.has(r)) vacantHere++; });
    totalVacant += vacantHere;
    totalRoomsCount += totalSet.size;
    perPropertyBreakdown.push({
      id:p.id, name:p.name||"Untitled",
      occupied:occupiedSet.size,
      vacant:vacantHere,
      total:totalSet.size
    });
  });
  // Tenants without a property (no propertyId): treat each unique tenant.room as occupied of an "Unassigned" bucket
  let unassignedTenants = activeAppr.filter(t=>!t.propertyId);
  if(unassignedTenants.length){
    let occupiedSet = new Set();
    unassignedTenants.forEach(t=>{ if(t.room) occupiedSet.add(String(t.room).trim()); });
    // Also include any rooms in legacy `rooms` collection without propertyId
    let unassignedRoomSet = new Set();
    (rooms||[]).forEach(r=>{ if(r.roomNum && !r.propertyId) unassignedRoomSet.add(String(r.roomNum).trim()); });
    occupiedSet.forEach(r=>unassignedRoomSet.add(r));
    let vacantHere = 0;
    unassignedRoomSet.forEach(r=>{ if(!occupiedSet.has(r)) vacantHere++; });
    totalVacant += vacantHere;
    totalRoomsCount += unassignedRoomSet.size;
    if(unassignedRoomSet.size){
      perPropertyBreakdown.push({
        id:"_unassigned", name:"(No property)",
        occupied:occupiedSet.size,
        vacant:vacantHere,
        total:unassignedRoomSet.size
      });
    }
  }
  // Write totals to the dashboard tile
  let sv=document.getElementById("s-vacant"); if(sv) sv.textContent=totalVacant;
  let svSub=document.getElementById("s-vacant-sub"); if(svSub) svSub.textContent = `of ${totalRoomsCount} total`;
  // Make the Vacant tile clickable to show per-property breakdown
  if(sv){
    sv.style.cursor="pointer";
    sv.title = "Click to see vacant rooms per property";
    sv.onclick = ()=>openVacancyBreakdownModal(perPropertyBreakdown);
  }
  let svParent = sv?.closest(".stat-card");
  if(svParent){
    svParent.style.cursor="pointer";
    svParent.onclick = ()=>openVacancyBreakdownModal(perPropertyBreakdown);
  }
  // Cache breakdown for the modal
  window._vacancyBreakdown = perPropertyBreakdown;
  // v13.x: refresh the pending approvals banner whenever stats change
  try{ renderPendingApprovalsBanner(); }catch(e){ console.warn("pending banner:",e); }
}

// v13.x: PENDING APPROVALS BANNER
async function renderPendingApprovalsBanner(){
  let banner = document.getElementById("pending-approvals-banner");
  if(!banner) return;
  let activeT = tenants.filter(t=>t.active!==false);
  let pendTenants = activeT.filter(t=>!t.approved).length;
  // Pending payment claims for my tenants
  let myTenantIds = new Set(activeT.map(t=>t.id));
  let pendClaims = 0;
  try{
    let allClaims = await fbGet("paymentClaims");
    pendClaims = allClaims.filter(c=>c.status==="pending" && myTenantIds.has(c.tenantId)).length;
  }catch(e){}
  // Pending vacate notices
  let pendVacate = 0;
  try{
    let allVacate = await fbGet("vacantNotices");
    pendVacate = allVacate.filter(v=>v.status!=="approved" && v.status!=="resolved" && myTenantIds.has(v.tenantId)).length;
  }catch(e){}
  // Open maintenance tickets
  let openMaint = (typeof tickets!=="undefined" && Array.isArray(tickets))
    ? tickets.filter(tk=>tk.status==="open" || tk.status==="in_progress").length
    : 0;

  let total = pendTenants + pendClaims + pendVacate + openMaint;
  if(!total){ banner.style.display="none"; return; }

  let chip = (count, label, color, icon, action)=>{
    if(!count) return "";
    return `<div onclick="${action}" style="background:var(--s2);border:1px solid ${color};border-radius:99px;padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:${color};transition:all .15s" onmouseover="this.style.background='var(--s3)';this.style.transform='translateY(-1px)'" onmouseout="this.style.background='var(--s2)';this.style.transform=''">
      <span style="font-size:14px">${icon}</span>
      <span><strong>${count}</strong> ${esc(label)}</span>
      <span style="opacity:.6">›</span>
    </div>`;
  };

  banner.style.display = "block";
  banner.innerHTML = `<div style="background:linear-gradient(135deg,rgba(245,166,35,.12),rgba(59,130,246,.08));border:1px solid rgba(245,166,35,.4);border-radius:var(--r);padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-weight:800;font-size:13px;color:var(--gold)">⚡ Pending Approvals &amp; Actions <span style="background:var(--red);color:#fff;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;margin-left:6px">${total}</span></div>
      <div style="font-size:10px;color:var(--text3);font-weight:500">Tap any item to jump to it</div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${chip(pendTenants, "tenant"+(pendTenants===1?"":"s")+" awaiting approval", "var(--blue)", "🆕", "jumpToOwnerTabAndFilter('tenants','pending')")}
      ${chip(pendClaims, "payment claim"+(pendClaims===1?"":"s")+" to verify", "var(--green)", "💰", "jumpToOwnerTab('tenants')")}
      ${chip(pendVacate, "vacate notice"+(pendVacate===1?"":"s"), "var(--cyan)", "📦", "scrollToVacateNotices()")}
      ${chip(openMaint, "open maintenance ticket"+(openMaint===1?"":"s"), "var(--orange)", "🔧", "jumpToOwnerTab('maintenance')")}
    </div>
  </div>`;
}

window.jumpToOwnerTabAndFilter = (tabKey, filterKey)=>{
  if(typeof window.jumpToOwnerTab==="function") window.jumpToOwnerTab(tabKey);
  // After tab switch, click the filter chip
  setTimeout(()=>{
    let btns = document.querySelectorAll(".f-tab");
    for(let b of btns){
      let inline = b.getAttribute("onclick")||"";
      if(inline.includes(`'${filterKey}'`)){ b.click(); break; }
    }
  }, 200);
};

window.scrollToVacateNotices = ()=>{
  let el = document.getElementById("vacant-notices-section");
  if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
};

// ── ACCOUNT TAB ───────────────────────────────────────────────
