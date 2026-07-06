import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, PAY_LINKS, PLAN_CATALOG, LIFETIME_PLAN, payLink, collection, onSnapshot, serverTimestamp } from './firebase.js';

// Max tenants allowed for a given plan id (trial=3; legacy monthly/annual and
// lifetime = unlimited; catalog tiers use their configured cap).
function getPlanCap(plan){
  if(!plan || plan==="trial") return 3;
  if(plan==="monthly" || plan==="annual" || plan==="lifetime" || plan==="unlimited") return Infinity;
  let t=PLAN_CATALOG.find(p=>p.id===plan);
  return t ? t.cap : Infinity;
}
window.getPlanCap = getPlanCap;
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, genUID, esc, escAttr, daysBetween, closeModal, unitNoun } from './helpers.js';

// Normalize monthKey to "YYYY-M" (no leading zero) so "2026-06" and "2026-6" compare equal
function normMK(mk){ if(!mk) return ""; let [y,m]=mk.split("-"); return y+"-"+parseInt(m,10); }

// Build bill items array from tenant's configured monthly charges
function buildBillItems(t){
  let items=[];
  if(Number(t.rent)>0)        items.push({name:"Rent",        amount:Number(t.rent)});
  if(Number(t.maintenance)>0) items.push({name:"Maintenance", amount:Number(t.maintenance)});
  (t.otherCharges||[]).forEach(c=>{ if(c.name&&Number(c.amount)>0) items.push({name:c.name,amount:Number(c.amount)}); });
  return items;
}

// Returns the bill due date for a tenant given a billing-month reference date.
// If owner set t.dueDay (1–28), use that day in the reference month.
// pickNext=true: if that day has already passed, return next month's date (for new tenant on-add bills).
// Falls back to 1-day-before move-in anniversary when dueDay not set.
function calcTenantDueDate(t, refDate, pickNext=false){
  let now = refDate || new Date();
  let day = Number(t.dueDay);
  if(day >= 1 && day <= 28){
    let thisMonthDue = new Date(now.getFullYear(), now.getMonth(), day);
    if(pickNext && thisMonthDue <= now){
      return new Date(now.getFullYear(), now.getMonth()+1, day);
    }
    return thisMonthDue;
  }
  let moveIn = new Date(t.date || now);
  let ref2 = t.lastPaidDate ? new Date(t.lastPaidDate) : moveIn;
  let nextAnniv = new Date(ref2.getFullYear(), ref2.getMonth()+1, moveIn.getDate());
  return new Date(nextAnniv - 864e5);
}

// Month-accurate due date for a specific billing month (used by backfill billing).
// dueDay set → that day of the bill month; else 1 day before move-in-day of the next month.
function calcBillDueForMonth(t, billMonthDate){
  let day = Number(t.dueDay);
  if(day >= 1 && day <= 28){
    return new Date(billMonthDate.getFullYear(), billMonthDate.getMonth(), day);
  }
  let moveIn = new Date(t.date || billMonthDate);
  let nextAnniv = new Date(billMonthDate.getFullYear(), billMonthDate.getMonth()+1, moveIn.getDate());
  return new Date(nextAnniv - 864e5);
}

// Add a dynamic charge row to the Add/Edit Tenant form
window.addOtherChargeRow=(name="",amount="")=>{
  let container=document.getElementById("ot-other-charges"); if(!container) return;
  let row=document.createElement("div");
  row.className="frow"; row.style.alignItems="center"; row.style.marginBottom="6px";
  row.innerHTML=`<div style="flex:2"><input class="oc-name" placeholder="Charge name (e.g. Water, Parking)" value="${esc(name)}" style="margin:0"/></div><div style="flex:1"><input class="oc-amount" type="number" placeholder="Amount" value="${amount}" min="0" style="margin:0"/></div><button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--red);font-size:18px;cursor:pointer;padding:0 8px;flex-shrink:0">✕</button>`;
  container.appendChild(row);
};

// Read other charges from the dynamic rows
function getOtherCharges(){
  let charges=[];
  document.querySelectorAll("#ot-other-charges .frow").forEach(row=>{
    let name=(row.querySelector(".oc-name")?.value||"").trim();
    let amount=parseFloat(row.querySelector(".oc-amount")?.value)||0;
    if(name&&amount>0) charges.push({name,amount});
  });
  return charges;
}

// ── BILL FILTER (called from Firestore snapshot callbacks) ───────────────────
function refreshBillsForOwner(ownerID){
  let raw = window._rawBills || [];
  let myTenantIds = new Set((tenants||[]).map(t=>t.id));
  bills = raw.filter(b=>{
    if(b.ownerID) return b.ownerID===ownerID;
    return b.tenantId && myTenantIds.has(b.tenantId);
  });
  try{ updateOwnerStats(); }catch(e){}
  try{ renderRemindersSection(); }catch(e){}
  try{ renderManualBillingReminder(); }catch(e){}
  try{ renderAllBills(); }catch(e){}
  try{ renderTenantList(); }catch(e){}   // cards show bill-based dues → refresh on bill changes
}

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
      <div class="trial-banner-body">You can no longer add tenants or create bills. Pick a plan that fits your tenant count to keep using KiraaBook.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-gold" onclick="openPlansModal()" style="flex:1">🚀 View Plans &amp; Pricing</button>
      </div>
    </div>`;
  } else if(st.daysLeft<=7){
    wrap.innerHTML=`<div class="trial-banner warn">
      <div class="trial-banner-head">⚠️ Trial Ending in ${st.daysLeft} day${st.daysLeft===1?"":"s"}</div>
      <div class="trial-banner-body">Your free trial ends on ${fmtDate(currentOwnerData.subExpiry)}. Upgrade now to keep your account active — plans start at just ₹99/mo.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-gold" onclick="openPlansModal()" style="flex:1">🚀 See Plans (from ₹99/mo)</button>
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
  if(st.expired){ toast("⛔ Free trial expired. Please upgrade to add tenants.","error"); openPlansModal(); return false; }
  let cap=getPlanCap(currentOwnerData.plan);
  let activeCount=(tenants||[]).filter(t=>t.active!==false).length;
  if(activeCount>=cap){
    toast(`⛔ Plan limit reached (${cap} tenants). Upgrade to a higher tier to add more.`,"error");
    openPlansModal();
    return false;
  }
  return true;
}

