import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, ADMIN_PASS } from '../firebase.js';
import { state } from '../state.js';
import { g, sv, show, toast, fmtDate, esc, escAttr, closeModal, genUID, stampPdfReference } from '../helpers.js';


// ════════════════════════════════════════════════════════════
// ═══════════════════ v10 ADDITIONS ══════════════════════════
// ════════════════════════════════════════════════════════════

// ── CURRENCY ──────────────────────────────────────────────────
let CURRENCY = localStorage.getItem("kb_currency") || "₹";
function fmtMoney(n){
  let v=Number(n||0);
  if(CURRENCY==="₹") return CURRENCY+v.toLocaleString("en-IN");
  return CURRENCY+v.toLocaleString("en-US",{maximumFractionDigits:2});
}
window.saveCurrency=()=>{
  CURRENCY=document.getElementById("set-currency").value;
  localStorage.setItem("kb_currency",CURRENCY);
  toast("✅ Currency set to "+CURRENCY,"info");
  if(typeof renderTenantList==="function") renderTenantList();
  if(typeof renderAllBills==="function") renderAllBills();
  if(typeof updateOwnerStats==="function") updateOwnerStats();
};

// ── AG GRID STATE ─────────────────────────────────────────────
const AG = { owners:null, tenants:null, bills:null, keys:null, logs:null };

function renderFallbackTable(container, columnDefs, rowData){
  // Plain HTML table — always works
  if(!rowData || !rowData.length){
    container.innerHTML='<div style="padding:30px;text-align:center;color:#94a3b8;font-weight:600;font-size:12px">No records found</div>';
    return;
  }
  let visibleCols = columnDefs.filter(c=>c.field); // skip action-renderer columns for table simplicity, we'll add them after
  let actionCol = columnDefs.find(c=>!c.field && c.cellRenderer);
  let thead = `<thead><tr>${visibleCols.map(c=>`<th style="background:#1e293b;color:#f5a623;padding:10px 8px;text-align:left;font-size:11px;font-weight:700;border-bottom:2px solid #334155;position:sticky;top:0">${c.headerName||c.field}</th>`).join("")}${actionCol?`<th style="background:#1e293b;color:#f5a623;padding:10px 8px;text-align:left;font-size:11px;font-weight:700;border-bottom:2px solid #334155;position:sticky;top:0">${actionCol.headerName||"Actions"}</th>`:""}</tr></thead>`;
  let tbody = `<tbody>${rowData.map((r,i)=>{
    let rowHtml=`<tr style="background:${i%2?'#0b1426':'#0f172a'};border-bottom:1px solid #1e293b">`;
    visibleCols.forEach(c=>{
      let v=r[c.field]; if(v==null) v="–";
      rowHtml+=`<td style="padding:8px;font-size:11px;color:#e2e8f0">${String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`;
    });
    if(actionCol){
      try{
        let html=actionCol.cellRenderer({data:r});
        rowHtml+=`<td style="padding:8px">${html}</td>`;
      }catch(e){ rowHtml+=`<td>–</td>`; }
    }
    rowHtml+=`</tr>`;
    return rowHtml;
  }).join("")}</tbody>`;
  container.innerHTML=`<div style="overflow:auto;max-height:520px;background:#0f172a"><table style="width:100%;border-collapse:collapse">${thead}${tbody}</table></div>`;
}

function initAGGrid(name, columnDefs, rowData, containerId){
  let container = document.getElementById(containerId);
  if(!container){ console.warn("AG container not found:",containerId); return null; }
  // Always render fallback first so data is visible immediately
  renderFallbackTable(container, columnDefs, rowData);
  // Try AG Grid on top if available
  if(typeof agGrid==="undefined"){
    console.warn("agGrid library not loaded — using fallback table");
    return null;
  }
  // Destroy previous AG instance
  if(AG[name]){ try{ AG[name].destroy(); }catch(e){} }
  // Use a delay so the container has its size set
  setTimeout(()=>{
    try{
      container.innerHTML=""; // clear fallback before mounting grid
      const opts = {
        columnDefs,
        rowData: rowData||[],
        defaultColDef: { sortable:true, filter:true, resizable:true, minWidth:80, flex:1 },
        pagination:true, paginationPageSize:25, paginationPageSizeSelector:[10,25,50,100],
        animateRows:true, rowHeight:38, headerHeight:38,
        suppressCellFocus:true, enableCellTextSelection:true,
        overlayNoRowsTemplate:'<div style="padding:30px;color:#94a3b8;font-weight:600">No records found</div>'
      };
      AG[name] = agGrid.createGrid(container, opts);
    }catch(e){
      console.error("AG Grid failed, restoring fallback:",e);
      renderFallbackTable(container, columnDefs, rowData);
    }
  }, 50);
  return AG[name];
}

window.exportGridCsv = (name)=>{
  if(AG[name]){
    try{
      AG[name].exportDataAsCsv({fileName:`kiraabook-${name}-${new Date().toISOString().split("T")[0]}.csv`});
      toast("📥 CSV exported","info");
      return;
    }catch(e){ /* fall through */ }
  }
  toast("Export not available for this view","info");
};
window.autoSizeGrid = (name)=>{
  if(AG[name]){
    try{ AG[name].autoSizeAllColumns(false); toast("⇿ Columns auto-sized","info"); }
    catch(e){ toast("Auto-fit not available","info"); }
  }
};

// ── NOTIFICATIONS (in-app + browser) ──────────────────────────
let notifications=[];
let unsubNotif=null;

function unreadNotifCount(){ return notifications.filter(n=>!n.read).length; }
function refreshBellBadge(){
  let badge=document.getElementById("bell-badge");
  if(!badge) return;
  let n=unreadNotifCount();
  if(n>0){ badge.style.display="flex"; badge.textContent=n>99?"99+":n; } else badge.style.display="none";
}

window.toggleNotifDropdown=(ev)=>{
  ev?.stopPropagation();
  let dd=document.getElementById("notif-dropdown");
  if(!dd) return;
  dd.classList.toggle("open");
  if(dd.classList.contains("open")) renderNotifs();
};
document.addEventListener("click",(e)=>{
  let dd=document.getElementById("notif-dropdown");
  if(dd && dd.classList.contains("open") && !e.target.closest(".bell-wrap")) dd.classList.remove("open");
});

function renderNotifs(){
  let list=document.getElementById("notif-list");
  if(!list) return;
  if(!notifications.length){ list.innerHTML=`<div class="notif-empty">No notifications yet</div>`; return; }
  let sorted=[...notifications].sort((a,b)=>new Date(b.createdOn||0)-new Date(a.createdOn||0)).slice(0,30);
  list.innerHTML=sorted.map(n=>`
    <div class="notif-item ${n.read?"":"unread"}" onclick="onNotifClick('${n.id}','${esc(n.kind||"info")}')">
      <div class="notif-item-head"><span>${esc(n.title||"Notification")}</span><span class="notif-item-time">${esc(n.dateLabel||"")}</span></div>
      <div class="notif-item-body">${esc(n.body||"")}</div>
    </div>`).join("");
}

window.onNotifClick=async(id, kind)=>{
  // Mark as read first
  try{ await fbUpdate("notifications",id,{read:true,readOn:new Date().toISOString()}); }catch(e){}
  // Close dropdown
  let dd=document.getElementById("notif-dropdown"); if(dd) dd.classList.remove("open");
  // Route to appropriate tab based on kind
  let tabMap = {
    "maintenance_ticket": "maintenance",
    "payment_claim":      "tenants",
    "vacant_notice":      "tenants",
    "tenant_register":    "tenants",   // ← was misspelled as tenant_registered
    "tenant_registered":  "tenants",   // keep both for backward compat
    "tenant_profile":     "tenants",
    "tenant_update":      "tenants",
    "new_tenant":         "tenants",
    "bill_overdue":       "allbills",
    "rent_paid":          "allbills",
    "support_reply":      null         // admin reply → just open the dropdown back / no nav
  };
  let targetTab = tabMap[kind];
  // Fallback: infer tab from notification text if kind is unknown
  if(targetTab===undefined){
    let notif=null;
    try{ notif = await fbGetDoc("notifications", id); }catch(e){}
    let blob = ((notif?.title||"") + " " + (notif?.body||"")).toLowerCase();
    if(blob.includes("maintenance")) targetTab="maintenance";
    else if(blob.includes("payment") || blob.includes("paid") || blob.includes("rent")) targetTab="tenants";
    else if(blob.includes("vacat")) targetTab="tenants";
    else if(blob.includes("tenant") || blob.includes("registration") || blob.includes("registered")) targetTab="tenants";
    else if(blob.includes("bill")) targetTab="allbills";
  }
  if(targetTab){
    let btns = document.querySelectorAll(".t-tab");
    for(let btn of btns){
      let inline = btn.getAttribute("onclick")||"";
      if(inline.includes(`'${targetTab}'`)){ btn.click(); break; }
    }
    // If we landed on tenants tab and notification mentions pending approval, switch filter to "pending"
    if(targetTab==="tenants"){
      setTimeout(()=>{
        let pendBtn = Array.from(document.querySelectorAll(".f-tab")).find(t=>(t.getAttribute("onclick")||"").includes("'pending'"));
        if(pendBtn) pendBtn.click();
      }, 200);
    }
  }
};

// Keep markNotifRead as a separate function for backward compat
window.markNotifRead=async(id)=>{
  try{
    await fbUpdate("notifications",id,{read:true,readOn:new Date().toISOString()});
  }catch(e){}
};
window.markAllNotifsRead=async()=>{
  for(let n of notifications){ if(!n.read){ try{ await fbUpdate("notifications",n.id,{read:true,readOn:new Date().toISOString()}); }catch(e){} } }
  toast("✓ All marked as read","info");
};

async function pushNotification(ownerID, title, body, kind="info"){
  if(!ownerID) return;
  try{
    await fbAdd("notifications",{
      ownerID, title, body, kind,
      read:false,
      dateLabel:new Date().toLocaleString("default",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})
    });
  }catch(e){ console.warn("push notif failed",e); }
}