function renderTenantLimitWarn(){
  let el=document.getElementById("tenant-limit-warn");
  if(!el||!currentOwnerData) return;
  let cap=getPlanCap(currentOwnerData.plan);
  let activeCount=(tenants||[]).filter(t=>t.active!==false).length;
  let atCap = activeCount>=cap;
  let capLabel = cap===Infinity ? "unlimited" : cap;
  if(atCap){
    el.style.display="block";
    el.innerHTML=`⚠️ <strong>Plan limit reached:</strong> You have ${activeCount} of ${capLabel} tenants on your current plan. Upgrade to a higher tier to add more. <a href="javascript:void(0)" onclick="openPlansModal()" style="color:var(--blue);font-weight:700">See plans →</a>`;
  } else { el.style.display="none"; }
  // Disable add-tenant button if at cap or expired
  let btn=document.getElementById("add-tenant-btn");
  let info=document.getElementById("add-tenant-info");
  let st=checkTrialStatus(currentOwnerData);
  if(btn){
    if(st.expired||atCap){
      btn.disabled=true;
      btn.style.opacity=".5";
      btn.style.cursor="not-allowed";
      if(info) info.innerHTML=`⛔ ${st.expired?"Trial expired":`Plan limit reached (${capLabel} tenants)`}. <a href="javascript:void(0)" onclick="openPlansModal()" style="color:var(--blue);font-weight:700">Upgrade to add more →</a>`;
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
  let sel=document.getElementById("set-currency"); if(sel) sel.value=localStorage.getItem("kb_currency")||"₹";
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
    try{ renderFormerTenants(); }catch(e){}
    renderOverdueAlerts(); renderVacantNotices();
    renderTenantLimitWarn(); renderRemindersSection();
    try{ renderManualBillingReminder(); }catch(e){}
    // Keep Properties & Rooms tab in sync — tenant occupancy affects room status there
    try{ window.renderProperties && window.renderProperties(); }catch(e){}
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

  // Start properties subscription immediately so Properties tab shows data without needing a tab click
  if(typeof window.subscribeProperties==="function") window.subscribeProperties(ownerID);

  // Recheck trial status every 5 minutes so expiry reflects while app is open
  if(window._trialCheckTimer) clearInterval(window._trialCheckTimer);
  window._trialCheckTimer = setInterval(()=>{ if(currentOwnerData) renderTrialBanner(); }, 5*60*1000);
}

async function autoCreateMonthlyBills(){
  let now=new Date();
  let monthKey=now.getFullYear()+"-"+(now.getMonth()+1);
  let ownerID=localStorage.getItem("kb_owner_id");
  let lastRun=localStorage.getItem("kb_auto_month_"+ownerID);
  if(lastRun===monthKey) return;
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired) return;
  let autoTenants=tenants.filter(t=>t.approved&&t.rent&&t.billMode==="auto");
  let billsCreated=[];
  let nowMonthStart=new Date(now.getFullYear(),now.getMonth(),1);
  // Backfill window: don't generate bills older than 6 months back, so long-standing
  // tenants don't suddenly get a flood of historic bills on first run after deploy.
  let earliestAllowed=new Date(now.getFullYear(),now.getMonth()-5,1);
  for(let t of autoTenants){
    let moveIn=t.date?new Date(t.date):new Date(now);
    let moveInMonthStart=new Date(moveIn.getFullYear(),moveIn.getMonth(),1);
    // Start from move-in month (or the 6-month cap, whichever is later)
    let cursor = moveInMonthStart>earliestAllowed ? moveInMonthStart : earliestAllowed;
    let guard=0, latestNew=null;
    // Walk month-by-month up to the current month, creating any missing bill.
    // This guarantees an unpaid tenant accumulates one bill per missed month, so the
    // owner Pending tile and the tenant Dues tile both reflect every unpaid month.
    while(cursor<=nowMonthStart && guard<12){
      guard++;
      let mKey=cursor.getFullYear()+"-"+(cursor.getMonth()+1);
      let exists=bills.find(b=>b.tenantId===t.id&&normMK(b.monthKey)===normMK(mKey));
      if(!exists){
        let due=calcBillDueForMonth(t,cursor);
        let items=buildBillItems(t);
        let total=items.reduce((s,i)=>s+Number(i.amount),0);
        let mLabel=cursor.toLocaleString("default",{month:"long",year:"numeric"});
        await fbAdd("bills",{
          tenantId:t.id, tenantName:t.name, tenantPhone:t.phone||"",
          ownerID, monthKey:mKey, monthLabel:mLabel,
          dueDate:due.toISOString().split("T")[0],
          items, total,
          status:"pending",
          createdOn:now.toLocaleDateString("en-IN"),
          autoCreated:true, lastReminded:null
        });
        latestNew={month:mLabel,total,dueDate:due.toISOString().split("T")[0]};
        billsCreated.push(t.name+" — "+mLabel);
      }
      cursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1);
    }
    // Notify tenant once, about the most recent new bill (avoid alert spam on backfill)
    if(latestNew){
      try{ await fbUpdate("tenants",t.id,{newBillAlert:{...latestNew,createdOn:now.toISOString()}}); }catch(e){}
    }
  }
  localStorage.setItem("kb_auto_month_"+ownerID,monthKey);
  // Notify owner
  if(billsCreated.length){
    toast(`📋 Auto-billing: ${billsCreated.length} bill${billsCreated.length>1?"s":""} generated (incl. any missed months)!`,"info");
    try{ await logActivity("Auto Bills Generated",`${billsCreated.length} bills: ${billsCreated.join(", ")}`,"Owner"); }catch(e){}
  }
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
    let t=tenants.find(x=>x.id===b.tenantId);
    if(!t||!t.phone) return;
    if(t.active===false || !t.approved) return;   // skip vacated/unapproved tenants
    let due=effectiveBillDue(b);                    // per-month correct due date
    if(!due) return;
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
  // Bills are the source of truth: check them FIRST, before the coarse t.paid flag.
  // (t.paid only tracks the current month, so paying this month must NOT hide an
  //  older unpaid/overdue bill — e.g. a tenant who is 2 months behind.)
  let myUnpaidBills=(bills||[]).filter(b=>b.tenantId===t.id&&b.status!=="paid");
  if(myUnpaidBills.length) return myUnpaidBills.some(b=>getBillStatus(b)==="overdue");
  if(t.paid) return false;
  if(!t.date) return false;
  // No bills yet: fall back to owner-set dueDay or move-in anniversary calculation
  let now=new Date(); now.setHours(0,0,0,0);
  let due=calcTenantDueDate(t,now); due.setHours(0,0,0,0);
  return now>=due;
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

// ── TENANT OFFBOARDING (LEFT / FORMER TENANTS) ────────────────
function renderStars(n){ n=Math.max(0,Math.min(5,Math.round(n||0))); return "★".repeat(n)+"☆".repeat(5-n); }

// Auto payment-conduct rating from the tenant's bill history (1–5; 0 = no data)
function computeTenantRating(t){
  let mine=(bills||[]).filter(b=>b.tenantId===t.id);
  if(!mine.length) return {stars:0,onTime:0,late:0,unpaidCount:0,outstanding:0,hasData:false};
  let onTime=0, late=0;
  mine.filter(b=>b.status==="paid").forEach(b=>{
    let due=b.dueDate?new Date(b.dueDate):null, paid=b.paidOnIso?new Date(b.paidOnIso):null;
    if(due&&paid){ if(paid.getTime() <= due.getTime()+3*864e5) onTime++; else late++; } else onTime++;
  });
  let unpaid=mine.filter(b=>b.status!=="paid" && b.status!=="writtenoff");
  let outstanding=unpaid.reduce((s,b)=>s+Number(b.total||0),0);
  let totalPaid=onTime+late;
  let score=(totalPaid?onTime/totalPaid:1)*5;
  if(unpaid.length) score -= Math.min(2.5, 0.5+unpaid.length*0.6);   // penalty for leaving dues
  return {stars:Math.max(1,Math.min(5,Math.round(score))), onTime, late, unpaidCount:unpaid.length, outstanding, hasData:true};
}
function tenantOutstanding(t){
  return (bills||[]).filter(b=>b.tenantId===t.id && b.status!=="paid" && b.status!=="writtenoff").reduce((s,b)=>s+Number(b.total||0),0);
}

// Write off a former tenant's remaining dues (e.g. unrecoverable). Marks their
// unpaid bills "writtenoff" so they stop counting as unrecovered, without
// inflating Collected (no payment date is set).
window.writeOffDues=async(id)=>{
  let t=(tenants||[]).find(x=>x.id===id) || await fbGetDoc("tenants",id);
  if(!t){ toast("Tenant not found","error"); return; }
  let unpaid=(bills||[]).filter(b=>b.tenantId===id && b.status!=="paid" && b.status!=="writtenoff");
  let amt=unpaid.reduce((s,b)=>s+Number(b.total||0),0);
  if(!unpaid.length){ toast("No outstanding dues to write off","info"); return; }
  if(!confirm(`Write off ${fmtMoney(amt)} in unpaid dues for ${t.name}?\n\nThis marks ${unpaid.length} bill(s) as written off (not collected). It cannot be undone easily.`)) return;
  let nowIso=new Date().toISOString();
  for(let b of unpaid){ try{ await fbUpdate("bills",b.id,{status:"writtenoff", writtenOffOn:nowIso}); }catch(e){} }
  try{ await fbUpdate("tenants",id,{exitOutstanding:0}); }catch(e){}
  await logActivity("Dues Written Off",`Name: ${t.name}, Amount: ${fmtMoney(amt)}, Bills: ${unpaid.length}`,"Owner");
  toast(`✍️ Wrote off ${fmtMoney(amt)} for ${t.name}`);
  try{ renderFormerTenants(); }catch(e){}
};

let _leftRating=0;
window.openLeftModal=async(id)=>{
  let t=(tenants||[]).find(x=>x.id===id) || await fbGetDoc("tenants",id);
  if(!t){ toast("Tenant not found","error"); return; }
  window._leftTenantId=id;
  let auto=computeTenantRating(t), outstanding=tenantOutstanding(t);
  _leftRating = t.ownerRating || auto.stars || 0;
  sv("left-date", t.leftOn || new Date().toISOString().split("T")[0]);
  sv("left-note", t.exitNote||"");
  let bl=document.getElementById("left-blacklist"); if(bl) bl.checked=!!t.blacklisted;
  document.getElementById("left-tenant-name").textContent=t.name||"—";
  document.getElementById("left-auto-rating").innerHTML = auto.hasData
    ? `<span style="color:var(--gold)">${renderStars(auto.stars)}</span> <span style="color:var(--text3);font-size:9px">${auto.onTime} on-time · ${auto.late} late${auto.unpaidCount?` · ${auto.unpaidCount} unpaid`:""}</span>`
    : `<span style="color:var(--text3)">No payment history</span>`;
  document.getElementById("left-outstanding").innerHTML = outstanding>0
    ? `<span style="color:var(--red);font-weight:800">${fmtMoney(outstanding)} pending</span>`
    : `<span style="color:var(--green);font-weight:700">No dues 🎉</span>`;
  renderLeftStars();
  closeModal("tenant-detail-modal");
  document.getElementById("left-modal").classList.add("open");
};
window.setLeftRating=(n)=>{ _leftRating=n; renderLeftStars(); };
function renderLeftStars(){
  let el=document.getElementById("left-rating-stars"); if(!el) return;
  el.innerHTML=[1,2,3,4,5].map(i=>`<span onclick="setLeftRating(${i})" style="cursor:pointer;font-size:26px;line-height:1;color:${i<=_leftRating?'var(--gold)':'var(--border2)'}">★</span>`).join("");
}
window.confirmTenantLeft=async()=>{
  let id=window._leftTenantId; if(!id){ return; }
  let t=(tenants||[]).find(x=>x.id===id) || await fbGetDoc("tenants",id);
  let leftOn=g("left-date")||new Date().toISOString().split("T")[0];
  let note=g("left-note");
  let blacklisted=!!(document.getElementById("left-blacklist")?.checked);
  let outstanding=tenantOutstanding(t), auto=computeTenantRating(t);
  await fbUpdate("tenants",id,{
    active:false, approved:false,
    leftOn, exitNote:note, blacklisted,
    ownerRating: _leftRating||auto.stars||0,
    exitAutoRating: auto.stars||0,
    exitOutstanding: outstanding
  });
  try{ if(t && t.ownerID) await closeRoomHistoryEntry(id, t.ownerID, "Tenant left"); }catch(e){}
  await logActivity("Tenant Marked as Left",`Name: ${t.name}, Rating: ${_leftRating||auto.stars}, Blacklisted: ${blacklisted}, Outstanding: ${fmtMoney(outstanding)}`,"Owner");
  closeModal("left-modal");
  toast(`🚪 ${t.name} moved to Former Tenants`);
  try{ renderFormerTenants(); }catch(e){}
};
window.toggleBlacklist=async(id,val)=>{
  let on = (val===true||val==="true");
  await fbUpdate("tenants",id,{blacklisted:on});
  toast(on?"⛔ Tenant blacklisted":"✓ Removed from blacklist");
  await logActivity(on?"Tenant Blacklisted":"Tenant Un-blacklisted",`ID: ${id}`,"Owner");
  try{ renderFormerTenants(); }catch(e){}
};

function renderFormerTenants(){
  let list=document.getElementById("former-list"); if(!list) return;
  let q=(g("former-search")||"").toLowerCase();
  let former=(tenants||[]).filter(t=>t.active===false);
  if(q) former=former.filter(t=>((t.name||"")+" "+(t.room||"")+" "+(t.phone||"")).toLowerCase().includes(q));
  former.sort((a,b)=> new Date(b.leftOn||b.submittedOn||0)-new Date(a.leftOn||a.submittedOn||0));

  let sEl=document.getElementById("former-summary");
  if(sEl){
    let blk=former.filter(t=>t.blacklisted).length;
    let owed=former.reduce((s,t)=>s+(t.exitOutstanding!=null?Number(t.exitOutstanding):tenantOutstanding(t)),0);
    sEl.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div class="mtile" style="border-left:3px solid var(--text3)"><div class="mtile-val">${former.length}</div><div class="mtile-lbl">🚪 Former tenants</div></div>
      <div class="mtile" style="border-left:3px solid var(--red)"><div class="mtile-val">${blk}</div><div class="mtile-lbl">⛔ Blacklisted</div></div>
      <div class="mtile" style="border-left:3px solid var(--orange)"><div class="mtile-val">${fmtMoney(owed)}</div><div class="mtile-lbl">💸 Unrecovered dues</div></div>
    </div>`;
  }
  if(!former.length){ list.innerHTML=`<div class="empty-state"><div class="empty-icon">🚪</div><div class="empty-text">No former tenants yet</div></div>`; return; }

  list.innerHTML=former.map(t=>{
    let rating = t.ownerRating || t.exitAutoRating || computeTenantRating(t).stars || 0;
    let outstanding = (t.exitOutstanding!=null ? Number(t.exitOutstanding) : tenantOutstanding(t));
    let left = t.leftOn?fmtDate(t.leftOn):"—";
    let ini=(t.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    let av=t.profPhoto?`<img src="${t.profPhoto}"/>`:ini;
    let blBadge = t.blacklisted?`<span style="background:var(--red);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap">⛔ Blacklisted</span>`:"";
    let dueBadge = outstanding>0
      ? `<span style="background:var(--orange);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap">${fmtMoney(outstanding)} unpaid</span>`
      : `<span style="background:var(--green);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap">✓ Cleared</span>`;
    return `<div class="t-card ${t.blacklisted?'overdue':''}" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="t-avatar">${av}</div>
        <div class="t-info">
          <div class="t-name">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--text3);font-weight:500;margin-top:1px">Room ${esc(t.room||"–")} · left ${left}</div>
          ${rating>0
            ? `<div style="font-size:14px;color:var(--gold);margin-top:2px;letter-spacing:1px" title="Payment conduct rating">${renderStars(rating)}</div>`
            : `<div style="font-size:10px;color:var(--text3);margin-top:2px">Not rated</div>`}
        </div>
        <div style="flex-shrink:0;text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end">${dueBadge}${blBadge}</div>
      </div>
      ${t.exitNote?`<div style="font-size:11px;color:var(--text2);background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:7px 9px;margin-top:8px">📝 ${esc(t.exitNote)}</div>`:""}
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:9px">
        <button class="btn btn-ghost" style="font-size:10px;padding:5px 10px" onclick="openLeftModal('${t.id}')">✏️ Edit exit info</button>
        <button class="btn ${t.blacklisted?'btn-success':'btn-danger'}" style="font-size:10px;padding:5px 10px" onclick="toggleBlacklist('${t.id}',${t.blacklisted?'false':'true'})">${t.blacklisted?'✓ Un-blacklist':'⛔ Blacklist'}</button>
        ${outstanding>0?`<button class="btn btn-warn" style="font-size:10px;padding:5px 10px" onclick="writeOffDues('${t.id}')">✍️ Write off dues</button>`:""}
        <button class="btn btn-success" style="font-size:10px;padding:5px 10px" onclick="reactivateTenant('${t.id}','${escAttr(t.name)}')">▶ Re-activate</button>
        <button class="btn btn-warn" style="font-size:10px;padding:5px 10px" onclick="openTenantDetail('${t.id}','general')">👁 Details</button>
      </div>
    </div>`;
  }).join("");
}
window.renderFormerTenants=renderFormerTenants;

window.markPaid=async(id,rent)=>{
  let now=new Date();
  let t=tenants.find(x=>x.id===id);
  let hist=(t?.history||[]);
  let monthStr = now.toLocaleString("default",{month:"long",year:"numeric"});
  let monthKey = now.getFullYear()+"-"+(now.getMonth()+1);
  hist.unshift({month:monthStr,date:now.toLocaleDateString("en-IN"),amount:rent});
  await fbUpdate("tenants",id,{paid:true,history:hist,lastPaidDate:now.toISOString().split("T")[0]});

  // v13.x SYNC FIX: also sync the bills collection so the dashboard Collected/Pending
  // tiles stay in sync with the "Paid This Month" status shown on tenant cards.
  try{
    let ownerID = t?.ownerID || localStorage.getItem("kb_owner_id");
    // Find an existing bill for this tenant + current month (normalize to handle "2026-06" vs "2026-6")
    let allBills = window._rawBills || bills || [];
    let existing = allBills.find(b=>b.tenantId===id && normMK(b.monthKey)===normMK(monthKey));
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
        items:[{name:"Rent", amount:Number(rent||0)}],
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
    let monthKey = now.getFullYear()+"-"+(now.getMonth()+1);
    let allBills = window._rawBills || bills || [];
    let existing = allBills.find(b=>b.tenantId===id && normMK(b.monthKey)===normMK(monthKey) && b.status==="paid");
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
window.openTenantDetail=(id, mode="general")=>{
  let t=tenants.find(x=>x.id===id);
  if(!t) return;
  let ini=t.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  let avH=t.profPhoto?`<img src="${t.profPhoto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 10px;display:block;"/>`
    :`<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--gold));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#111;margin:0 auto 10px">${ini}</div>`;
  let msg=`Dear ${t.name}, your rent of ${fmtMoney(t.rent)} is due. -KiraaBook`;
  let wa=t.phone?`https://wa.me/${t.phone.replace(/[^0-9]/g,"")}?text=${encodeURIComponent(msg)}`:"";

  if(mode==="bills"){
    // Show unpaid bills for this tenant
    let unpaidBills=bills.filter(b=>b.tenantId===t.id&&b.status!=="paid");
    unpaidBills.sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
    let billsHtml=unpaidBills.length?unpaidBills.map(b=>{
      let s=getBillStatus(b);
      let accentColor=s==="overdue"?"var(--red)":"var(--gold)";
      let itemRows=(b.items||[]).length>1
        ?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">${(b.items||[]).map(i=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:var(--text3)">${esc(i.name||i.label||"")}</span><span style="font-weight:600">${fmtMoney(i.amount)}</span></div>`).join("")}</div>`
        :"";
      return `<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div style="font-weight:700;font-size:13px">${esc(b.monthLabel)}</div>
            <div style="font-size:11px;color:var(--text3);margin-top:3px">Due: ${fmtDate(b.dueDate)}</div>
            <div style="font-size:11px;font-weight:700;color:${accentColor};margin-top:2px">${getDaysText(b)}</div>
          </div>
          <div style="font-size:20px;font-weight:800;color:${accentColor};flex-shrink:0">${fmtMoney(b.total)}</div>
        </div>
        ${itemRows}
        <button class="btn btn-success" style="width:100%;margin-top:10px;font-size:12px" onclick="markBillPaid('${b.id}');closeModal('tenant-detail-modal')">✓ Mark Paid</button>
      </div>`;
    }).join("")
    :`<div class="empty-state" style="padding:20px 0"><div class="empty-icon">✅</div><div class="empty-text">No unpaid bills</div></div>`;

    document.getElementById("tenant-detail-content").innerHTML=`
      <div style="text-align:center;margin-bottom:16px">${avH}
        <div style="font-size:18px;font-weight:800">${esc(t.name)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:4px">Room ${esc(t.room||"–")} · ${fmtMoney(t.rent)}/mo · ${esc(t.phone||"–")}</div>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:10px">📋 Unpaid Bills (${unpaidBills.length})</div>
      ${billsHtml}
    `;
    document.getElementById("tenant-detail-actions").innerHTML=`
      <button class="btn btn-edit" onclick="openOwnerEditTenant('${id}');closeModal('tenant-detail-modal')">✏️ Edit Details</button>
      ${wa?`<a class="btn btn-warn" href="${wa}" target="_blank">💬 WhatsApp Reminder</a>`:""}
    `;
    document.getElementById("tenant-detail-modal").classList.add("open");
    return;
  }

  // ── General / default view ─────────────────────────────────
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
  let activeFlag = t.active!==false;
  document.getElementById("tenant-detail-actions").innerHTML=`
    <button class="btn btn-edit" onclick="openOwnerEditTenant('${id}');closeModal('tenant-detail-modal')">✏️ Edit Details</button>
    <button class="btn btn-gold" onclick="openRentAgreementBuilder('${id}')">📄 Rent Agreement</button>
    ${!t.approved?`<button class="btn btn-approve" onclick="approveTenant('${id}');closeModal('tenant-detail-modal')">✓ Approve</button>`:""}
    ${t.approved&&!t.paid?`<button class="btn btn-success" onclick="markPaid('${id}','${t.rent}');closeModal('tenant-detail-modal')">✓ Mark Paid</button>`:""}
    ${t.approved&&t.paid?`<button class="btn btn-undo" onclick="markUnpaid('${id}');closeModal('tenant-detail-modal')">↩ Unpaid</button>`:""}
    ${wa?`<a class="btn btn-warn" href="${wa}" target="_blank">💬 WhatsApp</a>`:""}
    ${activeFlag ? `<button class="btn btn-warn" onclick="openLeftModal('${id}')">🚪 Mark as Left</button>` : `<button class="btn btn-success" onclick="reactivateTenant('${id}','${escAttr(t.name)}');closeModal('tenant-detail-modal')">▶ Reactivate</button>`}
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
  // Warn if this person was previously blacklisted (match by phone digits or name)
  let phoneDigits=(phone||"").replace(/[^0-9]/g,"");
  let prior=(tenants||[]).find(x=>x.active===false && x.blacklisted && (
    (phoneDigits && String(x.phone||"").replace(/[^0-9]/g,"")===phoneDigits) ||
    (x.name||"").trim().toLowerCase()===name.trim().toLowerCase()
  ));
  if(prior && !confirm(`⚠️ BLACKLISTED TENANT\n\n"${prior.name}" was previously blacklisted${prior.exitNote?`:\n\n"${prior.exitNote}"`:"."}\n\nDo you still want to add them?`)) return;
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
    maintenance:Number(g("ot-maintenance"))||0,
    otherCharges:getOtherCharges(),
    dueDay:Number(g("ot-dueday"))||null,
    billMode:g("ot-billmode")||"auto",
    profPhoto:"", idPhoto:"", pvPhoto:"",
    paid:false, history:[], approved:true, active:true,
    ownerID, submittedOn:new Date().toLocaleDateString("en-IN"),
    lastPaidDate:null, addedByOwner:true,
    password:defaultPass,
    needsProfileCompletion:true
  };
  let ref;
  try{
    ref=await fbAdd("tenants",obj);
  }catch(e){ toast("❌ Failed to save tenant: "+(e.message||e),"error"); return; }
  await recordRoomHistoryEntry(ref.id, name, room, rent, ownerID, obj.date);

  // Create current-month bill immediately so the tenant's rent appears in
  // Pending right away — autoCreateMonthlyBills only runs once per month
  // and would miss tenants added after it already executed.
  if(Number(rent)>0){
    let now2=new Date();
    let mKey=now2.getFullYear()+"-"+(now2.getMonth()+1);
    // Due = owner-set dueDay (picking next month if already past) or move-in anniversary
    let due2=calcTenantDueDate(obj,now2,true);
    let mLabel=now2.toLocaleString("default",{month:"long",year:"numeric"});
    let alreadyExists=bills.find(b=>b.tenantId===ref.id&&normMK(b.monthKey)===normMK(mKey));
    if(!alreadyExists){
      let items2=buildBillItems(obj);
      let total2=items2.reduce((s,i)=>s+Number(i.amount),0);
      await fbAdd("bills",{
        tenantId:ref.id, tenantName:name, tenantPhone:phone,
        ownerID, monthKey:mKey, monthLabel:mLabel,
        dueDate:due2.toISOString().split("T")[0],
        items:items2, total:total2,
        status:"pending",
        createdOn:now2.toLocaleDateString("en-IN"),
        autoCreated:true, lastReminded:null
      });
    }
  }

  ["ot-name","ot-room","ot-rent","ot-maintenance","ot-dueday","ot-phone","ot-alt","ot-email","ot-address","ot-idtype","ot-idnum","ot-date","ot-notes","ot-security","ot-advance","ot-property"].forEach(i=>sv(i,""));
  let oc=document.getElementById("ot-other-charges"); if(oc) oc.innerHTML="";
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
  // Merge rooms from the Properties system so both views stay in sync (issue #10)
  (properties||[]).forEach(p=>{
    (p.rooms||[]).forEach(r=>{
      let key=String(r.roomNum).trim();
      if(!allRooms.find(x=>String(x.roomNum).trim()===key)){
        allRooms.push({id:"prop-"+p.id+"-"+r.roomNum, roomNum:r.roomNum, floor:r.floor||"", notes:r.notes||"", propertyId:p.id, propertyName:p.name||""});
      }
    });
  });
  tenants.filter(t=>t.approved&&t.room).forEach(t=>{
    if(!allRooms.find(r=>String(r.roomNum).trim()===String(t.room).trim())) allRooms.push({id:"auto-"+t.id,roomNum:t.room,occupied:true,tenantName:t.name});
  });
  let occCount=0,vacCount=0;
  allRooms.forEach(r=>{
    let t=tenants.find(t2=>t2.room===r.roomNum&&t2.approved);
    r.occupied=!!t; r.tenantName=t?.name||"";
    if(r.occupied)occCount++; else vacCount++;
  });
  // occ-count and vac-count are inside the legacy Rooms tab panel — safe to update here.
  // s-vacant is the DASHBOARD TILE and is owned by updateOwnerStats() (properties-based).
  // Writing to it here would overwrite the correct properties-based count every time the
  // rooms Firestore collection fires, which is the root cause of the wrong tile number.
  let oe=document.getElementById("occ-count"),vc=document.getElementById("vac-count");
  if(oe)oe.textContent=occCount; if(vc)vc.textContent=vacCount;
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

// ── MANUAL BILLING REMINDER ───────────────────────────────────
// Auto-billing tenants are handled by the scheduler; MANUAL tenants need the
// owner to create each month's bill. This surfaces manual tenants who have no
// bill yet for the current month, so nothing slips through.
function getManualPendingTenants(){
  let now=new Date(), mKey=now.getFullYear()+"-"+(now.getMonth()+1), curIdx=currentMonthIdx();
  return (tenants||[]).filter(t=>{
    if(t.billMode!=="manual") return false;
    if(!t.approved || t.active===false) return false;
    let mi=t.date?new Date(t.date):now;                       // not started yet (future move-in)?
    if(mi.getFullYear()*12+mi.getMonth() > curIdx) return false;
    if((bills||[]).some(b=>b.tenantId===t.id && normMK(b.monthKey)===normMK(mKey))) return false;  // already billed
    return true;
  });
}
async function _genManualBill(t){
  let now=new Date(), mKey=now.getFullYear()+"-"+(now.getMonth()+1);
  if((bills||[]).some(b=>b.tenantId===t.id && normMK(b.monthKey)===normMK(mKey))) return null;
  let items=buildBillItems(t); if(!items.length) return null;
  let total=items.reduce((s,i)=>s+Number(i.amount),0);
  let due=calcBillDueForMonth(t, new Date(now.getFullYear(), now.getMonth(), 1));
  let mLabel=now.toLocaleString("default",{month:"long",year:"numeric"});
  let ownerID=localStorage.getItem("kb_owner_id");
  await fbAdd("bills",{tenantId:t.id,tenantName:t.name,tenantPhone:t.phone||"",ownerID,monthKey:mKey,monthLabel:mLabel,dueDate:due.toISOString().split("T")[0],items,total,status:"pending",createdOn:now.toLocaleDateString("en-IN"),lastReminded:null});
  try{ await fbUpdate("tenants",t.id,{newBillAlert:{month:mLabel,total,dueDate:due.toISOString().split("T")[0],createdOn:now.toISOString()}}); }catch(e){}
  return total;
}
function renderManualBillingReminder(){
  let sec=document.getElementById("manual-billing-section"), list=document.getElementById("manual-billing-list");
  if(!sec||!list) return;
  let pend=getManualPendingTenants();
  if(!pend.length){ sec.style.display="none"; return; }
  let mLabel=new Date().toLocaleString("default",{month:"long",year:"numeric"});
  let subEl=document.getElementById("manual-billing-sub");
  if(subEl) subEl.textContent=`No bill created yet for ${mLabel} — ${pend.length} manual-billing tenant${pend.length>1?"s":""}.`;
  sec.style.display="block";
  list.innerHTML=pend.map(t=>{
    let total=buildBillItems(t).reduce((s,i)=>s+Number(i.amount),0);
    let amtTxt = total>0 ? `standard bill ${fmtMoney(total)}` : "no preset amount";
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;margin-bottom:7px">
      <div style="min-width:0">
        <div style="font-weight:700;font-size:12px">${esc(t.name)} · Room ${esc(t.room||"–")}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:1px">${amtTxt}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${total>0?`<button class="btn btn-success" style="font-size:10px;padding:5px 10px" onclick="createManualBillFor('${t.id}')">⚡ Generate</button>`:""}
        <button class="btn btn-ghost" style="font-size:10px;padding:5px 10px" onclick="goCreateBillFor('${t.id}')">✏️ Customize</button>
      </div>
    </div>`;
  }).join("");
}
window.renderManualBillingReminder=renderManualBillingReminder;
window.createManualBillFor=async(tid)=>{
  let t=(tenants||[]).find(x=>x.id===tid); if(!t){ toast("Tenant not found","error"); return; }
  if(!buildBillItems(t).length){ toast("No rent/charges set — use Customize to enter amounts","info"); return goCreateBillFor(tid); }
  let total=await _genManualBill(t);
  if(total==null){ toast("Bill for this month already exists","info"); renderManualBillingReminder(); return; }
  toast(`✅ ${fmtMoney(total)} bill created for ${t.name}`);
  await logActivity("Manual Bill Created",`Tenant: ${t.name}, Amount: ${fmtMoney(total)}`,"Owner");
  renderManualBillingReminder();
};
window.createAllManualBills=async()=>{
  let pend=getManualPendingTenants().filter(t=>buildBillItems(t).length);
  if(!pend.length){ toast("Set rent/charges on these tenants, or use Customize","info"); return; }
  if(!confirm(`Generate this month's standard bill for ${pend.length} manual-billing tenant(s)?`)) return;
  let n=0,sum=0;
  for(let t of pend){ let tot=await _genManualBill(t); if(tot!=null){ n++; sum+=tot; } }
  toast(`✅ Generated ${n} bill${n>1?"s":""} · ${fmtMoney(sum)}`);
  await logActivity("Manual Bills Generated (bulk)",`${n} bills, total ${fmtMoney(sum)}`,"Owner");
  renderManualBillingReminder();
};
window.goCreateBillFor=(tid)=>{
  let billTab=Array.from(document.querySelectorAll(".t-tab")).find(b=>b.textContent.includes("Create Bill"));
  if(billTab) billTab.click();
  setTimeout(()=>{ let sel=document.getElementById("bill-tenant-sel"); if(sel){ sel.value=tid; if(typeof sel.onchange==="function") sel.onchange(); } }, 200);
};