function subscribeOwnerNotifications(ownerID){
  if(unsubNotif){try{unsubNotif();}catch(e){}}
  try{
    unsubNotif=onSnapshot(collection(db,"notifications"),snap=>{
      try{
        let all=snap.docs.map(d=>({id:d.id,...d.data()}));
        let prev=notifications.map(n=>n.id);
        notifications=all.filter(n=>n.ownerID===ownerID);
        refreshBellBadge();
        let newOnes=notifications.filter(n=>!prev.includes(n.id) && !n.read);
        if(newOnes.length && localStorage.getItem("kb_browser_notif")==="on" && "Notification" in window && Notification.permission==="granted"){
          newOnes.slice(0,3).forEach(n=>{
            try{ new Notification("🏠 KiraaBook: "+(n.title||""),{body:n.body||""}); }catch(e){}
          });
        }
        let dd=document.getElementById("notif-dropdown");
        if(dd && dd.classList.contains("open")) renderNotifs();
      }catch(e){ console.warn("notif snapshot handler error:",e); }
    }, err=>{ console.warn("notif subscribe error:",err); });
  }catch(e){ console.warn("notif subscribe failed:",e); }
}

// ── BROWSER NOTIF TOGGLE ──────────────────────────────────────
window.toggleBrowserNotifs=async()=>{
  let toggle=document.getElementById("set-notif-toggle");
  if(!toggle) return;
  if(toggle.classList.contains("on")){
    toggle.classList.remove("on");
    localStorage.setItem("kb_browser_notif","off");
    toast("🔕 Browser notifications disabled","info");
  } else {
    if(!("Notification" in window)){ toast("This browser does not support notifications","error"); return; }
    let perm=await Notification.requestPermission();
    if(perm==="granted"){
      toggle.classList.add("on");
      localStorage.setItem("kb_browser_notif","on");
      toast("🔔 Browser notifications enabled","info");
      try{ new Notification("🏠 KiraaBook",{body:"Notifications are now enabled!"}); }catch(e){}
    } else { toast("Permission denied. Enable from browser settings.","error"); }
  }
};

window.enablePushNotifs=async()=>{
  if(!("Notification" in window)){ toast("This browser does not support push notifications","error"); return; }
  if(!("serviceWorker" in navigator)){ toast("Service workers not supported","error"); return; }
  alert("📱 Background Push Notifications (FCM)\n\nTo enable mobile push notifications when the app is closed, you need to:\n\n1. Place the file 'firebase-messaging-sw.js' at the same URL where KiraaBook is hosted\n2. Enable Firebase Cloud Messaging in your Firebase Console\n3. Generate a VAPID key and paste it in your config\n\nWithout these, you can still use in-app notifications and browser notifications (while tab is open).\n\nThe 'firebase-messaging-sw.js' file content is included in the README.");
};

// ── OWNER PROFILE PIC & EDIT ──────────────────────────────────
window.uploadOwnerPic=()=>{
  let file=document.getElementById("owner-pic-file").files[0];
  if(!file) return;
  let reader=new FileReader();
  reader.onload=e=>{
    let img=new Image();
    img.onload=async()=>{
      let canvas=document.createElement("canvas");
      let ratio=Math.min(400/img.width,400/img.height,1);
      canvas.width=img.width*ratio; canvas.height=img.height*ratio;
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      let compressed=canvas.toDataURL("image/jpeg",0.7);
      let ownerID=localStorage.getItem("kb_owner_id");
      if(!ownerID) return;
      try{
        await fbUpdate("owners",ownerID,{profilePic:compressed});
        document.getElementById("owner-pic-circle").innerHTML=`<img src="${compressed}"/>`;
        if(currentOwnerData) currentOwnerData.profilePic=compressed;
        toast("✅ Profile photo updated!");
        await logActivity("Owner Profile Pic Updated","","Owner");
      }catch(e){ toast("Error: "+e.message,"error"); }
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
};

window.showOwnerEditProfile=async()=>{
  if(!currentOwnerData){
    let ownerID=localStorage.getItem("kb_owner_id");
    if(ownerID){ try{ currentOwnerData=await fbGetDoc("owners",ownerID); }catch(e){} }
  }
  if(!currentOwnerData){ toast("Could not load profile. Try refreshing.","error"); return; }
  let f=document.getElementById("owner-edit-profile-form");
  if(!f) return;
  f.style.display="block";
  sv("oep-name",currentOwnerData.name||"");
  sv("oep-phone",currentOwnerData.phone||"");
  sv("oep-email",currentOwnerData.email||"");
  sv("oep-pass",""); sv("oep-pass2","");
  f.scrollIntoView({behavior:"smooth"});
};
window.cancelOwnerEditProfile=()=>{ document.getElementById("owner-edit-profile-form").style.display="none"; };
window.saveOwnerEditProfile=async()=>{
  let name=g("oep-name"), phone=g("oep-phone"), email=g("oep-email").toLowerCase();
  let p1=g("oep-pass"), p2=g("oep-pass2");
  if(!name){ toast("Name required","error"); return; }
  if(phone && phone.length<10){ toast("Valid phone required","error"); return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("Valid email required","error"); return; }
  if(p1||p2){
    if((p1||"").length<6){ toast("Password must be 6+ chars","error"); return; }
    if(p1!==p2){ toast("Passwords don't match","error"); return; }
  }
  let upd={name,phone:phone||"",email:email||""};
  if(p1) upd.password=p1;
  let ownerID=localStorage.getItem("kb_owner_id");
  if(!ownerID){ toast("Session expired — please login again","error"); return; }
  try{
    await fbUpdate("owners",ownerID,upd);
    if(currentOwnerData) Object.assign(currentOwnerData,upd);
    else currentOwnerData=upd;
    localStorage.setItem("kb_owner_name",name);
    let dispEl=document.getElementById("owner-display-name");
    if(dispEl) dispEl.textContent=name;
    toast("✅ Profile updated!");
    cancelOwnerEditProfile();
    renderAccountTab();
    try{ await logActivity("Owner Profile Updated",`Name: ${name}`,"Owner"); }catch(e){}
  }catch(e){ console.error(e); toast("Error: "+(e.message||"unknown"),"error"); }
};

// ── TENANT EDIT PROFILE (BUG FIX #9) ──────────────────────────
window.goTenantEditProfile=async()=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ toast("Session expired","error"); return; }
  // Populate fields
  sv("tep-name",t.name||"");
  sv("tep-phone",t.phone||"");
  sv("tep-alt",t.alt||"");
  sv("tep-email",t.email||"");
  sv("tep-address",t.address||"");
  sv("tep-idtype",t.idType||"");
  sv("tep-idnum",t.idNum||"");
  sv("tep-room",t.room||"");
  sv("tep-rent",t.rent||"");
  sv("tep-date",t.date||"");
  sv("tep-notes",t.notes||"");
  sv("tep-pass",""); sv("tep-pass2","");
  // ID type visibility
  document.getElementById("tep-id-area").style.display=t.idType?"block":"none";
  // Reset photo previews and load existing
  let profPrev=document.getElementById("tep-prof-prev");
  if(t.profPhoto){ profPrev.innerHTML=`<img src="${t.profPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`; sv("tep-prof-data",t.profPhoto); }
  else { profPrev.innerHTML=`<span style="font-size:30px">👤</span>`; sv("tep-prof-data",""); }
  let idPrev=document.getElementById("tep-id-prev");
  if(t.idPhoto){ idPrev.innerHTML=`<img src="${t.idPhoto}" style="width:100%;height:100%;object-fit:contain"/>`; sv("tep-id-data",t.idPhoto); }
  else { idPrev.innerHTML=`<span style="font-size:22px">📄</span><span style="font-size:11px;color:var(--text3);font-weight:600">Tap to upload</span>`; sv("tep-id-data",""); }
  let pvPrev=document.getElementById("tep-pv-prev");
  if(t.pvPhoto){ pvPrev.innerHTML=`<img src="${t.pvPhoto}" style="width:100%;height:100%;object-fit:contain"/>`; sv("tep-pv-data",t.pvPhoto); }
  else { pvPrev.innerHTML=`<span style="font-size:22px">📋</span><span style="font-size:11px;color:var(--text3);font-weight:600">Upload verification form</span>`; sv("tep-pv-data",""); }
  document.getElementById("tep-err").textContent="";
  show("screen-tenant-edit");
};

window.returnToTenantView=async()=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  show("screen-tenant");
  if(t) await renderTenantView(t);
};

window.saveTenantEditProfile=async()=>{
  console.log("[saveTenantEditProfile] called. currentTenantId =", currentTenantId);
  let err=document.getElementById("tep-err");
  if(!err){
    toast("Edit form not loaded properly. Please reload.","error");
    console.error("[saveTenantEditProfile] tep-err element missing");
    return;
  }
  err.textContent="";
  if(!currentTenantId){
    err.textContent="Session lost. Please return to dashboard and try again.";
    toast("Session expired — please log in again","error");
    return;
  }
  let name=g("tep-name"), phone=g("tep-phone"), email=g("tep-email").toLowerCase();
  if(!name){ err.textContent="Name is required."; document.getElementById("tep-name")?.focus(); return; }
  if(phone && phone.length<10){ err.textContent="Valid phone required (10+ digits)."; return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent="Valid email required."; return; }
  let p1=g("tep-pass"), p2=g("tep-pass2");
  if(p1||p2){
    if(p1.length<6){ err.textContent="Password must be 6+ chars."; return; }
    if(p1!==p2){ err.textContent="Passwords don't match."; return; }
  }
  let upd={
    name, phone, alt:g("tep-alt"), email,
    address:g("tep-address"),
    idType:g("tep-idtype"), idNum:g("tep-idnum"),
    date:g("tep-date"), notes:g("tep-notes"),
    profPhoto:document.getElementById("tep-prof-data")?.value||"",
    idPhoto:document.getElementById("tep-id-data")?.value||"",
    pvPhoto:document.getElementById("tep-pv-data")?.value||"",
    lastUpdated:new Date().toISOString(),
    needsProfileCompletion:false
  };
  if(p1) upd.password=p1;
  err.textContent="⏳ Saving...";
  try{
    let oldT=await fbGetDoc("tenants",currentTenantId);
    if(!oldT){
      err.textContent="❌ Tenant record not found. Please log in again.";
      console.error("[saveTenantEditProfile] tenant not found:", currentTenantId);
      return;
    }
    await fbUpdate("tenants",currentTenantId,upd);
    toast("✅ Profile updated!");
    // Notify owner of profile changes
    if(oldT.ownerID){
      let changes=[];
      ["name","phone","email","address","idType","idNum"].forEach(k=>{ if(oldT[k]!==upd[k]) changes.push(k); });
      let picChanged = oldT.profPhoto!==upd.profPhoto;
      let idChanged = oldT.idPhoto!==upd.idPhoto;
      let pvChanged = oldT.pvPhoto!==upd.pvPhoto;
      if(picChanged) changes.push("profile photo");
      if(idChanged) changes.push("ID document");
      if(pvChanged) changes.push("verification document");
      if(changes.length){
        try{ await pushNotification(oldT.ownerID, `✏️ ${name} updated profile`,
          `Fields changed: ${changes.join(", ")}`, "tenant_update"); }catch(e){}
      }
    }
    try{ await logActivity("Tenant Profile Updated",`Tenant: ${name}, Fields: ${Object.keys(upd).filter(k=>k!=="password"&&k!=="lastUpdated").join(", ")}`,name); }catch(e){}
    returnToTenantView();
  }catch(e){
    let msg = e.message||e.code||"unknown error";
    err.textContent="❌ Save failed: "+msg;
    toast("Save failed: "+msg, "error");
    console.error("[saveTenantEditProfile] Firestore error:", e);
  }
};

// ── OWNER: DEACTIVATE / DELETE TENANT (already had deactivate; add delete properly) ──
// (window.deleteTenant and window.deactivateTenant already exist)

// ── ROOM HISTORY ─────────────────────────────────────────────
let roomHistoryRecs=[];
let unsubRH=null;

function subscribeRoomHistory(ownerID){
  if(unsubRH){try{unsubRH();}catch(e){}}
  try{
    unsubRH=onSnapshot(collection(db,"roomHistory"),snap=>{
      try{
        roomHistoryRecs=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.ownerID===ownerID);
        let tab=document.getElementById("tab-roomhist");
        if(tab && tab.style.display!=="none") renderRoomHistory();
      }catch(e){ console.warn("roomHistory snapshot handler error:",e); }
    }, err=>{ console.warn("roomHistory subscribe error:",err); });
  }catch(e){ console.warn("roomHistory subscribe failed:",e); }
}

window.renderRoomHistory=()=>{
  let q=(document.getElementById("rh-search")?.value||"").trim().toLowerCase();
  let list=document.getElementById("room-history-list");
  if(!list) return;
  // Group by room
  let roomMap={};
  // First, collect all rooms from roomHistory records
  roomHistoryRecs.forEach(r=>{
    if(!roomMap[r.room]) roomMap[r.room]=[];
    roomMap[r.room].push(r);
  });
  // Also include currently occupied rooms not yet in history
  tenants.forEach(t=>{
    if(!t.room||!t.approved) return;
    let existing=roomHistoryRecs.find(r=>r.room===t.room && r.tenantId===t.id && !r.movedOutOn);
    if(!existing){
      if(!roomMap[t.room]) roomMap[t.room]=[];
      roomMap[t.room].push({
        room:t.room, tenantId:t.id, tenantName:t.name,
        movedInOn:t.date||t.submittedOn,
        movedOutOn:null,
        current:true,
        rent:t.rent
      });
    }
  });
  // Filter
  let twoYearsAgo=new Date(); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear()-2);
  let roomEntries=Object.entries(roomMap);
  if(q){
    roomEntries=roomEntries.filter(([room,entries])=>{
      let blob=(room+" "+entries.map(e=>e.tenantName||"").join(" ")).toLowerCase();
      return blob.includes(q);
    });
  }
  // Sort: rooms with currently-occupied first, then alpha
  roomEntries.sort((a,b)=>{
    let aCur=a[1].some(e=>!e.movedOutOn);
    let bCur=b[1].some(e=>!e.movedOutOn);
    if(aCur!==bCur) return bCur-aCur;
    return a[0].localeCompare(b[0],undefined,{numeric:true});
  });
  if(!roomEntries.length){ list.innerHTML=`<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-text">No room history yet</div></div>`; return; }
  list.innerHTML=roomEntries.map(([room,entries])=>{
    // Filter entries to last 2 years (keep open-ended/current ones always)
    let recent=entries.filter(e=>!e.movedInOn || new Date(e.movedInOn)>=twoYearsAgo || !e.movedOutOn);
    recent.sort((a,b)=>new Date(b.movedInOn||0)-new Date(a.movedInOn||0));
    let currentTenant=recent.find(e=>!e.movedOutOn);
    return `<div class="room-hist-card">
      <div class="room-hist-head">
        <div class="room-hist-room">🏢 Room ${esc(room)}</div>
        ${currentTenant?`<span style="background:rgba(34,197,94,.15);color:var(--green);padding:4px 8px;border-radius:99px;font-size:10px;font-weight:700">● Occupied · ${esc(currentTenant.tenantName)}</span>`:`<span style="background:rgba(0,0,0,.2);color:var(--text3);padding:4px 8px;border-radius:99px;font-size:10px;font-weight:700">○ Vacant</span>`}
      </div>
      <div class="rh-timeline">
        ${recent.map(e=>`
          <div class="rh-entry ${e.movedOutOn?'':'current'}">
            <div class="rh-tenant-name">${esc(e.tenantName||"(unknown)")}${e.movedOutOn?"":" — Currently staying"}</div>
            <div class="rh-meta">
              📅 Moved in: ${fmtDate(e.movedInOn)}
              ${e.movedOutOn?` · Moved out: ${fmtDate(e.movedOutOn)} · Stay: ${stayDuration(e.movedInOn,e.movedOutOn)}`:""}
              ${e.rent?` · ${fmtMoney(e.rent)}/mo`:""}
              ${e.reason?` · ${esc(e.reason)}`:""}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
  }).join("");
};

function stayDuration(start,end){
  if(!start||!end) return "–";
  let d=Math.floor((new Date(end)-new Date(start))/(864e5));
  if(d<30) return `${d} day${d===1?"":"s"}`;
  let m=Math.floor(d/30);
  if(m<12) return `${m} month${m===1?"":"s"}`;
  let y=Math.floor(m/12); let rm=m%12;
  return `${y}y${rm?` ${rm}m`:""}`;
}

async function recordRoomHistoryEntry(tenantId, tenantName, room, rent, ownerID, movedInOn){
  if(!room||!ownerID) return;
  try{
    // Check existing open entry for this tenant+room
    let all=await fbGet("roomHistory");
    let open=all.find(r=>r.tenantId===tenantId && r.room===room && !r.movedOutOn && r.ownerID===ownerID);
    if(open) return; // already open
    await fbAdd("roomHistory",{
      ownerID, room, tenantId, tenantName, rent,
      movedInOn: movedInOn || new Date().toISOString().split("T")[0],
      movedOutOn: null
    });
  }catch(e){ console.warn("room history add:",e); }
}

async function closeRoomHistoryEntry(tenantId, ownerID, reason=""){
  try{
    let all=await fbGet("roomHistory");
    let open=all.filter(r=>r.tenantId===tenantId && !r.movedOutOn && r.ownerID===ownerID);
    for(let r of open){
      await fbUpdate("roomHistory",r.id,{
        movedOutOn:new Date().toISOString().split("T")[0],
        reason
      });
    }
  }catch(e){ console.warn("room history close:",e); }
}

// ── PDF DOWNLOAD: BILL ───────────────────────────────────────
window.downloadBillPdf=async(billId)=>{
  let b=await fbGetDoc("bills",billId);
  if(!b){ toast("Bill not found","error"); return; }
  let t=await fbGetDoc("tenants",b.tenantId);
  let owner=b.ownerID?await fbGetDoc("owners",b.ownerID):null;
  let {jsPDF}=window.jspdf;
  let pdf=new jsPDF();
  // Header
  pdf.setFillColor(15,23,42);
  pdf.rect(0,0,210,30,"F");
  pdf.setTextColor(245,166,35);
  pdf.setFontSize(20); pdf.setFont("helvetica","bold");
  pdf.text("KiraaBook · Rent Invoice",105,15,{align:"center"});
  pdf.setFontSize(9); pdf.setTextColor(200,200,200);
  pdf.text("Professional Rent Manager",105,22,{align:"center"});
  // Bill info box
  pdf.setTextColor(30,30,30);
  pdf.setFont("helvetica","normal");
  pdf.setFontSize(11);
  let y=42;
  pdf.setFont("helvetica","bold"); pdf.text("Invoice For",15,y); pdf.text("From",115,y);
  pdf.setFont("helvetica","normal");
  pdf.text(`${t?.name||b.tenantName||"–"}`,15,y+6);
  pdf.text(`Room: ${t?.room||"–"}`,15,y+12);
  pdf.text(`Phone: ${t?.phone||"–"}`,15,y+18);
  if(t?.email) pdf.text(`Email: ${t.email}`,15,y+24);
  pdf.text(`${owner?.name||"Property Owner"}`,115,y+6);
  if(owner?.phone) pdf.text(`Phone: ${owner.phone}`,115,y+12);
  if(owner?.email) pdf.text(`Email: ${owner.email}`,115,y+18);
  // Bill meta
  y=80;
  pdf.setFont("helvetica","bold"); pdf.setFontSize(12);
  pdf.text(`Bill for: ${b.monthLabel||"–"}`,15,y);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(10);
  pdf.text(`Due date: ${fmtDate(b.dueDate)}`,15,y+6);
  pdf.text(`Status: ${b.status==="paid"?"PAID":"PENDING"}`,15,y+12);
  if(b.paidOn) pdf.text(`Paid on: ${b.paidOn}`,15,y+18);
  // Items table
  let items=(b.items||[]).map(i=>[i.name,fmtMoney(i.amount)]);
  if(items.length){
    pdf.autoTable({
      startY:y+24,
      head:[["Item","Amount"]],
      body:items,
      foot:[["TOTAL",fmtMoney(b.total||0)]],
      theme:"grid",
      headStyles:{fillColor:[15,23,42],textColor:[245,166,35],fontStyle:"bold"},
      footStyles:{fillColor:[245,166,35],textColor:[0,0,0],fontStyle:"bold",fontSize:11},
      styles:{fontSize:10,cellPadding:4}
    });
  }
  // Footer
  let pageH=pdf.internal.pageSize.getHeight();
  pdf.setFontSize(8); pdf.setTextColor(120,120,120);
  pdf.text(`Generated by KiraaBook on ${new Date().toLocaleString()}`,105,pageH-10,{align:"center"});
  pdf.text(`Bill ID: ${b.id}`,105,pageH-6,{align:"center"});
  pdf.save(`kiraabook-bill-${(b.monthLabel||"bill").replace(/\s+/g,"-")}-${(t?.name||"tenant").replace(/\s+/g,"-")}.pdf`);
  toast("📥 PDF downloaded","info");
};