window.markBillPaid=async(id)=>{
  let now=new Date();
  await fbUpdate("bills",id,{
    status:"paid",
    paidOn:now.toLocaleDateString("en-IN"),
    paidOnIso:now.toISOString()
  });
  toast("✅ Bill paid!");

  // v13.x SYNC FIX: keep tenant record in sync when ANY bill is paid (incl. older
  // back-rent months for tenants who were 2+ months behind), not just the current month.
  try{
    let bill = (window._rawBills||[]).find(b=>b.id===id) || await fbGetDoc("bills", id);
    if(bill && bill.tenantId){
      let t = tenants.find(x=>x.id===bill.tenantId);
      if(t){
        let curMK = now.getFullYear()+"-"+(now.getMonth()+1);
        let isCurrentMonth = normMK(bill.monthKey) === normMK(curMK);
        let hist = (t.history||[]);
        // Record history against the bill's actual month (so back-paid months show correctly)
        let monthStr = bill.monthLabel || now.toLocaleString("default",{month:"long",year:"numeric"});
        if(!hist.find(h=>h.month===monthStr)){
          hist.unshift({month:monthStr, date:now.toLocaleDateString("en-IN"), amount:bill.total});
        }
        let tenantUpdate = {history:hist, lastPaidDate:now.toISOString().split("T")[0]};
        // "Paid this month" flag only reflects the current month's bill
        if(isCurrentMonth) tenantUpdate.paid = true;
        // Decrement advance rent balance for whichever month was settled (issue #5)
        if(Number(t.advanceRentBalance)>0){
          tenantUpdate.advanceRentBalance = Math.max(0, Number(t.advanceRentBalance) - Number(bill.total||0));
        }
        await fbUpdate("tenants", bill.tenantId, tenantUpdate);
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
      let curMK = now.getFullYear()+"-"+(now.getMonth()+1);
      if(normMK(bill.monthKey) === normMK(curMK)){
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

// ── EXPORT: ACTIVE TENANTS → EXCEL ────────────────────────────
// Builds one clearly-labeled row per active tenant (all profile, rent,
// charges and dues details) and downloads a real .xlsx (CSV fallback).
function buildActiveTenantRows(){
  let propMap={}; (properties||[]).forEach(p=>{ propMap[p.id]=p.name||""; });
  let active=(tenants||[]).filter(t=>t.approved && t.active!==false);
  return active.map(t=>{
    let other=(t.otherCharges||[]).filter(c=>c.name&&Number(c.amount)>0)
      .map(c=>`${c.name}: ${Number(c.amount)}`).join("; ");
    let rent=Number(t.rent)||0, maint=Number(t.maintenance)||0;
    let otherTotal=(t.otherCharges||[]).reduce((s,c)=>s+(Number(c.amount)||0),0);
    let unpaid=(bills||[]).filter(b=>b.tenantId===t.id && b.status!=="paid");
    let pendingAmt=unpaid.reduce((s,b)=>s+(Number(b.total)||0),0);
    let overdueCount=unpaid.filter(b=>getBillStatus(b)==="overdue").length;
    let duesStatus = !unpaid.length ? "Up to date"
      : overdueCount ? `Overdue (${unpaid.length} unpaid bill${unpaid.length>1?"s":""})`
      : `Pending (${unpaid.length} unpaid bill${unpaid.length>1?"s":""})`;
    return {
      "Tenant ID": t.tid||t.id||"",
      "Name": t.name||"",
      "Property": propMap[t.propertyId]||"",
      "Room / Unit": t.room||"",
      "Phone": t.phone||"",
      "Alt Phone": t.alt||"",
      "Email": t.email||"",
      "Address": t.address||"",
      "ID Proof Type": t.idType||"",
      "ID Number": t.idNum||"",
      "Move-in Date": t.date||"",
      "Rent Due Day": t.dueDay?`Day ${t.dueDay}`:"Per move-in date",
      "Monthly Rent (₹)": rent,
      "Maintenance (₹)": maint,
      "Other Charges": other||"—",
      "Other Charges Total (₹)": otherTotal,
      "Total Monthly (₹)": rent+maint+otherTotal,
      "Security Deposit (₹)": Number(t.securityDeposit)||0,
      "Advance Balance (₹)": Number(t.advanceRentBalance!=null?t.advanceRentBalance:(t.advanceRent||0))||0,
      "Bill Mode": t.billMode==="manual"?"Manual":"Automatic",
      "Paid This Month": t.paid?"Yes":"No",
      "Last Paid Date": t.lastPaidDate||"—",
      "Dues Status": duesStatus,
      "Pending Amount (₹)": pendingAmt,
      "Notes": t.notes||""
    };
  });
}

window.exportTenantsExcel=async()=>{
  let rows=buildActiveTenantRows();
  if(!rows.length){ toast("No active tenants to export.","info"); return; }
  let stamp=new Date().toISOString().split("T")[0];
  let fname=`KiraaBook_Active_Tenants_${stamp}`;
  toast("⏳ Preparing Excel…","info");
  try{
    const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
    let ws=XLSX.utils.json_to_sheet(rows);
    // Column widths sized to the header text for readability
    ws["!cols"]=Object.keys(rows[0]).map(k=>{
      let max=k.length;
      rows.forEach(r=>{ let v=String(r[k]??""); if(v.length>max) max=v.length; });
      return { wch: Math.min(Math.max(max+2,10), 45) };
    });
    let wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Active Tenants");
    XLSX.writeFile(wb,fname+".xlsx");
    toast(`✅ Exported ${rows.length} tenant${rows.length>1?"s":""} to Excel`);
    try{ await logActivity("Tenants Exported",`${rows.length} active tenants exported to Excel`,"Owner"); }catch(e){}
  }catch(e){
    console.error("[exportTenantsExcel] xlsx failed, falling back to CSV:",e);
    // CSV fallback — opens directly in Excel
    let headers=Object.keys(rows[0]);
    let csvLine=arr=>arr.map(v=>{ let s=String(v??""); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(",");
    let csv=[csvLine(headers),...rows.map(r=>csvLine(headers.map(h=>r[h])))].join("\r\n");
    let blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8;"});
    let url=URL.createObjectURL(blob);
    let a=document.createElement("a"); a.href=url; a.download=fname+".csv"; a.click();
    URL.revokeObjectURL(url);
    toast(`✅ Exported ${rows.length} tenant${rows.length>1?"s":""} (CSV — opens in Excel)`);
    try{ await logActivity("Tenants Exported",`${rows.length} active tenants exported to CSV`,"Owner"); }catch(e2){}
  }
};

let currentSort="attention";
window.setFilter=(f)=>{ currentFilter=f; renderTenantList(); };
window.setSort  =(s)=>{ currentSort=s; renderTenantList(); };

// Settle a tenant's OLDEST unpaid bill (arrears-first) straight from the list
window.collectOldest=async(tenantId)=>{
  let pb = window.getPendingBreakdown ? window.getPendingBreakdown() : {tenantGroups:[]};
  let grp = (pb.tenantGroups||[]).find(x=>x.tenantId===tenantId);
  if(!grp || !grp.bills.length){ toast("No pending bill to collect","info"); return; }
  await window.markBillPaid(grp.bills[0].id);   // bills are sorted oldest-first
};

// KYC / verification completeness — which documents a tenant still owes.
// Owner-added tenants start with these blank until they complete their profile.
function kycMissItems(t){
  let m=[];
  if(!(t.idType && t.idNum)) m.push("ID details");
  if(!t.idPhoto)             m.push("ID photo");
  if(!t.pvPhoto)             m.push("Police verification");
  return m;
}

// Nudge a tenant to complete KYC over WhatsApp
window.requestKyc=(tenantId)=>{
  let t=(tenants||[]).find(x=>x.id===tenantId); if(!t) return;
  let phone=String(t.phone||"").replace(/[^0-9]/g,"");
  if(!phone){ toast("No phone number on file for this tenant","info"); return; }
  let miss=kycMissItems(t);
  let msg=`Dear ${t.name}, please complete your KYC in the KiraaBook tenant portal${miss.length?` — still pending: ${miss.join(", ")}`:""}. Log in with your name & password to upload your documents. Thank you.`;
  window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`,"_blank");
};
window.setBillFilter=(f,el)=>{ billFilter=f; document.querySelectorAll("#tab-allbills .f-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active"); renderAllBills(); };

window.switchOwnerTab=(tab,el)=>{
  document.querySelectorAll(".t-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active");
  ["tenants","add-tenant","billing","allbills","rooms","roomhist","account","properties","maintenance","former"].forEach(t=>{ let e2=document.getElementById("tab-"+t); if(e2)e2.style.display=tab===t?"block":"none"; });
  try{
    if(tab==="tenants") renderTenantList();
    if(tab==="former") renderFormerTenants();
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
window._plansBilling = "annual";
window.setPlansBilling = (c)=>{ window._plansBilling=c; renderPlansGrid(); };

function renderPlansGrid(){
  let grid=document.getElementById("plans-grid"); if(!grid) return;
  let cycle=window._plansBilling||"annual";
  let curPlan=(currentOwnerData&&currentOwnerData.plan)||"trial";

  // Billing toggle
  let tog=document.getElementById("plans-billing-toggle");
  if(tog) tog.innerHTML=["monthly","annual"].map(c=>{
    let active=c===cycle;
    return `<button onclick="setPlansBilling('${c}')" style="flex:1;padding:8px;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;font-family:'Sora',sans-serif;background:${active?'var(--blue)':'transparent'};color:${active?'#fff':'var(--text3)'}">${c==='monthly'?'Monthly':'Annual · save ~33%'}</button>`;
  }).join("");

  let cardFor=(p)=>{
    let price=cycle==="annual"?p.annual:p.monthly;
    let per=cycle==="annual"?"/yr":"/mo";
    let capTxt=p.cap===Infinity?"Unlimited tenants":`Up to ${p.cap} tenants`;
    let isCurrent=curPlan===p.id;
    let save=(cycle==="annual"&&p.monthly)?Math.round((1-(p.annual/(p.monthly*12)))*100):0;
    return `<div style="background:${p.popular?'linear-gradient(135deg,var(--s2),var(--s3))':'var(--s2)'};border:2px solid ${p.popular?'var(--blue)':'var(--border)'};border-radius:var(--rs);padding:16px 14px;text-align:center;position:relative">
      ${p.popular?`<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--blue);color:#fff;font-size:9px;font-weight:800;padding:3px 10px;border-radius:99px;letter-spacing:.5px">POPULAR</div>`:""}
      <div style="font-size:10px;color:${p.popular?'var(--blue)':'var(--text3)'};font-weight:700;letter-spacing:.5px;margin-bottom:6px">${p.name.toUpperCase()}</div>
      <div style="font-size:25px;font-weight:800;color:var(--text)">₹${price.toLocaleString("en-IN")}<span style="font-size:13px;color:var(--text3);font-weight:600">${per}</span></div>
      <div style="font-size:10px;color:var(--green);font-weight:700;margin:2px 0 8px;min-height:12px">${save>0?`Save ${save}% vs monthly`:""}</div>
      <div style="font-size:12px;color:var(--text2);font-weight:800;margin-bottom:4px">${capTxt}</div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:12px">${p.tagline}</div>
      ${isCurrent?`<button class="btn btn-ghost" style="width:100%;font-size:11px" disabled>✓ Current plan</button>`:`<button class="btn ${p.popular?'btn-primary':'btn-edit'}" style="width:100%;font-size:12px" onclick="goToPlan('${p.id}','${cycle}')">Choose ${p.name}</button>`}
    </div>`;
  };

  let lt=LIFETIME_PLAN;
  let lifeCard=`<div style="background:linear-gradient(135deg,rgba(245,166,35,.1),var(--s2));border:2px solid var(--gold);border-radius:var(--rs);padding:16px 14px;text-align:center;position:relative">
    <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--gold);color:#0f172a;font-size:9px;font-weight:800;padding:3px 10px;border-radius:99px;letter-spacing:.5px">BEST VALUE</div>
    <div style="font-size:10px;color:var(--gold);font-weight:700;letter-spacing:.5px;margin-bottom:6px">LIFETIME</div>
    <div style="font-size:25px;font-weight:800;color:var(--text)">₹${lt.oneTime.toLocaleString("en-IN")}</div>
    <div style="font-size:10px;color:var(--green);font-weight:700;margin:2px 0 8px">one-time payment</div>
    <div style="font-size:12px;color:var(--text2);font-weight:800;margin-bottom:4px">Unlimited forever</div>
    <div style="font-size:10px;color:var(--text3);margin-bottom:12px">${lt.tagline}</div>
    ${curPlan==="lifetime"?`<button class="btn btn-ghost" style="width:100%;font-size:11px" disabled>✓ Current plan</button>`:`<button class="btn btn-gold" style="width:100%;font-size:12px" onclick="goToPlan('lifetime','once')">Buy Lifetime</button>`}
  </div>`;

  grid.innerHTML = PLAN_CATALOG.map(cardFor).join("") + lifeCard;
}

window.openPlansModal = ()=>{
  let info = currentOwnerData;
  let statusHtml = "Pick the plan that fits your tenant count:";
  if(info){
    if(info.plan==="trial" || !info.plan){
      let st = (typeof checkTrialStatus==="function") ? checkTrialStatus(info) : null;
      let d = st?.daysLeft ?? "?";
      statusHtml = `🆓 <strong>Current plan:</strong> Free Trial · ${d} day${d===1?"":"s"} remaining · up to 3 tenants`;
    } else {
      let cap=getPlanCap(info.plan);
      let capTxt=cap===Infinity?"unlimited tenants":`up to ${cap} tenants`;
      let name=(PLAN_CATALOG.find(p=>p.id===info.plan)?.name) || (info.plan==="lifetime"?"Lifetime":info.plan==="annual"?"Annual":info.plan==="monthly"?"Monthly":info.plan);
      let exp=(info.subExpiry&&info.plan!=="lifetime")?` · renews ${new Date(info.subExpiry).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}`:"";
      statusHtml = `✅ <strong>Current plan:</strong> ${name} · ${capTxt}${exp}`;
    }
  }
  let curEl = document.getElementById("plans-modal-current");
  if(curEl) curEl.innerHTML = statusHtml;
  renderPlansGrid();
  document.getElementById("plans-modal").classList.add("open");
};

window.goToPlan = (planId, cycle)=>{
  let p = planId==="lifetime" ? LIFETIME_PLAN : PLAN_CATALOG.find(x=>x.id===planId);
  if(!p){ toast("Plan not found","error"); return; }
  let amount = planId==="lifetime" ? p.oneTime : (cycle==="annual" ? p.annual : p.monthly);
  let url = payLink(amount);
  let w = window.open(url, "_blank", "noopener,noreferrer");
  if(!w){ alert(`Your browser blocked the payment popup. Please open this link manually:\n\n${url}`); return; }
  toast("💳 Opening payment page…","info");
  try{ logActivity("Plan Upgrade Initiated", `Plan: ${p.name} (${cycle}) ₹${amount}`, currentOwnerData?.name||"Owner"); }catch(e){}
};
// Back-compat: old callers used goToPaymentLink('monthly'|'annual')
window.goToPaymentLink = (plan)=>{ window.goToPlan(plan==="annual"?"pro":"pro", plan==="annual"?"annual":"monthly"); };

// ── RENDER TENANT LIST (operations cockpit) ───────────────────
function renderTenantList(){
  let list=document.getElementById("tenant-list"); if(!list) return;
  let q=(g("search")||"").toLowerCase();

  // Dues come from the single source of truth (bill-based), so this tab always
  // agrees with the dashboard Pending tile.
  let pb = window.getPendingBreakdown ? window.getPendingBreakdown() : {overall:0,tenantGroups:[]};
  let duesByTenant={}; (pb.tenantGroups||[]).forEach(gr=>{ duesByTenant[gr.tenantId]=gr; });
  let owesOf   = t=> duesByTenant[t.id] ? duesByTenant[t.id].total : 0;
  let behindOf = t=> duesByTenant[t.id] ? duesByTenant[t.id].arrearsCount : 0;

  let activeAppr = tenants.filter(t=>t.approved && t.active!==false);

  // ── Portfolio counts (for the summary strip + chip badges) ──
  // Payment status is a clean PARTITION so filters never overlap:
  //   paid (owes 0) · due (owes, current month only) · arrears (1+ prev months)
  // KYC is a separate axis (verification), independent of what's owed.
  let c={ all:activeAppr.length,
          pending: tenants.filter(t=>!t.approved && t.active!==false).length,
          due:0, arrears:0, paid:0, unpaid:0, nopv:0,
          deactivated: tenants.filter(t=>t.active===false).length };
  activeAppr.forEach(t=>{
    let owes=owesOf(t), behind=behindOf(t);
    if(owes<=0) c.paid++;
    else { c.unpaid++; if(behind>0) c.arrears++; else c.due++; }
    if(kycMissItems(t).length) c.nopv++;
  });

  // ── Summary strip (clickable) ──
  let sEl=document.getElementById("tenants-summary");
  if(sEl){
    let tile=(val,lbl,filter,col)=>`<div class="mtile" style="border-left:3px solid ${col}" onclick="setFilter('${filter}')"><div class="mtile-val">${val}</div><div class="mtile-lbl">${lbl}</div></div>`;
    sEl.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${tile(c.all,"👥 Active","all","var(--blue)")}
      ${tile(c.arrears,"🔴 In arrears","arrears","var(--red)")}
      ${tile(fmtMoney(pb.overall||0),"💸 Pending","unpaid","var(--orange)")}
      ${tile(c.pending,"⏳ To approve","pending","var(--gold)")}
    </div>`;
  }

  // ── Filter chips (with counts) + sort control ──
  let ctrlEl=document.getElementById("tenants-controls");
  if(ctrlEl){
    let chips=[["all","All",c.all],["pending","⏳ Approve",c.pending],
      ["due","📅 This month",c.due],["arrears","🔴 Arrears",c.arrears],["paid","✓ Paid",c.paid],
      ["nopv","🪪 No KYC",c.nopv]];   // former/left tenants now live in their own tab
    let chipHtml=chips.map(([f,lbl,n])=>`<div class="f-tab ${currentFilter===f?'active':''}" onclick="setFilter('${f}')">${lbl}<span style="opacity:.6;margin-left:3px">${n}</span></div>`).join("");
    let sorts=[["attention","Needs attention"],["dues","Owes most"],["behind","Most months behind"],["name","Name A–Z"],["room","Room"],["recent","Newest first"]];
    let sortHtml=`<div style="display:flex;align-items:center;gap:6px;margin:2px 0 12px"><span style="font-size:10px;color:var(--text3);font-weight:600">Sort</span><select class="mt-sort" onchange="setSort(this.value)">${sorts.map(([v,l])=>`<option value="${v}" ${currentSort===v?'selected':''}>${l}</option>`).join("")}</select></div>`;
    ctrlEl.innerHTML=`<div class="filter-bar">${chipHtml}</div>${sortHtml}`;
  }

  // ── Filter ──
  let filt=tenants.filter(t=>{
    let isDeact=t.active===false;
    if(currentFilter==="deactivated"){ if(!isDeact) return false; }
    else {
      if(isDeact) return false;
      if(currentFilter==="pending"){ if(t.approved) return false; }
      else if(!t.approved) return false;
      if(currentFilter==="paid"    && owesOf(t)>0)   return false;                    // nothing owed
      if(currentFilter==="unpaid"  && owesOf(t)<=0)  return false;                    // owes (summary ₹ tile)
      if(currentFilter==="due"     && !(owesOf(t)>0 && behindOf(t)<=0)) return false; // current month only
      if(currentFilter==="arrears" && behindOf(t)<=0) return false;                   // 1+ months behind
      if(currentFilter==="nopv"    && kycMissItems(t).length===0) return false;       // KYC complete
    }
    if(q){
      let blob=(t.name+" "+(t.room||"")+" "+(t.phone||"")+" "+(t.tid||"")+" "+(t.email||"")).toLowerCase();
      if(!blob.includes(q)) return false;
    }
    return true;
  });

  // ── Sort ──
  let att=t=> behindOf(t)*1e9 + (isOverdue(t)?1e8:0) + owesOf(t);
  let sortFns={
    attention:(a,b)=> att(b)-att(a) || (a.name||"").localeCompare(b.name||""),
    dues:(a,b)=> owesOf(b)-owesOf(a) || (a.name||"").localeCompare(b.name||""),
    behind:(a,b)=> behindOf(b)-behindOf(a) || owesOf(b)-owesOf(a),
    name:(a,b)=> (a.name||"").localeCompare(b.name||""),
    room:(a,b)=> String(a.room||"").localeCompare(String(b.room||""),undefined,{numeric:true}),
    recent:(a,b)=> new Date(b.date||0)-new Date(a.date||0),
  };
  filt.sort(sortFns[currentSort]||sortFns.attention);

  if(!filt.length){
    let msg = currentFilter==="nopv"    ? "All tenants' KYC is complete 🎉"
            : currentFilter==="arrears" ? "No tenant is in arrears 🎉"
            : currentFilter==="due"     ? "No current-month dues 🎉"
            : currentFilter==="paid"    ? "No fully-paid tenants yet"
            : "No tenants found";
    list.innerHTML=`<div class="empty-state"><div class="empty-icon">🏠</div><div class="empty-text">${msg}</div></div>`;
    return;
  }

  // ── Action-first cards ──
  let propName=id=> id ? ((properties||[]).find(p=>p.id===id)?.name||"") : "";
  list.innerHTML=filt.map(t=>{
    let ini=(t.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
    let av=t.profPhoto?`<img src="${t.profPhoto}"/>`:ini;
    let owes=owesOf(t), behind=behindOf(t);
    let grp=duesByTenant[t.id];
    let pn=propName(t.propertyId); let pTxt=pn?` · ${esc(pn)}`:"";

    let miss=kycMissItems(t);                       // KYC docs still outstanding
    let kycView=(currentFilter==="nopv");           // verification-focused card

    let pill=(bg,txt)=>`<span style="background:${bg};color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap">${txt}</span>`;
    let mod, badge, infoLine;

    if(kycView){
      // ── Verification-focused card (No KYC filter) ──
      mod="overdue";
      badge=pill("var(--red)","🪪 KYC incomplete");
      infoLine=`<span style="color:var(--red);font-weight:700">Missing: ${miss.join(", ")||"—"}</span>`;
    } else {
      // ── Payment-focused card ──
      if(t.active===false){ mod=""; badge=`<span style="background:var(--s3);color:var(--text3);font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap">⛔ Left</span>`; }
      else if(!t.approved){ mod="pending"; badge=pill("var(--orange)","⏳ Pending approval"); }
      else if(behind>0){ mod="overdue"; badge=pill("var(--red)",`🔴 ${behind} month${behind>1?"s":""} behind`); }
      else if(owes>0){ mod="unpaid"; badge=pill("var(--orange)","⚠️ Due this month"); }
      else { mod="paid"; badge=pill("var(--green)","✓ All clear"); }
      let lastPaid = t.lastPaidDate ? `last paid ${fmtDate(t.lastPaidDate)}` : "no payments yet";
      infoLine = owes>0
        ? `<span style="color:var(--red);font-weight:800">Owes ${fmtMoney(owes)}</span> <span style="color:var(--text3)">· ${lastPaid}</span>`
        : `<span style="color:var(--green);font-weight:700">No dues</span> <span style="color:var(--text3)">· ${lastPaid}</span>`;
    }

    // Small KYC tag on normal cards too, so the axis is visible everywhere
    let kycTag = (!kycView && t.active!==false && t.approved && miss.length)
      ? `<div style="margin-top:4px"><span style="background:var(--red-g);color:var(--red);font-size:8px;font-weight:800;padding:2px 6px;border-radius:99px;white-space:nowrap">🪪 No KYC</span></div>` : "";

    let acts=[];
    if(kycView){
      if(t.phone) acts.push(`<button class="btn btn-warn" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();requestKyc('${t.id}')">💬 Request docs</button>`);
      acts.push(`<button class="btn btn-ghost" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();openTenantDetail('${t.id}','general')">👁 Details</button>`);
    } else {
      if(!t.approved && t.active!==false)
        acts.push(`<button class="btn btn-approve" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();approveTenant('${t.id}')">✓ Approve</button>`);
      if(owes>0 && t.active!==false){
        acts.push(`<button class="btn btn-success" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();collectOldest('${t.id}')">✓ Collect</button>`);
        if(t.phone && grp && grp.bills.length)
          acts.push(`<button class="btn btn-warn" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();sendOneOffReminder('${grp.bills[0].id}')">💬 Remind</button>`);
      }
      acts.push(`<button class="btn btn-ghost" style="font-size:10px;padding:5px 10px" onclick="event.stopPropagation();openTenantDetail('${t.id}','${owes>0?'bills':'general'}')">👁 Details</button>`);
    }

    return `<div class="t-card ${mod} t-card-clickable" style="margin-bottom:10px" onclick="openTenantDetail('${t.id}','general')">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="t-avatar">${av}</div>
        <div class="t-info">
          <div class="t-name">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--text3);font-weight:500;margin-top:1px">Room ${esc(t.room||"–")}${pTxt} · ${fmtMoney(t.rent)}/mo</div>
          <div style="font-size:10px;margin-top:3px">${infoLine}</div>
        </div>
        <div style="flex-shrink:0;text-align:right">${badge}${kycTag}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">${acts.join("")}</div>
    </div>`;
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

// ── FINANCIAL SOURCE OF TRUTH ─────────────────────────────────
// Collected & Pending are derived from THESE helpers only, so the dashboard
// tiles and their detail modals are computed from identical rules and can
// never drift apart. The bill record is the single unit of money owed/received.

// Effective "money received" date for a paid bill (cash-basis collection date).
// Prefers the actual payment timestamp; falls back for legacy bills.
function billPaidDate(b){
  if(!b || b.status!=="paid") return null;
  if(b.paidOnIso){ let d=new Date(b.paidOnIso); if(!isNaN(d)) return d; }
  if(b.monthKey){ let [y,m]=String(b.monthKey).split("-").map(Number); if(y&&m) return new Date(y,m-1,15); }
  if(b.dueDate){ let d=new Date(b.dueDate); if(!isNaN(d)) return d; }
  return null;
}

// Approved, non-deactivated tenants — the only ones whose dues are receivable.
function getActiveTenantIdSet(){
  return new Set((tenants||[]).filter(t=>t.approved && t.active!==false).map(t=>t.id));
}

// PENDING = every unpaid bill belonging to an active approved tenant.
function getPendingBills(){
  let active=getActiveTenantIdSet();
  return (bills||[]).filter(b=>b.status!=="paid" && b.status!=="writtenoff" && b.tenantId && active.has(b.tenantId));
}

// COLLECTED = paid bills whose money was received in the given month (cash basis).
function getCollectedBills(monthDate){
  let m=monthDate.getMonth(), y=monthDate.getFullYear();
  return (bills||[]).filter(b=>{
    let d=billPaidDate(b);
    return d && d.getMonth()===m && d.getFullYear()===y;
  });
}

// Comparable month index from a monthKey ("2026-6" → 2026*12+5). null if unparseable.
function monthKeyIndex(mk){
  let p=normMK(mk).split("-"); let y=Number(p[0]), m=Number(p[1]);
  if(!y||!m) return null;
  return y*12+(m-1);
}
function currentMonthIdx(){ let n=new Date(); return n.getFullYear()*12+n.getMonth(); }
// A bill is "arrears" if its billing month is strictly before the current month.
function isArrearBill(b){ let i=monthKeyIndex(b.monthKey); return i!=null && i<currentMonthIdx(); }

// The correct due date for a bill, derived from its OWN billing month (via the
// tenant's due-day / move-in cycle). This makes multi-month arrears show
// distinct, correct overdue counts even if a bill was saved by an older code
// path with a stale or duplicated dueDate. Falls back to the stored dueDate.
function effectiveBillDue(b){
  let idx=monthKeyIndex(b.monthKey);
  if(idx!=null){
    let t=(tenants||[]).find(x=>x.id===b.tenantId);
    if(t){
      let d=calcBillDueForMonth(t, new Date(Math.floor(idx/12), idx%12, 1));
      if(d && !isNaN(d)) return d;
    }
  }
  if(b.dueDate){ let d=new Date(b.dueDate); if(!isNaN(d)) return d; }
  return null;
}

// Bifurcates pending into THIS-MONTH vs ARREARS (previous months), grouped by
// tenant and sorted worst-first, so the owner can see who is 2/3 months behind.
function getPendingBreakdown(){
  let pend=getPendingBills();
  let c=currentMonthIdx();
  let curMonth=0, arrears=0;
  let groups={};
  pend.forEach(b=>{
    let amt=Number(b.total||0);
    let i=monthKeyIndex(b.monthKey);
    let isArr = (i!=null && i<c);
    if(isArr) arrears+=amt; else curMonth+=amt; // unknown/future → treat as current
    let id=b.tenantId||"?";
    let g=(groups[id]=groups[id]||{tenantId:id, name:b.tenantName||"–", bills:[], arrearBills:[], currentBills:[], total:0, arrearsCount:0, arrearsAmt:0, currentAmt:0});
    g.bills.push(b);
    g.total+=amt;
    if(isArr){ g.arrearsCount++; g.arrearsAmt+=amt; g.arrearBills.push(b); } else { g.currentAmt+=amt; g.currentBills.push(b); }
  });
  let tenantGroups=Object.values(groups);
  tenantGroups.forEach(g=>g.bills.sort((a,b)=>(monthKeyIndex(a.monthKey)??0)-(monthKeyIndex(b.monthKey)??0)));
  // worst first: most months in arrears, then biggest balance
  tenantGroups.sort((a,b)=> b.arrearsCount-a.arrearsCount || b.total-a.total);
  return {
    overall: curMonth+arrears,
    curMonth, arrears,
    arrearsTenants: tenantGroups.filter(g=>g.arrearsCount>0).length,
    tenantGroups
  };
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
    st.title="Click to see all tenants";
    st.onclick=()=>openTenantsModal();
  }
  let stParent=st?.closest(".stat-card");
  if(stParent){ stParent.style.cursor="pointer"; stParent.onclick=()=>openTenantsModal(); }

  // Pending-approval banner section
  let pSec=document.getElementById("pending-section"), pVal=document.getElementById("pending-count");
  if(pendApproval.length>0){ if(pSec)pSec.style.display="block"; if(pVal)pVal.textContent=pendApproval.length; }
  else { if(pSec)pSec.style.display="none"; }

  // Collected this month (cash basis) + Pending (all outstanding for active tenants).
  // Both numbers come from the shared helpers, so each tile matches its detail
  // modal exactly. A bill paid today counts toward THIS month's Collected
  // regardless of which month it was billed for; Pending is every unpaid bill of
  // an active tenant. No phantom/implicit rent — the bill is the source of truth.
  let now=new Date();
  let collected=getCollectedBills(now).reduce((s,b)=>s+Number(b.total||0),0);
  let pb=getPendingBreakdown();          // {overall, curMonth, arrears, arrearsTenants, tenantGroups}
  let pendingAmt=pb.overall;

  let sc=document.getElementById("s-col"); if(sc) sc.textContent=fmtMoney(collected);
  let sp=document.getElementById("s-pend"); if(sp) sp.textContent=fmtMoney(pendingAmt);
  // Bifurcate the sub-line: this month's dues vs carried-over arrears
  let spSub=document.getElementById("s-pend-sub");
  if(spSub){
    if(pb.arrears>0) spSub.innerHTML=`📅 This mo ${fmtMoney(pb.curMonth)} · ⏳ Arrears ${fmtMoney(pb.arrears)}`;
    else if(pb.curMonth>0) spSub.textContent="all current month";
    else spSub.textContent="all clear";
  }

  // Make Collected/Pending tiles clickable (item 4)
  if(sc){ sc.style.cursor="pointer"; sc.title="Click to see collected bills this month"; sc.onclick=()=>openCollectedModal(); }
  let openPend=()=>{ window._pendingFilter="all"; openPendingModal(); };  // always open showing everything
  if(sp){ sp.style.cursor="pointer"; sp.title="Click to see pending bills"; sp.onclick=openPend; }
  let scParent=sc?.closest(".stat-card"); if(scParent){ scParent.style.cursor="pointer"; scParent.onclick=()=>openCollectedModal(); }
  let spParent=sp?.closest(".stat-card"); if(spParent){ spParent.style.cursor="pointer"; spParent.onclick=openPend; }

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
      total:totalSet.size,
      unit:unitNoun(p.type||"other").many   // Flats / Beds / Units / …
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
        total:unassignedRoomSet.size,
        unit:"Units"
      });
    }
  }
  // Write totals to the dashboard tile. Label adapts to the property type(s):
  // a single type → its plural noun ("Flats/Beds Vacant"); mixed → generic "Units".
  let sv=document.getElementById("s-vacant"); if(sv) sv.textContent=totalVacant;
  let svSub=document.getElementById("s-vacant-sub"); if(svSub) svSub.textContent = `of ${totalRoomsCount} total`;
  let svLbl=document.getElementById("s-vacant-lbl");
  if(svLbl){
    let allTypes=new Set((properties||[]).map(p=>p.type||"other"));
    let many = allTypes.size===1 ? unitNoun([...allTypes][0]).many : "Units";
    svLbl.textContent = `${many} Vacant`;
  }
  // Make the Vacant tile clickable to show per-property breakdown
  if(sv){
    sv.style.cursor="pointer";
    sv.title = "Click to see vacant units per property";
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
  setTimeout(()=>{ if(typeof window.setFilter==="function") window.setFilter(filterKey); }, 200);
};

window.scrollToVacateNotices = ()=>{
  let el = document.getElementById("vacant-notices-section");
  if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
};

// ── Cross-module exports ──────────────────────────────────────
// Plain function declarations in this module that other modules
// (tenant.js, admin.js, ui.js, account.js, properties.js) call as
// bare names — they must be on window so global lookup finds them.
window.checkTrialStatus    = checkTrialStatus;
window.isOverdue           = isOverdue;
window.getBillStatus       = getBillStatus;
window.getDaysText         = getDaysText;
window.billPaidDate        = billPaidDate;
window.getPendingBills     = getPendingBills;
window.getPendingBreakdown = getPendingBreakdown;
window.getCollectedBills   = getCollectedBills;
window.effectiveBillDue    = effectiveBillDue;
window.getActiveTenantIdSet= getActiveTenantIdSet;
window.updateOwnerStats    = updateOwnerStats;
window.renderTenantList    = renderTenantList;
window.renderAllBills      = renderAllBills;
window.canAddTenant        = canAddTenant;
window.renderTrialBanner   = renderTrialBanner;
window.renderTenantLimitWarn = renderTenantLimitWarn;
window.refreshBillsForOwner  = refreshBillsForOwner;
window.renderClaimsSection   = renderClaimsSection;
window.renderRemindersSection= renderRemindersSection;
window.renderOverdueAlerts   = renderOverdueAlerts;
window.renderVacantNotices   = renderVacantNotices;
window.renderRooms           = renderRooms;
window.populateTenantSelect  = populateTenantSelect;
window.initOwner             = initOwner;        // called from auth.js and account.js
window.autoCreateMonthlyBills = autoCreateMonthlyBills;
window.getOtherCharges       = getOtherCharges;
window.buildBillItems        = buildBillItems;

// ── TENANTS OVERVIEW MODAL ────────────────────────────────────
window.openTenantsModal = ()=>{
  let activeAppr = tenants.filter(t=>t.approved && t.active!==false);
  let pendApproval = tenants.filter(t=>!t.approved && t.active!==false);
  let paidCount   = activeAppr.filter(t=>t.paid).length;
  let unpaidCount = activeAppr.filter(t=>!t.paid).length;

  // Summary bar
  document.getElementById("tenants-overview-summary").innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px">
      <div style="background:var(--blue-g);border:1px solid rgba(79,156,249,.25);border-radius:var(--rs);padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:var(--blue)">${activeAppr.length}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:600">Total Tenants</div>
      </div>
      <div style="background:var(--green-g);border:1px solid rgba(34,197,94,.25);border-radius:var(--rs);padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:var(--green)">${paidCount}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:600">Paid</div>
      </div>
      <div style="background:var(--red-g);border:1px solid rgba(244,63,94,.25);border-radius:var(--rs);padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:var(--red)">${unpaidCount}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:600">Unpaid</div>
      </div>
    </div>
    ${pendApproval.length ? `<div style="background:var(--orange-g);border:1px solid rgba(251,146,60,.3);border-radius:var(--rs);padding:8px 12px;font-size:11px;font-weight:600;color:var(--orange)">⏳ ${pendApproval.length} tenant${pendApproval.length===1?"":"s"} awaiting your approval</div>` : ""}
  `;

  // Tenant rows
  let html="";
  if(!activeAppr.length){
    html=`<div class="empty-state"><div class="empty-icon">🏠</div><div class="empty-text">No active tenants yet</div></div>`;
  } else {
    let sorted=[...activeAppr].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
    html=sorted.map(t=>{
      let ini=(t.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
      let avatarHtml=t.profPhoto
        ?`<img src="${t.profPhoto}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0"/>`
        :`<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--gold));display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:#111;flex-shrink:0">${esc(ini)}</div>`;
      let payBadge=t.paid
        ?`<span style="background:var(--green-g);color:var(--green);font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px">✓ Paid</span>`
        :`<span style="background:var(--red-g);color:var(--red);font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px">⚠ Unpaid</span>`;
      return `<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${avatarHtml}
        <div style="flex:1;min-width:180px">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--text3);font-weight:500;line-height:1.7">
            🏠 Room ${esc(t.room||"–")}
            &nbsp;·&nbsp;
            📅 Moved in ${t.date?fmtDate(t.date):"–"}
            &nbsp;·&nbsp;
            💰 ${fmtMoney(t.rent)}/mo
            ${t.phone?`<br>📞 ${esc(t.phone)}`:""}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
          ${payBadge}
          <button class="btn btn-edit" style="padding:4px 10px;font-size:10px" onclick="closeModal('tenants-overview-modal');openTenantDetail('${t.id}')">View →</button>
        </div>
      </div>`;
    }).join("");
  }

  // Pending approval section
  if(pendApproval.length){
    html+=`<div style="font-size:11px;font-weight:700;color:var(--orange);letter-spacing:.5px;text-transform:uppercase;margin:14px 0 8px">⏳ Awaiting Approval</div>`;
    html+=pendApproval.map(t=>`
      <div style="background:var(--orange-g);border:1px solid rgba(251,146,60,.3);border-radius:var(--rs);padding:10px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--text3);font-weight:500">🏠 Room ${esc(t.room||"–")} · 💰 ${fmtMoney(t.rent)}/mo${t.phone?` · 📞 ${esc(t.phone)}`:""}</div>
        </div>
        <button class="btn btn-approve" style="padding:5px 12px;font-size:11px" onclick="closeModal('tenants-overview-modal');approveTenant('${t.id}')">✓ Approve</button>
      </div>`).join("");
  }

  document.getElementById("tenants-overview-content").innerHTML=html;
  document.getElementById("tenants-overview-modal").classList.add("open");
};
// ── ACCOUNT TAB ───────────────────────────────────────────────