window.downloadAllTenantBillsPdf=async()=>{
  let t=tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ toast("Session expired","error"); return; }
  let allBills=await fbGet("bills");
  let myBills=allBills.filter(b=>b.tenantId===t.id).sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
  if(!myBills.length){ toast("No bills to download","info"); return; }
  let {jsPDF}=window.jspdf;
  let pdf=new jsPDF();
  pdf.setFillColor(15,23,42);
  pdf.rect(0,0,210,30,"F");
  pdf.setTextColor(245,166,35);
  pdf.setFontSize(20); pdf.setFont("helvetica","bold");
  pdf.text("KiraaBook · Bills Summary",105,15,{align:"center"});
  pdf.setFontSize(10); pdf.setTextColor(200,200,200);
  pdf.text(`${t.name} · Room ${t.room||"–"}`,105,22,{align:"center"});
  pdf.setTextColor(30,30,30);
  let rows=myBills.map(b=>[
    b.monthLabel||"–",
    fmtDate(b.dueDate),
    fmtMoney(b.total),
    b.status==="paid"?"PAID":(getBillStatus(b)==="overdue"?"OVERDUE":"PENDING"),
    b.paidOn||"–"
  ]);
  pdf.autoTable({
    startY:38,
    head:[["Month","Due Date","Amount","Status","Paid On"]],
    body:rows,
    theme:"striped",
    headStyles:{fillColor:[15,23,42],textColor:[245,166,35]},
    styles:{fontSize:9,cellPadding:3}
  });
  let pageH=pdf.internal.pageSize.getHeight();
  pdf.setFontSize(8); pdf.setTextColor(120,120,120);
  pdf.text(`Generated by KiraaBook on ${new Date().toLocaleString()}`,105,pageH-10,{align:"center"});
  pdf.save(`kiraabook-bills-${t.name.replace(/\s+/g,"-")}.pdf`);
  toast("📥 PDF downloaded","info");
};

window.exportMyData=async()=>{
  let ownerID=localStorage.getItem("kb_owner_id");
  let myT=tenants;
  let myB=bills;
  let backup={owner:currentOwnerData,tenants:myT,bills:myB,exportedOn:new Date().toISOString()};
  let blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
  let url=URL.createObjectURL(blob);
  let a=document.createElement("a"); a.href=url; a.download=`kiraabook-mydata-${new Date().toISOString().split("T")[0]}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast("💾 Data exported","info");
};

// ── OTP / PHONE RESET (Firebase Auth) ─────────────────────────
// For phone OTP: we use Firebase Auth signInWithPhoneNumber. Requires Phone Auth enabled in console.
let recaptchaVerifier=null, confirmationResult=null;
async function setupRecaptcha(containerId){
  try{
    const fbAuth = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js");
    let auth = fbAuth.getAuth(fapp);
    if(recaptchaVerifier){ try{recaptchaVerifier.clear();}catch(e){} }
    recaptchaVerifier = new fbAuth.RecaptchaVerifier(auth, containerId, {size:"invisible"});
    return {auth,fbAuth};
  }catch(e){ console.error(e); throw e; }
}
window.sendOtpToOwner=async()=>{
  let phone=g("owner-forgot-phone");
  let err=document.getElementById("owner-forgot-err");
  if(!phone||phone.length<10){ err.textContent="Enter valid phone number."; return; }
  let user=document.getElementById("owner-user").value.trim().toLowerCase();
  if(!user){ err.textContent="Enter your username above first."; return; }
  err.textContent="⏳ Verifying user...";
  try{
    let owners=await fbGet("owners");
    let found=owners.find(o=>o.username===user && o.phone===phone);
    if(!found){ err.textContent="❌ Username and phone don't match."; return; }
    forgotOwnerDocId=found.id;
    err.textContent="⏳ Sending OTP...";
    let {auth,fbAuth} = await setupRecaptcha("recaptcha-container-owner");
    let intl="+"+phone.replace(/[^0-9]/g,"");
    if(!intl.startsWith("+")) intl="+"+intl;
    // If only digits provided without country code, default to +91 (India). Owner can edit.
    if(intl.length<=11) intl="+91"+phone.replace(/[^0-9]/g,"");
    confirmationResult = await fbAuth.signInWithPhoneNumber(auth, intl, recaptchaVerifier);
    err.textContent="";
    document.getElementById("owner-otp-box").style.display="block";
    document.getElementById("owner-forgot-verify-btn-wrap").style.display="none";
    toast("📨 OTP sent to "+intl,"info");
  }catch(e){
    console.error(e);
    err.textContent="❌ Could not send OTP. "+(e.message||"")+ " — make sure Phone Auth is enabled in Firebase Console. Falling back to phone-match verification.";
  }
};
window.verifyOwnerOtp=async()=>{
  let code=g("owner-otp-code");
  let err=document.getElementById("owner-forgot-err");
  if(!code||code.length<4){ err.textContent="Enter OTP."; return; }
  err.textContent="⏳ Verifying OTP...";
  try{
    if(!confirmationResult){ err.textContent="OTP session expired. Resend OTP."; return; }
    await confirmationResult.confirm(code);
    err.textContent="";
    document.getElementById("owner-forgot-verified").style.display="block";
    document.getElementById("owner-otp-box").style.display="none";
    toast("✅ OTP verified! Set a new password.","info");
  }catch(e){ err.textContent="❌ Invalid OTP. Try again."; }
};
window.sendOtpToTenant=async()=>{
  let phone=g("forgot-phone");
  let err=document.getElementById("forgot-err");
  let name=document.getElementById("t-name-inp").value.trim();
  if(!name){ err.textContent="Enter your name above first."; return; }
  if(!phone||phone.length<10){ err.textContent="Enter valid phone number."; return; }
  err.textContent="⏳ Verifying tenant...";
  try{
    let all=await fbGet("tenants");
    let found=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase() && t.phone===phone);
    if(!found){ err.textContent="❌ Name and phone don't match."; return; }
    forgotTenantDocId=found.id;
    err.textContent="⏳ Sending OTP...";
    let {auth,fbAuth} = await setupRecaptcha("recaptcha-container-tenant");
    let intl="+"+phone.replace(/[^0-9]/g,"");
    if(intl.length<=11) intl="+91"+phone.replace(/[^0-9]/g,"");
    confirmationResult = await fbAuth.signInWithPhoneNumber(auth, intl, recaptchaVerifier);
    err.textContent="";
    document.getElementById("tenant-otp-box").style.display="block";
    document.getElementById("forgot-verify-btn-wrap").style.display="none";
    toast("📨 OTP sent to "+intl,"info");
  }catch(e){
    console.error(e);
    err.textContent="❌ Could not send OTP. "+(e.message||"")+" — falling back to phone-match.";
  }
};
window.verifyTenantOtp=async()=>{
  let code=g("tenant-otp-code");
  let err=document.getElementById("forgot-err");
  if(!code||code.length<4){ err.textContent="Enter OTP."; return; }
  err.textContent="⏳ Verifying OTP...";
  try{
    if(!confirmationResult){ err.textContent="OTP session expired."; return; }
    await confirmationResult.confirm(code);
    err.textContent="";
    document.getElementById("forgot-verified").style.display="block";
    document.getElementById("tenant-otp-box").style.display="none";
    toast("✅ OTP verified!","info");
  }catch(e){ err.textContent="❌ Invalid OTP."; }
};

// Global error handler — show errors instead of freezing silently
window.addEventListener("error", (e)=>{
  console.error("Global error:", e.error||e.message);
  let t=document.getElementById("toast");
  if(t){ t.textContent="⚠️ Error: "+(e.message||"unknown"); t.className="toast error"; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),5000); }
});
window.addEventListener("unhandledrejection", (e)=>{
  console.error("Unhandled promise:", e.reason);
});

// Emergency reset: clear localStorage and reload
window.kbReset=()=>{
  if(confirm("Reset KiraaBook session?\n\nThis clears your local login state but does NOT delete any data in Firebase. You will need to log in again.")){
    localStorage.clear();
    location.reload();
  }
};

// ═════════════════════════════════════════════════════════════
// v11 ROUND 3: COLLECTED/PENDING MODALS, OWNER-EDIT-TENANT,
// ADMIN PASSKEY RESET, AUTO-WHATSAPP-REMINDER SCHEDULER
// ═════════════════════════════════════════════════════════════

// ── ITEM 4: Collected / Pending detail modals ────────────────
window.openCollectedModal=()=>{
  let now=new Date();
  // Same source of truth as the Collected tile (cash received this month)
  let paid=(window.getCollectedBills?window.getCollectedBills(now):[]).slice();
  let total=paid.reduce((s,b)=>s+Number(b.total||0),0);
  let monthName=now.toLocaleString("default",{month:"long",year:"numeric"});
  let html=`<div style="background:var(--green-g);border:1px solid rgba(34,197,94,.25);border-radius:var(--rs);padding:12px;margin-bottom:14px;text-align:center">
    <div style="font-size:11px;color:var(--text3);font-weight:600;margin-bottom:4px">${esc(monthName)}</div>
    <div style="font-size:26px;font-weight:800;color:var(--green)">${fmtMoney(total)}</div>
    <div style="font-size:11px;color:var(--text3);font-weight:600;margin-top:4px">${paid.length} bill${paid.length===1?"":"s"} collected</div>
  </div>`;
  if(!paid.length){
    html += `<div class="empty-state"><div class="empty-icon">📥</div><div class="empty-text">No bills collected this month yet</div></div>`;
  } else {
    paid.sort((a,b)=>new Date(b.paidOnIso||b.paidOn||0)-new Date(a.paidOnIso||a.paidOn||0));
    html += paid.map(b=>`<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-weight:700;font-size:13px">${esc(b.tenantName||"–")}</div>
        <div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">${esc(b.monthLabel||"–")} · Paid on ${esc(b.paidOn||"–")}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-weight:800;color:var(--green);font-size:14px">${fmtMoney(b.total)}</div>
        <button class="btn pdf-btn" style="padding:4px 10px;font-size:10px" onclick="downloadBillPdf('${b.id}')">⬇️ PDF</button>
      </div>
    </div>`).join("");
  }
  document.getElementById("collected-modal-content").innerHTML=html;
  document.getElementById("collected-modal").classList.add("open");
};

// Pay a bill from inside the Pending modal, then refresh the modal in place so
// the owner can settle several arrears months without reopening it each time.
window.payFromPendingModal=async(billId)=>{
  await window.markBillPaid(billId);
  setTimeout(()=>{ if(document.getElementById("pending-modal")?.classList.contains("open")) window.openPendingModal(); }, 500);
};

// Which bucket the pending modal is filtered to: "all" | "current" | "arrears"
window._pendingFilter="all";
window.setPendingFilter=(f)=>{ window._pendingFilter=f; window.openPendingModal(); };

window.openPendingModal=()=>{
  // Single source of truth — bifurcated into THIS MONTH vs ARREARS, grouped by tenant.
  // All three summary tiles are clickable and filter the tenant list below.
  let pb=(window.getPendingBreakdown?window.getPendingBreakdown():{overall:0,curMonth:0,arrears:0,arrearsTenants:0,tenantGroups:[]});
  let tmap={}; (tenants||[]).forEach(t=>{ tmap[t.id]=t; });
  let billCount=pb.tenantGroups.reduce((s,g)=>s+g.bills.length,0);
  let filter=window._pendingFilter||"all";

  // Effective (per-month-correct) due date + status for a bill
  let dueOf=b=> (window.effectiveBillDue?window.effectiveBillDue(b):(b.dueDate?new Date(b.dueDate):null));
  let statusChip=b=>{
    let due=dueOf(b); if(!due) return "";
    let n=new Date(); n.setHours(0,0,0,0); let d=new Date(due); d.setHours(0,0,0,0);
    let diff=Math.round((d-n)/864e5);
    if(diff<0) return `<span style="color:var(--red);font-weight:700">overdue ${Math.abs(diff)}d</span>`;
    if(diff===0) return `<span style="color:var(--orange);font-weight:700">due today</span>`;
    if(diff<=3) return `<span style="color:var(--orange);font-weight:700">due in ${diff}d</span>`;
    return `<span style="color:var(--text3);font-weight:600">in ${diff}d</span>`;
  };

  // ── Clickable bifurcated summary: This Month · Arrears · Total ──
  let card=(id,emoji,title,amount,sub,bg,brd,col)=>{
    let active=filter===id;
    return `<div onclick="setPendingFilter('${id}')" title="Tap to view ${esc(title)}"
      style="flex:1;min-width:120px;background:${bg};border:${active?"2px":"1px"} solid ${active?col:brd};border-radius:var(--rs);padding:10px;text-align:center;cursor:pointer;position:relative;box-shadow:${active?"0 0 0 3px "+bg:"none"};transition:all .12s">
      ${active?`<div style="position:absolute;top:5px;right:7px;font-size:9px;color:${col};font-weight:800">● showing</div>`:""}
      <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.4px">${emoji} ${title}</div>
      <div style="font-size:20px;font-weight:800;color:${col};margin-top:4px">${fmtMoney(amount)}</div>
      <div style="font-size:9px;color:var(--text3);font-weight:600;margin-top:2px">${sub}</div>
    </div>`;
  };
  let html=`<div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
    ${card("current","📅","This Month",pb.curMonth,"current cycle dues","var(--orange-g)","rgba(251,146,60,.3)","var(--orange)")}
    ${card("arrears","⏳","Arrears",pb.arrears,`${pb.arrearsTenants} tenant${pb.arrearsTenants===1?"":"s"} behind`,"var(--red-g)","rgba(244,63,94,.3)","var(--red)")}
    ${card("all","Σ","Total Pending",pb.overall,`${billCount} unpaid bill${billCount===1?"":"s"}`,"var(--s3)","var(--border)","var(--text)")}
  </div>
  <div style="font-size:10px;color:var(--text3);font-weight:600;text-align:center;margin-bottom:12px">👆 Tap a tile to filter · showing <strong style="color:var(--text2)">${filter==="current"?"This Month":filter==="arrears"?"Arrears (previous months)":"All pending"}</strong></div>`;

  // ── Filter the tenant groups + their bills to the chosen bucket ──
  let groups=pb.tenantGroups.map(g=>{
    let shownBills = filter==="current" ? g.currentBills : filter==="arrears" ? g.arrearBills : g.bills;
    return {g, shownBills};
  }).filter(x=>x.shownBills.length);

  if(!groups.length){
    let msg = filter==="arrears" ? "No arrears — everyone is current 🎉"
            : filter==="current" ? "No dues for the current month 🎉"
            : "All bills are paid! 🎉";
    html += `<div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-text">${msg}</div></div>`;
  } else {
    html += groups.map(({g,shownBills})=>{
      let t=tmap[g.tenantId];
      let room=t?.room?` · Room ${esc(t.room)}`:"";
      let inArrears=g.arrearsCount>0;
      let accent=inArrears?"var(--red)":"var(--orange)";
      let shownTotal=shownBills.reduce((s,b)=>s+Number(b.total||0),0);
      let badge=inArrears
        ? `<span style="background:var(--red);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px">🔴 ${g.arrearsCount} month${g.arrearsCount===1?"":"s"} behind</span>`
        : `<span style="background:var(--orange);color:#fff;font-size:9px;font-weight:800;padding:2px 8px;border-radius:99px">⏰ This month</span>`;
      let waBtn = t?.phone ? `<button class="btn btn-warn" style="font-size:10px;padding:4px 8px" onclick="sendOneOffReminder('${shownBills[0].id}')">💬 Remind</button>`:"";

      let rows=shownBills.map(b=>{
        let due=dueOf(b);
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--border)">
          <div style="min-width:0">
            <div style="font-weight:700;font-size:12px">${esc(b.monthLabel||"–")}</div>
            <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:1px">Due ${due?fmtDate(due):"–"} · ${statusChip(b)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <div style="font-weight:800;font-size:13px">${fmtMoney(b.total)}</div>
            <button class="btn btn-success" style="font-size:10px;padding:4px 8px" onclick="payFromPendingModal('${b.id}')">✓ Paid</button>
          </div>
        </div>`;
      }).join("");

      return `<div style="background:var(--s3);border:1px solid var(--border);border-left:3px solid ${accent};border-radius:var(--rs);padding:10px 12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div style="min-width:0">
            <div style="font-weight:800;font-size:13px">${esc(g.name)}${room}</div>
            <div style="margin-top:4px">${badge}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:9px;color:var(--text3);font-weight:600">${filter==="all"?"total owed":"shown"}</div>
            <div style="font-weight:800;font-size:16px;color:${accent}">${fmtMoney(filter==="all"?g.total:shownTotal)}</div>
            ${(filter==="all"&&inArrears)?`<div style="font-size:9px;color:var(--text3);font-weight:600;margin-top:1px">arrears ${fmtMoney(g.arrearsAmt)} + this mo ${fmtMoney(g.currentAmt)}</div>`:""}
          </div>
        </div>
        ${rows}
        ${waBtn?`<div style="margin-top:8px;text-align:right">${waBtn}</div>`:""}
      </div>`;
    }).join("");
  }
  document.getElementById("pending-modal-content").innerHTML=html;
  document.getElementById("pending-modal").classList.add("open");
};

// ── ITEM 2: Owner can edit tenant from Manage Tenants ────────
window.openOwnerEditTenant=async(id)=>{
  let t=await fbGetDoc("tenants",id);
  if(!t){ toast("Tenant not found","error"); return; }
  // Refresh property select first
  if(typeof populatePropertySelect==="function") await populatePropertySelect();
  // Pre-fill the existing ot-* fields and re-use the form
  sv("ot-name",t.name||"");
  sv("ot-room",t.room||"");
  sv("ot-rent",t.rent||"");
  sv("ot-maintenance",t.maintenance||"");
  sv("ot-dueday",t.dueDay||"");
  sv("ot-property",t.propertyId||"");
  sv("ot-security",t.securityDeposit||"");
  sv("ot-advance",t.advanceRentBalance!=null?t.advanceRentBalance:(t.advanceRent||""));
  sv("ot-phone",t.phone||"");
  sv("ot-alt",t.alt||"");
  sv("ot-email",t.email||"");
  sv("ot-address",t.address||"");
  sv("ot-idtype",t.idType||"");
  sv("ot-idnum",t.idNum||"");
  sv("ot-date",t.date||"");
  sv("ot-notes",t.notes||"");
  let bm=document.getElementById("ot-billmode"); if(bm) bm.value=t.billMode||"auto";
  // Populate other charges rows
  let ocCont=document.getElementById("ot-other-charges");
  if(ocCont){ ocCont.innerHTML=""; (t.otherCharges||[]).forEach(c=>window.addOtherChargeRow&&window.addOtherChargeRow(c.name,c.amount)); }
  window._editingTenantId = id;
  let btn=document.getElementById("add-tenant-btn");
  if(btn){
    btn.textContent="💾 Save Changes";
    btn.onclick=()=>saveOwnerEditedTenant();
  }
  let tabs=document.querySelectorAll(".t-tab");
  let addTab=Array.from(tabs).find(t=>t.textContent.includes("Add Tenant"));
  if(addTab) addTab.click();
  toast("Editing "+t.name+" — change fields and save","info");
};

window.saveOwnerEditedTenant=async()=>{
  let id=window._editingTenantId;
  if(!id){ ownerAddTenant(); return; }
  let name=g("ot-name"), room=g("ot-room"), rent=g("ot-rent");
  if(!name||!room||!rent){ toast("Name, Room and Rent are required","error"); return; }
  let upd={
    name, room, rent,
    maintenance:Number(g("ot-maintenance"))||0,
    dueDay:Number(g("ot-dueday"))||null,
    otherCharges:typeof getOtherCharges==="function"?getOtherCharges():(window.getOtherCharges?window.getOtherCharges():[]),
    propertyId: g("ot-property")||"",
    securityDeposit: Number(g("ot-security"))||0,
    advanceRentBalance: Number(g("ot-advance"))||0,
    phone:g("ot-phone"), alt:g("ot-alt"),
    email:g("ot-email").toLowerCase(),
    address:g("ot-address"),
    idType:g("ot-idtype"), idNum:g("ot-idnum"),
    date:g("ot-date"), notes:g("ot-notes"),
    billMode:g("ot-billmode")||"auto"
  };
  try{
    await fbUpdate("tenants",id,upd);
    toast(`✅ ${name} updated!`);
    window._editingTenantId=null;
    let btn=document.getElementById("add-tenant-btn");
    if(btn){
      btn.textContent="➕ Add Tenant";
      btn.onclick=()=>ownerAddTenant();
    }
    ["ot-name","ot-room","ot-rent","ot-maintenance","ot-dueday","ot-phone","ot-alt","ot-email","ot-address","ot-idtype","ot-idnum","ot-date","ot-notes","ot-security","ot-advance","ot-property"].forEach(i=>sv(i,""));
    let oc2=document.getElementById("ot-other-charges"); if(oc2) oc2.innerHTML="";
    let firstTab=document.querySelector(".t-tab"); if(firstTab) firstTab.click();
    await logActivity("Tenant Edited by Owner",`Name: ${name}`,"Owner");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.cancelOwnerEditTenant=()=>{
  window._editingTenantId=null;
  let btn=document.getElementById("add-tenant-btn");
  if(btn){
    btn.textContent="➕ Add Tenant";
    btn.onclick=()=>ownerAddTenant();
  }
  ["ot-name","ot-room","ot-rent","ot-maintenance","ot-dueday","ot-phone","ot-alt","ot-email","ot-address","ot-idtype","ot-idnum","ot-date","ot-notes"].forEach(i=>sv(i,""));
};

// ── ITEM 5: Admin Passkey Reset via OTP ──────────────────────
let _adminResetConfirm=null;
window.openAdminResetModal=()=>{
  document.getElementById("admin-reset-step1").style.display="block";
  document.getElementById("admin-reset-step2").style.display="none";
  document.getElementById("admin-reset-step3").style.display="none";
  document.getElementById("admin-reset-err").textContent="";
  // Pre-fill if a recovery phone was previously saved
  let savedPhone=localStorage.getItem("kb_admin_recovery_phone")||"";
  sv("admin-reset-phone",savedPhone);
  document.getElementById("admin-reset-modal").classList.add("open");
};

window.sendAdminResetOtp=async()=>{
  let phone=g("admin-reset-phone");
  let err=document.getElementById("admin-reset-err");
  err.textContent="";
  if(!phone||phone.replace(/[^0-9]/g,"").length<10){ err.textContent="Enter a valid phone number."; return; }
  let savedPhone=localStorage.getItem("kb_admin_recovery_phone");
  if(savedPhone && savedPhone.replace(/[^0-9]/g,"")!==phone.replace(/[^0-9]/g,"")){
    err.textContent="❌ This phone is not registered as the admin recovery phone.";
    return;
  }
  err.textContent="⏳ Sending OTP...";
  try{
    let {auth,fbAuth}=await setupRecaptcha("recaptcha-container-admin");
    let intl="+"+phone.replace(/[^0-9]/g,"");
    if(intl.length<=11) intl="+91"+phone.replace(/[^0-9]/g,"");
    _adminResetConfirm = await fbAuth.signInWithPhoneNumber(auth,intl,recaptchaVerifier);
    err.textContent="";
    document.getElementById("admin-reset-step1").style.display="none";
    document.getElementById("admin-reset-step2").style.display="block";
    toast("📨 OTP sent to "+intl,"info");
  }catch(e){
    console.error(e);
    err.textContent="❌ "+(e.message||"Could not send OTP")+". Ensure Firebase Phone Auth is enabled.";
  }
};

window.verifyAdminResetOtp=async()=>{
  let code=g("admin-reset-otp");
  let err=document.getElementById("admin-reset-err");
  if(!code||code.length<4){ err.textContent="Enter OTP."; return; }
  err.textContent="⏳ Verifying...";
  try{
    if(!_adminResetConfirm){ err.textContent="OTP session expired. Restart."; return; }
    await _adminResetConfirm.confirm(code);
    err.textContent="";
    document.getElementById("admin-reset-step2").style.display="none";
    document.getElementById("admin-reset-step3").style.display="block";
    toast("✅ Verified — set a new passkey","info");
  }catch(e){ err.textContent="❌ Invalid OTP."; }
};

window.doAdminPasskeyReset=async()=>{
  let np=g("admin-reset-newpass"), np2=g("admin-reset-newpass2");
  let err=document.getElementById("admin-reset-err");
  if(!np||np.length<6){ err.textContent="Passkey must be 6+ chars."; return; }
  if(np!==np2){ err.textContent="Passkeys don't match."; return; }
  // Store new admin passkey in localStorage (overrides hardcoded ADMIN_PASS)
  localStorage.setItem("kb_admin_passkey",np);
  let phone=g("admin-reset-phone");
  if(phone) localStorage.setItem("kb_admin_recovery_phone",phone);
  toast("✅ Admin passkey reset! Login with the new passkey.");
  closeModal("admin-reset-modal");
  try{ await logActivity("Admin Passkey Reset","Via OTP","Admin"); }catch(e){}
};

// ── WhatsApp Reminder Scheduler (Items 1-7 from the WhatsApp request) ──
// Schedule:
//   - 3 days before due:    1 reminder
//   - 2 days before due:    1 reminder
//   - 1 day before due:     1 reminder
//   - on due day:           2 reminders (morning ~9am, evening ~6pm)
//   - day 1 overdue onward: 3 reminders per day (morning, afternoon, evening)
//   - stops after 7 days overdue
//
// We can't truly auto-send (browser limitation), but we surface a "Reminders Due Now"
// list on the dashboard. The owner taps once and WhatsApp opens pre-filled.
// Each sent reminder is tracked per-bill so it doesn't show again the same slot.

function reminderSlotsForBill(bill, now){
  // Returns the list of slot keys that SHOULD have been sent up to `now`
  // Slot key format: "B3","B2","B1" (before due), "DM","DE" (due day), "O1M","O1A","O1E" (overdue day 1 morning/afternoon/evening), up to "O7E"
  if(!bill?.dueDate) return [];
  let due=new Date(bill.dueDate);
  due.setHours(0,0,0,0);
  let nowDay=new Date(now); nowDay.setHours(0,0,0,0);
  let diffDays=Math.round((nowDay-due)/(864e5)); // negative = before due, 0 = due day, positive = overdue
  let hour=now.getHours();
  let slots=[];
  // Pre-due
  if(diffDays<=-3) {} // nothing yet (will trigger when day count comes)
  if(diffDays>=-3) slots.push("B3");
  if(diffDays>=-2) slots.push("B2");
  if(diffDays>=-1) slots.push("B1");
  // Due day: morning ~ any time once past 8am, evening past 17h
  if(diffDays>=0){
    // On due day exactly (diff=0): morning at any hour after start of day; evening only after 17h
    // If we are past due day, both slots are valid
    if(diffDays===0){
      slots.push("DM");
      if(hour>=17) slots.push("DE");
    } else {
      slots.push("DM"); slots.push("DE");
    }
  }
  // Overdue days 1..7 with 3 slots each (M=morning 8+, A=afternoon 13+, E=evening 18+)
  for(let d=1; d<=7; d++){
    if(diffDays>=d){
      if(diffDays===d){
        slots.push(`O${d}M`);
        if(hour>=13) slots.push(`O${d}A`);
        if(hour>=18) slots.push(`O${d}E`);
      } else {
        slots.push(`O${d}M`); slots.push(`O${d}A`); slots.push(`O${d}E`);
      }
    }
  }
  return slots;
}

function slotLabel(slot){
  if(slot==="B3") return "3 days before due";
  if(slot==="B2") return "2 days before due";
  if(slot==="B1") return "1 day before due";
  if(slot==="DM") return "Due today (morning)";
  if(slot==="DE") return "Due today (evening)";
  if(slot.startsWith("O")){
    let m=slot.match(/O(\d)(M|A|E)/);
    if(m){
      let part = m[2]==="M"?"morning" : m[2]==="A"?"afternoon" : "evening";
      return `${m[1]} day${m[1]==="1"?"":"s"} overdue · ${part}`;
    }
  }
  return slot;
}

function reminderMessage(slot, name, amount, monthLabel){
  if(slot.startsWith("B")){
    let d=slot[1];
    return `Hi ${name}, this is a friendly reminder that your rent of ${amount} for ${monthLabel} is due in ${d} day${d==="1"?"":"s"}. Please plan to pay on time. — KiraaBook`;
  }
  if(slot.startsWith("D")){
    return `Hi ${name}, your rent of ${amount} for ${monthLabel} is DUE TODAY. Please pay at your earliest convenience. — KiraaBook`;
  }
  if(slot.startsWith("O")){
    let m=slot.match(/O(\d)/);
    let d=m?m[1]:"";
    return `Hi ${name}, ⚠️ your rent of ${amount} for ${monthLabel} is overdue by ${d} day${d==="1"?"":"s"}. Please pay immediately. — KiraaBook`;
  }
  return `Hi ${name}, please pay your pending rent of ${amount}. — KiraaBook`;
}

window.computeDueReminders=()=>{
  // For each unpaid bill, find the latest pending slot (not yet sent)
  let now=new Date();
  let list=[];
  bills.forEach(b=>{
    if(b.status==="paid"||!b.dueDate) return;
    let t=tenants.find(x=>x.id===b.tenantId);
    if(!t||!t.phone||t.active===false) return;
    let due=new Date(b.dueDate); due.setHours(0,0,0,0);
    let nowDay=new Date(now); nowDay.setHours(0,0,0,0);
    let diffDays=Math.round((nowDay-due)/(864e5));
    if(diffDays>7) return; // stop after 7 days overdue
    let allSlots=reminderSlotsForBill(b, now);
    let sentSlots = b.sentReminderSlots || [];
    let pendingSlots = allSlots.filter(s=>!sentSlots.includes(s));
    if(!pendingSlots.length) return;
    // Show only the most recent pending slot per bill (avoids spamming with backlog)
    let slot = pendingSlots[pendingSlots.length-1];
    list.push({
      bill:b, tenant:t, slot,
      sentCount: sentSlots.length,
      label: slotLabel(slot)
    });
  });
  return list;
};

window.renderScheduledReminders=()=>{
  let sec=document.getElementById("reminders-section");
  let listEl=document.getElementById("reminders-list");
  if(!sec||!listEl) return;
  let st=checkTrialStatus(currentOwnerData);
  if(st.expired){ sec.style.display="none"; return; }
  let due=computeDueReminders();
  if(!due.length){ sec.style.display="none"; return; }
  sec.style.display="block";
  listEl.innerHTML=due.map(r=>{
    return `<div class="reminder-card">
      <div class="reminder-info">
        <div style="font-weight:700;font-size:12px">${esc(r.tenant.name)} — Room ${esc(r.tenant.room||"–")}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">⏰ ${esc(r.label)} · ${fmtMoney(r.bill.total)} · ${esc(r.bill.monthLabel||"")}</div>
        <div style="font-size:9px;color:var(--blue);margin-top:2px;font-weight:600">📊 ${r.sentCount} reminder${r.sentCount===1?"":"s"} sent so far</div>
      </div>
      <button class="btn btn-warn" onclick="sendScheduledReminder('${r.bill.id}','${r.slot}')">💬 Send Now</button>
    </div>`;
  }).join("");
};

window.sendScheduledReminder=async(billId, slot)=>{
  let b=bills.find(x=>x.id===billId);
  if(!b){ toast("Bill not found","error"); return; }
  let t=tenants.find(x=>x.id===b.tenantId);
  if(!t||!t.phone){ toast("Tenant has no phone number","error"); return; }
  let msg=reminderMessage(slot, t.name, fmtMoney(b.total), b.monthLabel||"this month");
  let phoneClean=t.phone.replace(/[^0-9]/g,"");
  // Add country code if missing (default +91 — owner can edit before sending in WhatsApp)
  let phoneIntl = phoneClean.length<=10 ? "91"+phoneClean : phoneClean;
  let url=`https://wa.me/${phoneIntl}?text=${encodeURIComponent(msg)}`;
  window.open(url,"_blank");
  // Record the slot as sent
  let sent = b.sentReminderSlots || [];
  if(!sent.includes(slot)) sent.push(slot);
  let log = b.reminderLog || [];
  log.push({slot, sentOn:new Date().toISOString(), kind:"whatsapp"});
  try{
    await fbUpdate("bills",billId,{
      sentReminderSlots:sent,
      reminderLog:log,
      lastReminded:new Date().toISOString()
    });
    toast("✅ Reminder sent ("+slotLabel(slot)+")","info");
    await logActivity("Rent Reminder Sent",`Tenant: ${t.name}, Slot: ${slotLabel(slot)}, Amount: ${fmtMoney(b.total)}`,"Owner");
  }catch(e){ toast("Error logging reminder","error"); }
};

window.sendOneOffReminder=async(billId)=>{
  let b=bills.find(x=>x.id===billId);
  if(!b){ toast("Bill not found","error"); return; }
  let t=tenants.find(x=>x.id===b.tenantId);
  if(!t||!t.phone){ toast("No phone for this tenant","error"); return; }
  let now=new Date();
  let slots=reminderSlotsForBill(b, now);
  let slot=slots.length?slots[slots.length-1]:"DM";
  await sendScheduledReminder(billId, slot);
};

window.sendAllDueReminders=async()=>{
  let due=computeDueReminders();
  if(!due.length){ toast("No reminders due right now","info"); return; }
  toast(`📨 Opening ${due.length} WhatsApp tabs...`,"info");
  for(let i=0;i<due.length;i++){
    setTimeout(()=>sendScheduledReminder(due[i].bill.id, due[i].slot), i*800);
  }
};

// Override the old renderRemindersSection to use scheduler
window.renderRemindersSection=window.renderScheduledReminders;
// Override sendAllReminders to use scheduled version
window.sendAllReminders=window.sendAllDueReminders;

// ── PDF amount fix (item 1) ─────────────────────────────────
// Patch downloadBillPdf to use fmtMoney consistently
// Find original then wrap
let _originalDownloadBillPdf = window.downloadBillPdf;
window.downloadBillPdf = async(billId)=>{
  let b = await fbGetDoc("bills",billId);
  if(!b){ toast("Bill not found","error"); return; }
  let t = await fbGetDoc("tenants",b.tenantId);
  let owner = b.ownerID ? await fbGetDoc("owners",b.ownerID) : null;
  if(!window.jspdf){ toast("PDF library not loaded","error"); return; }
  let {jsPDF} = window.jspdf;
  let pdf = new jsPDF();
  // Header
  pdf.setFillColor(15,23,42);
  pdf.rect(0,0,210,30,"F");
  pdf.setTextColor(245,166,35);
  pdf.setFontSize(20); pdf.setFont("helvetica","bold");
  pdf.text("KiraaBook · Rent Invoice",105,15,{align:"center"});
  pdf.setFontSize(9); pdf.setTextColor(200,200,200);
  pdf.text("Smart Rental Management",105,22,{align:"center"});
  pdf.setTextColor(30,30,30);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(11);
  let y=42;
  pdf.setFont("helvetica","bold"); pdf.text("Invoice For",15,y); pdf.text("From",115,y);
  pdf.setFont("helvetica","normal");
  pdf.text(`${t?.name||b.tenantName||"–"}`,15,y+6);
  pdf.text(`Room: ${t?.room||"–"}`,15,y+12);
  pdf.text(`Phone: ${t?.phone||"–"}`,15,y+18);
  if(t?.email) pdf.text(`Email: ${t.email}`,15,y+24);
  pdf.text(`${owner?.name||"Property Owner"}`,115,y+6);
  if(owner?.phone) pdf.text(`Phone: ${owner.phone}`,115,y+12);
  if(owner?.email) pdf.text(`Email: ${owner.email}`,115,y+18);
  y=80;
  pdf.setFont("helvetica","bold"); pdf.setFontSize(12);
  pdf.text(`Bill for: ${b.monthLabel||"–"}`,15,y);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(10);
  pdf.text(`Due date: ${fmtDate(b.dueDate)}`,15,y+6);
  pdf.text(`Status: ${b.status==="paid"?"PAID":"PENDING"}`,15,y+12);
  if(b.paidOn) pdf.text(`Paid on: ${b.paidOn}`,15,y+18);
  // FIX: ASCII fallback for currency to avoid encoding bugs in jsPDF default font
  // jsPDF's default Helvetica doesn't render ₹ or many Unicode currency symbols correctly,
  // which is why amounts looked wrong. Use plain "Rs. X" or "USD X" style.
  let curName = ({"₹":"Rs.","$":"USD","€":"EUR","£":"GBP","¥":"JPY","A$":"AUD","C$":"CAD","₽":"RUB","﷼":"SAR","د.إ":"AED"})[CURRENCY] || CURRENCY;
  let pdfMoney = (v)=>`${curName} ${Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
  let items = (b.items||[]).map(i=>[ String(i.name||""), pdfMoney(i.amount) ]);
  if(items.length && pdf.autoTable){
    pdf.autoTable({
      startY:y+24,
      head:[["Item","Amount"]],
      body:items,
      foot:[["TOTAL", pdfMoney(b.total)]],
      theme:"grid",
      headStyles:{fillColor:[15,23,42],textColor:[245,166,35],fontStyle:"bold"},
      footStyles:{fillColor:[245,166,35],textColor:[0,0,0],fontStyle:"bold",fontSize:11},
      styles:{fontSize:10,cellPadding:4}
    });
  } else {
    // Fallback if autotable missing: simple text
    pdf.text("Total: "+pdfMoney(b.total), 15, y+30);
  }
  let pageH = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(8); pdf.setTextColor(120,120,120);
  pdf.text(`Generated by KiraaBook on ${new Date().toLocaleString()}`,105,pageH-10,{align:"center"});
  pdf.text(`Bill ID: ${b.id}`,105,pageH-6,{align:"center"});
  stampPdfReference(pdf, { type:"invoice" });
  let fname=`kiraabook-bill-${(b.monthLabel||"bill").replace(/\s+/g,"-")}-${(t?.name||"tenant").replace(/\s+/g,"-")}.pdf`;
  pdf.save(fname);
  toast("📥 PDF downloaded","info");
};

// Also patch downloadAllTenantBillsPdf with the same currency fix
let _origAllPdf = window.downloadAllTenantBillsPdf;
window.downloadAllTenantBillsPdf = async()=>{
  let t = tenants.find(x=>x.id===currentTenantId);
  if(!t){ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }
  if(!t){ toast("Session expired","error"); return; }
  let allBills = await fbGet("bills");
  let myBills = allBills.filter(b=>b.tenantId===t.id).sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
  if(!myBills.length){ toast("No bills to download","info"); return; }
  let {jsPDF}=window.jspdf;
  let pdf=new jsPDF();
  pdf.setFillColor(15,23,42); pdf.rect(0,0,210,30,"F");
  pdf.setTextColor(245,166,35);
  pdf.setFontSize(20); pdf.setFont("helvetica","bold");
  pdf.text("KiraaBook · Bills Summary",105,15,{align:"center"});
  pdf.setFontSize(10); pdf.setTextColor(200,200,200);
  pdf.text(`${t.name} · Room ${t.room||"–"}`,105,22,{align:"center"});
  pdf.setTextColor(30,30,30);
  let curName = ({"₹":"Rs.","$":"USD","€":"EUR","£":"GBP","¥":"JPY","A$":"AUD","C$":"CAD","₽":"RUB","﷼":"SAR","د.إ":"AED"})[CURRENCY] || CURRENCY;
  let pdfMoney = (v)=>`${curName} ${Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2})}`;
  let rows = myBills.map(b=>[
    b.monthLabel||"–",
    fmtDate(b.dueDate),
    pdfMoney(b.total),
    b.status==="paid"?"PAID":(getBillStatus(b)==="overdue"?"OVERDUE":"PENDING"),
    b.paidOn||"–"
  ]);
  if(pdf.autoTable){
    pdf.autoTable({
      startY:38,
      head:[["Month","Due Date","Amount","Status","Paid On"]],
      body:rows,
      theme:"striped",
      headStyles:{fillColor:[15,23,42],textColor:[245,166,35]},
      styles:{fontSize:9,cellPadding:3}
    });
  }
  let pageH=pdf.internal.pageSize.getHeight();
  pdf.setFontSize(8); pdf.setTextColor(120,120,120);
  pdf.text(`Generated by KiraaBook on ${new Date().toLocaleString()}`,105,pageH-10,{align:"center"});
  stampPdfReference(pdf, { type:"summary" });
  pdf.save(`kiraabook-bills-${t.name.replace(/\s+/g,"-")}.pdf`);
  toast("📥 PDF downloaded","info");
};

// ── Override adminLogin to support new passkey from localStorage ──
let _origAdminLogin = window.adminLogin;
window.adminLogin = async()=>{
  let p=document.getElementById("admin-pass").value;
  let storedPasskey = localStorage.getItem("kb_admin_passkey");
  let validPass = storedPasskey || ADMIN_PASS;
  if(p===validPass || p===ADMIN_PASS){
    document.getElementById("admin-pass").value="";
    document.getElementById("admin-err").textContent="";
    localStorage.setItem("kb_admin_session","1");
    show("screen-admin");
    initAdmin();
    try{ await logActivity("Admin Login","Admin panel accessed","Admin"); }catch(e){}
  } else {
    document.getElementById("admin-err").textContent="❌ Wrong admin passkey!";
    document.getElementById("admin-pass").value="";
  }
};

// ═════════════════════════════════════════════════════════════
// v11 ROUND 4: SOCIAL SIGN-IN (Google, Facebook, LinkedIn-soon)
// ═════════════════════════════════════════════════════════════
//
// Setup required in Firebase Console:
//   1. Authentication → Sign-in method → enable "Google" (works immediately)
//   2. For Facebook: create FB app at developers.facebook.com,
//      add "Facebook Login" product, get App ID + Secret,
//      paste into Firebase Console → Facebook provider, add OAuth redirect URI shown.
//   3. LinkedIn is not natively supported by Firebase — shown as "coming soon".

async function _socialSignIn(providerName){
  try{
    const fbAuth = await import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js");
    let auth = fbAuth.getAuth(fapp);
    let provider;
    if(providerName==="google"){
      provider = new fbAuth.GoogleAuthProvider();
      provider.addScope("email");
      provider.addScope("profile");
    } else if(providerName==="facebook"){
      provider = new fbAuth.FacebookAuthProvider();
      provider.addScope("email");
    } else {
      throw new Error("Unsupported provider: "+providerName);
    }
    let result = await fbAuth.signInWithPopup(auth, provider);
    return result.user; // { uid, displayName, email, photoURL, phoneNumber }
  }catch(e){
    console.error("Social sign-in error:", e);
    throw e;
  }
}

async function _handleSocialOwner(fbUser, providerName){
  if(!fbUser){ toast("Sign-in cancelled","error"); return; }
  let email = (fbUser.email||"").toLowerCase();
  let name = fbUser.displayName || (email ? email.split("@")[0] : "Owner");
  let photo = fbUser.photoURL || "";
  let providerUid = fbUser.uid;
  // Find existing owner by providerUid OR by email
  let owners;
  try{ owners = await fbGet("owners"); }
  catch(e){ toast("Connection error","error"); return; }
  let existing = owners.find(o=>
    (o.providerUid && o.providerUid===providerUid) ||
    (email && (o.email||"").toLowerCase()===email)
  );
  if(existing){
    // Login as existing owner
    if(existing.active===false){ toast("⛔ This account is deactivated. Contact admin.","error"); return; }
    // Backfill missing fields
    let updates={};
    if(!existing.providerUid){ updates.providerUid = providerUid; updates.provider = providerName; }
    if(!existing.profilePic && photo){ updates.profilePic = photo; }
    if(Object.keys(updates).length){
      try{ await fbUpdate("owners", existing.id, updates); Object.assign(existing, updates); }catch(e){}
    }
    currentOwnerData = existing;
    localStorage.setItem("kb_owner_id", existing.oid||existing.id);
    localStorage.setItem("kb_owner_name", existing.name||name);
    localStorage.setItem("kb_owner_user", existing.username||email);
    show("screen-owner");
    initOwner();
    toast(`👋 Welcome back, ${existing.name||name}!`);
    try{ await logActivity(`Owner Login (${providerName})`,`Email: ${email}`,existing.name||name); }catch(e){}
    return;
  }
  // New owner — create record. Username = email prefix (or sanitized name).
  let baseUsername = (email ? email.split("@")[0] : name).toLowerCase().replace(/[^a-z0-9]/g,"");
  if(baseUsername.length<3) baseUsername = "owner"+Math.floor(Math.random()*9999);
  let username = baseUsername;
  let suffix=1;
  while(owners.find(o=>o.username===username)){
    username = baseUsername+suffix; suffix++;
    if(suffix>50) break;
  }
  let now=new Date();
  let exp=new Date(); exp.setDate(exp.getDate()+30);
  let oid=genUID();
  let ownerData={
    oid, name, username,
    password:"",            // No password for social-only accounts
    provider: providerName,
    providerUid,
    phone:"", email,
    profilePic: photo,
    plan:"trial", subExpiry:exp.toISOString(),
    trialUsed:true, trialStartDate:now.toISOString(),
    active:true, free:true,
    createdOn:now.toLocaleDateString("en-IN"),
    tenantCount:0
  };
  try{
    await fbSet("owners",oid,ownerData);
    localStorage.setItem("kb_owner_id",oid);
    localStorage.setItem("kb_owner_name",name);
    localStorage.setItem("kb_owner_user",username);
    currentOwnerData=ownerData;
    show("screen-owner");
    initOwner();
    toast(`🎉 Welcome ${name}! Your free trial is active.`);
    try{ await logActivity(`Owner Created (${providerName})`,`Name: ${name}, Email: ${email}`,name); }catch(e){}
    // Prompt them to add their phone (needed for OTP password reset later)
    setTimeout(()=>{
      if(!ownerData.phone){
        toast("💡 Tip: Add your phone number from My Account → Edit Profile for password recovery","info");
      }
    },3500);
  }catch(e){
    console.error(e);
    toast("Error creating account: "+(e.message||"unknown"),"error");
  }
}

window.signInWithGoogle = async()=>{
  try{
    let user = await _socialSignIn("google");
    await _handleSocialOwner(user, "google");
  }catch(e){
    let msg;
    if(e.code==="auth/popup-closed-by-user") msg = "Sign-in cancelled.";
    else if(e.code==="auth/popup-blocked") msg = "Pop-up was blocked. Allow pop-ups for this site and try again.";
    else if(e.code==="auth/operation-not-allowed" || e.code==="auth/configuration-not-found"){
      alert("⚠️ Google Sign-In Setup Required\n\nGoogle sign-in is not enabled in your Firebase Console yet. To enable:\n\n1. Open https://console.firebase.google.com/project/kiraabook-326bc/authentication/providers\n2. Click 'Google' provider\n3. Toggle 'Enable' → choose a support email → Save\n4. Wait 30 seconds, then refresh this page and try again.\n\nNo code changes needed — just that one toggle.");
      msg = "Enable Google in Firebase Console (see popup)";
    }
    else if(e.code==="auth/unauthorized-domain") msg = "❌ This domain is not authorized. Add it in Firebase Console → Authentication → Settings → Authorized domains.";
    else msg = "Google sign-in failed: "+(e.message||e.code||"unknown");
    toast(msg, "error");
  }
};

window.signInWithFacebook = async()=>{
  try{
    let user = await _socialSignIn("facebook");
    await _handleSocialOwner(user, "facebook");
  }catch(e){
    let msg;
    if(e.code==="auth/popup-closed-by-user") msg = "Sign-in cancelled.";
    else if(e.code==="auth/popup-blocked") msg = "Pop-up was blocked. Allow pop-ups for this site and try again.";
    else if(e.code==="auth/operation-not-allowed" || e.code==="auth/configuration-not-found"){
      alert("⚠️ Facebook Sign-In Setup Required\n\nFacebook sign-in needs setup in BOTH Facebook Developer Console and Firebase:\n\n1. Create app at https://developers.facebook.com → 'Consumer' type\n2. Add 'Facebook Login' product\n3. From Settings → Basic, copy App ID + App Secret\n4. Open https://console.firebase.google.com/project/kiraabook-326bc/authentication/providers\n5. Enable Facebook provider → paste App ID + App Secret\n6. Firebase shows an 'OAuth redirect URI' — copy it\n7. In Facebook App → Facebook Login → Settings → paste it in 'Valid OAuth Redirect URIs'\n\nFor testing your own login (you as app developer) works immediately. To allow other users, submit the app for Facebook App Review.\n\nFor now, use Google sign-in (much easier) or username + password.");
      msg = "Setup Facebook in Firebase Console (see popup)";
    }
    else if(e.code==="auth/account-exists-with-different-credential") msg = "An account with this email exists with a different sign-in method. Try Google or username/password.";
    else msg = "Facebook sign-in failed: "+(e.message||e.code||"unknown");
    toast(msg, "error");
  }
};

// LinkedIn removed in v13

// ── Cross-module exports ──────────────────────────────────────
// These are plain function declarations inside this module. Every other
// module (owner.js, auth.js, tenant.js, admin.js, maintenance.js) calls
// them as bare names via the global object, so they must be on window.
window.pushNotification           = pushNotification;
window.subscribeOwnerNotifications = subscribeOwnerNotifications;
window.subscribeRoomHistory       = subscribeRoomHistory;
window.recordRoomHistoryEntry     = recordRoomHistoryEntry;
window.closeRoomHistoryEntry      = closeRoomHistoryEntry;
// AG-grid helpers used by admin.js
window.renderFallbackTable        = renderFallbackTable;
window.initAGGrid                 = initAGGrid;

