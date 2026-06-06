import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, DB_COLLS, collection, getDocs, query, orderBy, limit, doc } from './firebase.js';
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, escAttr, closeModal, genUID, daysBetween } from './helpers.js';

// ── ADMIN ─────────────────────────────────────────────────────
async function initAdmin(){
  await loadAdminStats();
  await loadAdminOwners();
  populateOwnerFilters();
  try{ refreshSupportBadge(); }catch(e){}
}
async function loadAdminStats(){
  try{
    let [tens,bls,owns]=await Promise.all([fbGet("tenants"),fbGet("bills"),fbGet("owners")]);
    document.getElementById("a-owners").textContent=owns.length;
    document.getElementById("a-tenants").textContent=tens.length;
    document.getElementById("a-trial").textContent=owns.filter(o=>o.plan==="trial").length;
    document.getElementById("a-bills").textContent=bls.length;
  }catch(e){}
}

async function populateOwnerFilters(){
  let owns=await fbGet("owners");
  let filters=["admin-tenant-owner-filter","admin-bill-owner-filter"];
  filters.forEach(fid=>{
    let sel=document.getElementById(fid);
    if(!sel) return;
    let cur=sel.value;
    sel.innerHTML=`<option value="">All Owners</option>`+
      owns.map(o=>`<option value="${o.oid||o.id}">${esc(o.name)} (${esc(o.oid||o.id.slice(0,6))})</option>`).join("");
    sel.value=cur;
  });
}

window.loadAdminOwners=async()=>{
  let q=(document.getElementById("admin-owner-search")?.value||"").trim().toLowerCase();
  let owns=await fbGet("owners");
  let [tens]=await Promise.all([fbGet("tenants")]);
  let filt=owns.filter(o=>{
    if(!q) return true;
    let blob=((o.oid||"")+" "+(o.name||"")+" "+(o.username||"")+" "+(o.phone||"")+" "+(o.email||"")).toLowerCase();
    return blob.includes(q);
  });
  let tbody=document.getElementById("admin-owners-tbody");
  if(!tbody) return;
  if(!filt.length){ tbody.innerHTML=`<tr><td colspan="11" style="text-align:center;padding:20px;color:var(--text3)">No owners found</td></tr>`; return; }
  tbody.innerHTML=filt.map(o=>{
    let st=checkTrialStatus(o);
    let statusBadge = !o.active ? `<span style="color:var(--red);font-weight:700">⛔ Inactive</span>`
      : st.expired ? `<span style="color:var(--red);font-weight:700">⛔ Expired</span>`
      : st.isTrial && st.daysLeft<=7 ? `<span style="color:var(--orange);font-weight:700">⚠️ ${st.daysLeft}d left</span>`
      : `<span style="color:var(--green);font-weight:700">✅ Active</span>`;
    let tCount=tens.filter(t=>t.ownerID===(o.oid||o.id)).length;
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px">${esc(o.oid||o.id.slice(0,8))}</td>
      <td>${esc(o.name||"–")}</td>
      <td>${esc(o.username||"–")}</td>
      <td>${esc(o.phone||"–")}</td>
      <td style="font-size:10px">${esc(o.email||"–")}</td>
      <td><span class="key-badge ${o.plan==="annual"?"kb-a":o.plan==="lifetime"?"kb-l":o.plan==="trial"?"kb-t":"kb-m"}">${esc(o.plan||"–")}</span></td>
      <td>${o.plan==="lifetime"?"Never":fmtDate(o.subExpiry)}</td>
      <td>${tCount}</td>
      <td>${o.trialUsed?"Yes":"No"}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="openOwnerDetailModal('${o.id}')">👁</button>
        <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="editOwner('${o.id}')">✏️</button>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteOwner('${o.id}','${escAttr(o.name)}')">🗑</button>
      </td>
    </tr>`;
  }).join("");
};

window.openOwnerDetailModal=async(id)=>{
  let o=await fbGetDoc("owners",id);
  if(!o){ toast("Owner not found","error"); return; }
  let [tens,bls,claims]=await Promise.all([fbGet("tenants"),fbGet("bills"),fbGet("paymentClaims")]);
  let oid=o.oid||o.id;
  let myT=tens.filter(t=>t.ownerID===oid);
  let myB=bls.filter(b=>b.ownerID===oid);
  let myC=claims.filter(c=>c.ownerID===oid);
  let paidBills=myB.filter(b=>b.status==="paid").length;
  let totalCollected=myB.filter(b=>b.status==="paid").reduce((s,b)=>s+Number(b.total||0),0);
  let st=checkTrialStatus(o);
  let rows=[
    ["Owner ID",o.oid||o.id],
    ["Full Name",o.name||"–"],
    ["Username",o.username||"–"],
    ["Phone",o.phone||"–"],
    ["Email",o.email||"–"],
    ["Plan",o.plan||"–"],
    ["Created On",o.createdOn||"–"],
    ["Subscription Expires",fmtDate(o.subExpiry)],
    ["Status", o.active?(st.expired?"Expired":st.isTrial?`Trial (${st.daysLeft} days left)`:"Active"):"Deactivated"],
    ["Trial Used", o.trialUsed?"Yes":"No"],
    ["Trial Start", o.trialStartDate?fmtDate(o.trialStartDate):"–"],
    ["Free Account", o.free?"Yes":"No"],
    ["Total Tenants", myT.length],
    ["Approved Tenants", myT.filter(t=>t.approved).length],
    ["Pending Approval", myT.filter(t=>!t.approved).length],
    ["Total Bills Created", myB.length],
    ["Bills Paid", paidBills],
    ["Total Collected", fmtMoney(totalCollected)],
    ["Payment Claims", myC.length],
    ["Approved Claims", myC.filter(c=>c.status==="approved").length]
  ];
  let html=rows.map(([l,v])=>`<div class="od-row"><span class="od-label">${l}</span><span class="od-value">${esc(v)}</span></div>`).join("");
  // Add tenant list
  if(myT.length){
    html+=`<div style="margin-top:14px"><div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Tenants Under This Owner</div>`;
    html+=`<div style="max-height:200px;overflow-y:auto">${myT.map(t=>`
      <div style="background:var(--s3);border-radius:var(--rs);padding:8px 10px;margin-bottom:6px;font-size:11px;display:flex;justify-content:space-between">
        <span><strong>${esc(t.name)}</strong> · Room ${esc(t.room||"–")}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3)">${esc(t.tid||t.id.slice(0,8))}</span>
      </div>`).join("")}</div></div>`;
  }
  document.getElementById("owner-detail-content").innerHTML=html;
  document.getElementById("owner-detail-modal").classList.add("open");
};

window.editOwner=async(id)=>{
  let o=await fbGetDoc("owners",id);
  if(!o) return;
  document.getElementById("owner-edit-form").style.display="block";
  sv("edit-owner-id",id);
  sv("edit-owner-name",o.name);
  sv("edit-owner-username",o.username);
  sv("edit-owner-phone",o.phone||"");
  sv("edit-owner-email",o.email||"");
  sv("edit-owner-pass","");
  document.getElementById("edit-owner-plan").value=o.plan||"monthly";
  sv("edit-owner-expiry", o.subExpiry?o.subExpiry.split("T")[0]:"");
  document.getElementById("edit-owner-trialused").value=o.trialUsed?"true":"false";
  document.getElementById("owner-edit-form").scrollIntoView({behavior:"smooth"});
};
window.cancelOwnerEdit=()=>{ document.getElementById("owner-edit-form").style.display="none"; };
window.saveOwnerEdit=async()=>{
  let id=g("edit-owner-id");
  let upd={
    name:g("edit-owner-name"),
    username:g("edit-owner-username").toLowerCase(),
    phone:g("edit-owner-phone"),
    email:g("edit-owner-email").toLowerCase(),
    plan:document.getElementById("edit-owner-plan").value,
    trialUsed: document.getElementById("edit-owner-trialused").value==="true"
  };
  let np=g("edit-owner-pass"); if(np) upd.password=np;
  let exp=g("edit-owner-expiry"); if(exp) upd.subExpiry=new Date(exp).toISOString();
  await fbUpdate("owners",id,upd);
  toast("✅ Owner updated!");
  cancelOwnerEdit();
  await loadAdminOwners();
  await logActivity("Owner Edited",`Name: ${upd.name}`,"Admin");
};
window.deleteOwner=async(id,name)=>{
  if(!confirm(`Delete owner "${name}"? This will NOT delete their tenants. Continue?`)) return;
  await fbDel("owners",id);
  toast(`🗑 Owner ${name} deleted`);
  await loadAdminOwners();
  await loadAdminStats();
  await logActivity("Owner Deleted",`Name: ${name}`,"Admin");
};

// ── ADMIN TENANTS ─────────────────────────────────────────────
window.loadAdminTenants=async()=>{
  let q=(document.getElementById("admin-tenant-search")?.value||"").trim().toLowerCase();
  let oFilter=document.getElementById("admin-tenant-owner-filter")?.value||"";
  let [tens,owns]=await Promise.all([fbGet("tenants"),fbGet("owners")]);
  let ownerMap={};
  owns.forEach(o=>{ ownerMap[o.oid||o.id]={name:o.name,oid:o.oid||o.id}; });
  let filt=tens.filter(t=>{
    if(oFilter && t.ownerID!==oFilter) return false;
    if(!q) return true;
    let blob=((t.tid||"")+" "+(t.name||"")+" "+(t.room||"")+" "+(t.phone||"")+" "+(t.email||"")).toLowerCase();
    return blob.includes(q);
  });
  let rowData=filt;
  let tbody=document.getElementById("admin-tenants-tbody");
  if(!tbody) return;
  if(!filt.length){ tbody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text3)">No tenants found</td></tr>`; return; }
  tbody.innerHTML=filt.map(t=>{
    let ownInfo=t.ownerID?ownerMap[t.ownerID]:null;
    let ownLabel = ownInfo ? `${esc(ownInfo.name)}<br><span style="font-size:9px;color:var(--text3);font-family:'JetBrains Mono',monospace">${esc(ownInfo.oid)}</span>` : `<span style="color:var(--text3)">–</span>`;
    let active = t.active!==false;
    let statusBadge = !active ? `<span style="color:var(--red);font-weight:700">⛔ Deactivated</span>`
      : (t.approved ? `<span style="color:var(--green);font-weight:700">✅ Approved</span>` : `<span style="color:var(--orange);font-weight:700">⏳ Pending</span>`);
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px">${esc(t.tid||t.id.slice(0,8))}</td>
      <td>${esc(t.name||"–")}</td>
      <td>${esc(t.room||"–")}</td>
      <td>${fmtMoney(t.rent)}</td>
      <td>${esc(t.phone||"–")}</td>
      <td style="font-size:10px">${esc(t.email||"–")}</td>
      <td>${ownLabel}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="editTenant('${t.id}')">✏️</button>
        <button class="btn btn-warn" style="padding:3px 8px;font-size:10px" title="${active?'Deactivate':'Reactivate'}" onclick="toggleTenantActive('${t.id}','${escAttr(t.name)}',${active})">${active?'⏸':'▶'}</button>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteTenantAdmin('${t.id}','${escAttr(t.name)}')">🗑</button>
      </td>
    </tr>`;
  }).join("");
};

window.toggleTenantActive=async(id,name,curActive)=>{
  let action = curActive ? "Deactivate" : "Reactivate";
  if(!confirm(`${action} tenant "${name}"?`)) return;
  let t=await fbGetDoc("tenants",id);
  let upd={active:!curActive};
  if(curActive){ upd.approved=false; }
  await fbUpdate("tenants",id,upd);
  if(curActive && t && t.room && t.ownerID){
    await closeRoomHistoryEntry(id, t.ownerID, "Deactivated by admin/owner");
  } else if(!curActive && t && t.room && t.ownerID){
    await recordRoomHistoryEntry(id, t.name, t.room, t.rent, t.ownerID, t.date);
  }
  toast(`${curActive?"⏸ Deactivated":"▶ Reactivated"}`);
  loadAdminTenants();
  await logActivity(`Tenant ${action}d`, `Name: ${name}`, "Admin");
};

window.editTenant=async(id)=>{
  let t=await fbGetDoc("tenants",id);
  if(!t)return;
  document.getElementById("tenant-edit-form").style.display="block";
  sv("edit-tenant-id",id);
  sv("edit-tenant-name",t.name);
  sv("edit-tenant-room",t.room);
  sv("edit-tenant-rent",t.rent);
  sv("edit-tenant-phone",t.phone);
  sv("edit-tenant-email",t.email||"");
  document.getElementById("edit-tenant-idtype").value=t.idType||"";
  sv("edit-tenant-idnum",t.idNum);
  sv("edit-tenant-address",t.address);
  sv("edit-tenant-notes",t.notes);
  document.getElementById("edit-tenant-billmode").value=t.billMode||"auto";
  document.getElementById("edit-tenant-approved").value=t.approved?"true":"false";
  sv("edit-tenant-newpass","");
  sv("edit-tenant-newpass2","");
  document.getElementById("tenant-edit-form").scrollIntoView({behavior:"smooth"});
};
window.cancelTenantEdit=()=>{ document.getElementById("tenant-edit-form").style.display="none"; };
window.saveTenantEdit=async()=>{
  let id=g("edit-tenant-id");
  let np=g("edit-tenant-newpass"), np2=g("edit-tenant-newpass2");
  if(np||np2){
    if(np.length<6){ toast("Password must be 6+ chars","error"); return; }
    if(np!==np2){ toast("Passwords don't match","error"); return; }
  }
  let upd={
    name:g("edit-tenant-name"),
    room:g("edit-tenant-room"),
    rent:g("edit-tenant-rent"),
    phone:g("edit-tenant-phone"),
    email:g("edit-tenant-email").toLowerCase(),
    idType:g("edit-tenant-idtype"),
    idNum:g("edit-tenant-idnum"),
    address:g("edit-tenant-address"),
    notes:g("edit-tenant-notes"),
    billMode:document.getElementById("edit-tenant-billmode").value,
    approved:document.getElementById("edit-tenant-approved").value==="true"
  };
  if(np) upd.password=np;
  await fbUpdate("tenants",id,upd);
  toast("✅ Tenant updated"+(np?" (password reset)":"")+"!");
  cancelTenantEdit();
  await loadAdminTenants();
  await logActivity("Tenant Edited"+(np?" (Password Reset)":""),`Name: ${upd.name}`,"Admin");
};
window.deleteTenantAdmin=async(id,name)=>{
  if(!confirm(`Delete tenant "${name}"? Cannot be undone.`)) return;
  await fbDel("tenants",id);
  toast(`🗑 Deleted`);
  await loadAdminTenants();
  await loadAdminStats();
  await logActivity("Tenant Deleted (Admin)",`Name: ${name}`,"Admin");
};

// ── ADMIN BILLS ───────────────────────────────────────────────
window.loadAdminBills=async()=>{
  let q=(document.getElementById("admin-bill-search")?.value||"").trim().toLowerCase();
  let oFilter=document.getElementById("admin-bill-owner-filter")?.value||"";
  let [bls,owns]=await Promise.all([fbGet("bills"),fbGet("owners")]);
  let ownerMap={};
  owns.forEach(o=>{ ownerMap[o.oid||o.id]={name:o.name,oid:o.oid||o.id}; });
  let filt=bls.filter(b=>{
    if(oFilter && b.ownerID!==oFilter) return false;
    if(!q) return true;
    let ownInfo=b.ownerID?ownerMap[b.ownerID]:null;
    let blob=((b.tenantName||"")+" "+(b.monthLabel||"")+" "+(b.ownerID||"")+" "+(ownInfo?.name||"")+" "+(ownInfo?.oid||"")).toLowerCase();
    return blob.includes(q);
  });
  filt.sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
  let tbody=document.getElementById("admin-bills-tbody");
  if(!tbody) return;
  if(!filt.length){ tbody.innerHTML=`<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text3)">No bills found</td></tr>`; return; }
  tbody.innerHTML=filt.map(b=>{
    let ownInfo=b.ownerID?ownerMap[b.ownerID]:null;
    return `<tr>
      <td>${esc(b.tenantName||"–")}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px">${esc((b.tenantId||"").slice(0,8))}</td>
      <td>${ownInfo?esc(ownInfo.name):`<span style="color:var(--text3)">–</span>`}</td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px">${ownInfo?esc(ownInfo.oid):"–"}</td>
      <td>${esc(b.monthLabel||"–")}</td>
      <td>${fmtMoney(b.total)}</td>
      <td>${fmtDate(b.dueDate)}</td>
      <td>${b.status==="paid"?`<span style="color:var(--green);font-weight:700">✅ Paid</span>`:`<span style="color:var(--orange);font-weight:700">⏳ Pending</span>`}</td>
      <td>
        <button class="btn pdf-btn" style="padding:3px 8px;font-size:10px" onclick="downloadBillPdf('${b.id}')">⬇️</button>
        <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="editBill('${b.id}')">✏️</button>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteBillAdmin('${b.id}')">🗑</button>
      </td>
    </tr>`;
  }).join("");
};
window.editBill=async(id)=>{
  let b=await fbGetDoc("bills",id);
  if(!b)return;
  document.getElementById("bill-edit-form").style.display="block";
  sv("edit-bill-id",id);
  sv("edit-bill-month",b.monthLabel);
  sv("edit-bill-due",b.dueDate);
  sv("edit-bill-total",b.total);
  document.getElementById("edit-bill-status").value=b.status||"pending";
  document.getElementById("bill-edit-form").scrollIntoView({behavior:"smooth"});
};
window.cancelBillEdit=()=>{ document.getElementById("bill-edit-form").style.display="none"; };
window.saveBillEdit=async()=>{
  let id=g("edit-bill-id");
  await fbUpdate("bills",id,{
    monthLabel:g("edit-bill-month"),
    dueDate:g("edit-bill-due"),
    total:Number(g("edit-bill-total"))||0,
    status:document.getElementById("edit-bill-status").value
  });
  toast("✅ Bill updated");
  cancelBillEdit();
  await loadAdminBills();
};
window.deleteBillAdmin=async(id)=>{ if(!confirm("Delete this bill?"))return; await fbDel("bills",id); toast("🗑 Deleted"); await loadAdminBills(); };

// ── ADMIN: KEYS ───────────────────────────────────────────────
function generateKeyStr(){
  let chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let parts=[];
  for(let i=0;i<3;i++){
    let p="";
    for(let j=0;j<4;j++) p+=chars[Math.floor(Math.random()*chars.length)];
    parts.push(p);
  }
  return "KB-"+parts.join("-");
}
window.setPkPlan=(p,el)=>{
  pkPlanSel=p;
  document.querySelectorAll(".plan-sel-btn").forEach(b=>b.classList.remove("active"));
  el.classList.add("active");
};
window.regenKey=()=>{
  let k=generateKeyStr();
  document.getElementById("gen-key").textContent=k;
  currentGenKey2=k;
  document.getElementById("copy-confirm").textContent="";
};
window.copyCurrentKey=()=>{
  let k=document.getElementById("gen-key").textContent;
  navigator.clipboard.writeText(k).then(()=>{
    let el=document.getElementById("copy-confirm");
    el.textContent="✓ COPIED: "+k;
    setTimeout(()=>el.textContent="",2500);
  });
};
window.saveKey=async()=>{
  let k=document.getElementById("gen-key").textContent;
  if(!k||k==="–"){ toast("Generate a key first","error"); return; }
  try{
    await fbSet("keys",k,{key:k,plan:pkPlanSel,used:false,createdOn:new Date().toLocaleDateString("en-IN")});
    navigator.clipboard.writeText(k);
    toast(`✅ Key saved & copied! Plan: ${pkPlanSel}`);
    document.getElementById("copy-confirm").textContent="✓ Saved & Copied: "+k;
    await loadKeysList();
    await logActivity("Key Generated",`Key: ${k}, Plan: ${pkPlanSel}`,"Admin");
    regenKey();
  }catch(e){ toast("Error saving key","error"); }
};
async function loadKeysList(){
  let keys=await fbGet("keys");
  let tbody=document.getElementById("keys-tbody");
  if(!tbody) return;
  if(!keys.length){ tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No keys yet</td></tr>`; return; }
  keys.sort((a,b)=>(b.createdOn||"").localeCompare(a.createdOn||""));
  tbody.innerHTML=keys.map(k=>`<tr>
    <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${esc(k.id)}</td>
    <td><span class="key-badge ${k.plan==="annual"?"kb-a":"kb-m"}">${esc(k.plan||"–")}</span></td>
    <td>${esc(k.createdOn||"–")}</td>
    <td>${k.used?`<span style="color:var(--text3)">Used</span>`:`<span style="color:var(--green);font-weight:700">Available</span>`}</td>
    <td>${esc(k.usedOn||"–")}</td>
    <td>
      ${!k.used?`<button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="copyKey('${esc(k.id)}')">📋</button>`:""}
      <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteKey('${esc(k.id)}')">🗑</button>
    </td>
  </tr>`).join("");
}
window.copyKey=(k)=>{ navigator.clipboard.writeText(k).then(()=>toast("📋 Key copied!","info")); };
window.deleteKey=async(id)=>{ if(!confirm("Delete this key?"))return; await fbDel("keys",id); toast("🗑 Key deleted"); await loadKeysList(); };

// ── ADMIN TABS ────────────────────────────────────────────────
window.switchAdminTab=(tab,el)=>{
  document.querySelectorAll(".a-tab").forEach(t=>t.classList.remove("active")); el.classList.add("active");
  ["owners","tenants","bills","logs","database","backup","support"].forEach(t=>{
    let e2=document.getElementById("atab-"+t); if(e2) e2.style.display=tab===t?"block":"none";
  });
  if(tab==="owners") loadAdminOwners();
  if(tab==="tenants"){ populateOwnerFilters(); loadAdminTenants(); }
  if(tab==="bills"){ populateOwnerFilters(); loadAdminBills(); }
  if(tab==="logs") loadActivityLogs();
  if(tab==="database") loadDatabase();
  if(tab==="support") loadSupportTickets();
};

// v13.x: jumpToAdminTab — used by clickable stat tiles
window.jumpToAdminTab = (tab, optionalSearchTerm)=>{
  let btns = document.querySelectorAll(".a-tab");
  let found = null;
  for(let b of btns){
    let inline = b.getAttribute("onclick")||"";
    if(inline.includes(`'${tab}'`)){ found = b; break; }
  }
  if(found) found.click();
  // Optionally set a search term to filter (e.g. "trial" filters trial owners)
  if(optionalSearchTerm){
    setTimeout(()=>{
      let searchEl;
      if(tab==="owners") searchEl = document.getElementById("admin-owner-search");
      else if(tab==="tenants") searchEl = document.getElementById("admin-tenant-search");
      else if(tab==="bills") searchEl = document.getElementById("admin-bill-search");
      if(searchEl){
        searchEl.value = optionalSearchTerm;
        searchEl.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }, 250);
  }
};

// ── SUPPORT TICKETS (Admin) ──────────────────────────────────
window.loadSupportTickets = async()=>{
  let list = document.getElementById("support-tickets-list");
  if(!list) return;
  list.innerHTML = `<div class="empty-state"><div class="empty-icon">📞</div><div class="empty-text">Loading...</div></div>`;
  try{
    let all = await fbGet("supportTickets");
    let filter = document.getElementById("support-filter")?.value || "all";
    let filt = filter==="all" ? all : all.filter(t=>(t.status||"new")===filter);
    // Sort newest first
    filt.sort((a,b)=>(b.createdOn||"").localeCompare(a.createdOn||""));
    if(!filt.length){
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">📞</div><div class="empty-text">No support tickets ${filter==="all"?"yet":"in this status"}</div></div>`;
      return;
    }
    let catIcons = {bug:"🐛",feature:"💡",billing:"💳",question:"❓",data:"📊",other:"📋"};
    let statusBadge = (s)=>{
      let map = {
        new:        {label:"🆕 New",          color:"var(--blue)",   bg:"rgba(59,130,246,.15)"},
        in_progress:{label:"⏳ In Progress",  color:"var(--orange)", bg:"rgba(251,146,60,.15)"},
        resolved:   {label:"✅ Resolved",     color:"var(--green)",  bg:"rgba(34,197,94,.15)"}
      };
      let st = map[s||"new"] || map.new;
      return `<span style="background:${st.bg};color:${st.color};padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700">${st.label}</span>`;
    };
    list.innerHTML = filt.map(t=>{
      let when = t.createdOn ? new Date(t.createdOn).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–";
      let replyCount = (t.replies||[]).length;
      return `<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:8px;cursor:pointer;transition:all .15s;border-left:3px solid ${t.status==="resolved"?"var(--green)":t.status==="in_progress"?"var(--orange)":"var(--blue)"}" onclick="openSupportTicketDetail('${t.id}')" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s3)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px;display:flex;gap:6px;align-items:center">
              <span style="font-size:14px">${catIcons[t.category]||"📋"}</span>
              <span>${esc(t.subject||"(no subject)")}</span>
            </div>
            <div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:4px">From: ${esc(t.fromOwnerName||"Unknown")} ${t.fromOwnerEmail?`· ${esc(t.fromOwnerEmail)}`:""} ${t.fromOwnerPhone?`· ${esc(t.fromOwnerPhone)}`:""}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            ${statusBadge(t.status||"new")}
            <div style="font-size:9px;color:var(--text3)">${esc(when)}</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text2);font-weight:500;line-height:1.4;margin-top:4px">${esc((t.message||"").slice(0,160))}${(t.message||"").length>160?"...":""}</div>
        ${replyCount?`<div style="font-size:10px;color:var(--gold);font-weight:600;margin-top:6px">💬 ${replyCount} repl${replyCount===1?"y":"ies"}</div>`:""}
      </div>`;
    }).join("");
    // Refresh count badge on the tab button
    refreshSupportBadge();
  }catch(e){
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Error loading tickets: ${esc(e.message||"unknown")}</div></div>`;
  }
};

window.refreshSupportBadge = async()=>{
  try{
    let all = await fbGet("supportTickets");
    let newCount = all.filter(t=>(t.status||"new")==="new").length;
    let badge = document.getElementById("support-count-badge");
    if(badge){
      badge.textContent = newCount;
      badge.style.display = newCount>0 ? "inline-block" : "none";
    }
  }catch(e){}
};

window.openSupportTicketDetail = async(id)=>{
  let t = await fbGetDoc("supportTickets", id);
  if(!t){ toast("Ticket not found","error"); return; }
  let catIcons = {bug:"🐛",feature:"💡",billing:"💳",question:"❓",data:"📊",other:"📋"};
  let catLabel = {bug:"Bug",feature:"Feature Request",billing:"Billing",question:"Question",data:"Data Issue",other:"Other"};
  let when = t.createdOn ? new Date(t.createdOn).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–";
  let replies = Array.isArray(t.replies) ? t.replies : [];
  let body = `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:12px">
      <div style="font-weight:800;font-size:14px;margin-bottom:8px;display:flex;gap:6px;align-items:center">
        <span>${catIcons[t.category]||"📋"}</span>
        <span>${esc(t.subject||"(no subject)")}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--text3);font-weight:500;margin-bottom:10px">
        <div><strong style="color:var(--text2)">Category:</strong> ${catLabel[t.category]||t.category||"–"}</div>
        <div><strong style="color:var(--text2)">Submitted:</strong> ${esc(when)}</div>
        <div><strong style="color:var(--text2)">Owner:</strong> ${esc(t.fromOwnerName||"Unknown")}</div>
        <div><strong style="color:var(--text2)">Owner ID:</strong> <code style="font-size:10px">${esc((t.fromOwnerID||"–").slice(0,16))}</code></div>
        ${t.fromOwnerEmail?`<div><strong style="color:var(--text2)">Email:</strong> <a href="mailto:${esc(t.fromOwnerEmail)}" style="color:var(--blue)">${esc(t.fromOwnerEmail)}</a></div>`:""}
        ${t.fromOwnerPhone?`<div><strong style="color:var(--text2)">Phone:</strong> <a href="tel:${esc(t.fromOwnerPhone)}" style="color:var(--blue)">${esc(t.fromOwnerPhone)}</a></div>`:""}
      </div>
      <div style="background:var(--s3);border-radius:var(--rs);padding:10px;font-size:12px;line-height:1.5;color:var(--text2);white-space:pre-wrap">${esc(t.message||"")}</div>
      ${t.screenshot?`<div style="margin-top:10px"><div style="font-size:10px;color:var(--text3);font-weight:700;letter-spacing:.3px;margin-bottom:4px">📷 SCREENSHOT</div><img src="${t.screenshot}" style="max-width:100%;max-height:400px;border-radius:var(--rs);cursor:pointer;border:1px solid var(--border)" onclick="viewImg('${t.screenshot}')"/></div>`:""}
    </div>
    ${replies.length?`<div style="font-weight:700;font-size:12px;color:var(--text3);letter-spacing:.5px;margin-bottom:8px">💬 CONVERSATION HISTORY</div>`:""}
    ${replies.map(r=>{
      let rwhen = r.date ? new Date(r.date).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
      let isAdmin = r.author==="admin";
      return `<div style="background:${isAdmin?"rgba(245,166,35,.08)":"rgba(59,130,246,.08)"};border:1px solid ${isAdmin?"rgba(245,166,35,.3)":"rgba(59,130,246,.3)"};border-radius:var(--rs);padding:10px;margin-bottom:8px">
        <div style="font-size:10px;color:${isAdmin?"var(--gold)":"var(--blue)"};font-weight:700;margin-bottom:4px">${isAdmin?"⚙️ Support (you)":"👑 Owner"} · ${esc(rwhen)}</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.5;white-space:pre-wrap">${esc(r.text)}</div>
      </div>`;
    }).join("")}`;
  document.getElementById("support-detail-content").innerHTML = body;

  let footer = `
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--text3);font-weight:700;letter-spacing:.3px">REPLY TO OWNER</label>
      <textarea id="support-reply-${id}" rows="3" placeholder="Type your response..." style="width:100%;margin-top:4px;font-size:12px;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label style="font-size:10px;color:var(--text3);font-weight:700;margin:0">SET STATUS:</label>
      <select id="support-status-${id}" style="margin:0;padding:6px 10px;font-size:11px;width:auto">
        <option value="new" ${(t.status||"new")==="new"?"selected":""}>🆕 New</option>
        <option value="in_progress" ${t.status==="in_progress"?"selected":""}>⏳ In Progress</option>
        <option value="resolved" ${t.status==="resolved"?"selected":""}>✅ Resolved</option>
      </select>
      <button class="btn btn-primary" style="padding:7px 14px;font-size:11px;margin-left:auto" onclick="sendSupportReply('${id}')">📤 Send Reply</button>
      ${t.fromOwnerEmail?`<a class="btn btn-ghost" style="padding:7px 14px;font-size:11px;text-decoration:none" href="mailto:${esc(t.fromOwnerEmail)}?subject=Re: ${encodeURIComponent(t.subject||"Your support ticket")}">✉️ Reply by Email</a>`:""}
    </div>
  `;
  document.getElementById("support-detail-footer").innerHTML = footer;
  document.getElementById("support-detail-modal").classList.add("open");
};

window.sendSupportReply = async(id)=>{
  let textEl = document.getElementById("support-reply-"+id);
  let statusEl = document.getElementById("support-status-"+id);
  if(!textEl || !statusEl){ toast("Form error","error"); return; }
  let text = textEl.value.trim();
  let status = statusEl.value;
  let t = await fbGetDoc("supportTickets", id);
  if(!t){ toast("Ticket not found","error"); return; }
  let replies = Array.isArray(t.replies) ? [...t.replies] : [];
  let updates = { status };
  if(text){
    replies.push({
      author: "admin",
      text,
      date: new Date().toISOString()
    });
    updates.replies = replies;
    updates.lastReplyOn = new Date().toISOString();
    updates.lastReplyBy = "admin";
  }
  try{
    await fbUpdate("supportTickets", id, updates);
    // Notify the owner via in-app notification
    if(text && t.fromOwnerID){
      try{
        await pushNotification(t.fromOwnerID,
          `📞 Support replied to your ticket: ${(t.subject||"").slice(0,40)}`,
          text.slice(0,120) + (text.length>120?"...":""),
          "support_reply");
      }catch(e){}
    }
    toast(text ? "✅ Reply sent" : "✅ Status updated");
    closeModal("support-detail-modal");
    loadSupportTickets();
  }catch(e){
    toast("Error: "+(e.message||"unknown"),"error");
  }
};

// ── ACTIVITY LOGS ─────────────────────────────────────────────
window.loadActivityLogs=async()=>{
  try{
    let q=query(collection(db,"logs"),orderBy("createdAt","desc"),limit(200));
    let snap=await getDocs(q);
    let logs=snap.docs.map(d=>({id:d.id,...d.data()}));
    let list=document.getElementById("activity-logs-list");
    if(!list) return;
    if(!logs.length){ list.innerHTML=`<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">No activity logs yet</div></div>`; return; }
    list.innerHTML=logs.map(l=>`<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:10px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:3px"><span>${esc(l.action)}</span><span style="color:var(--text3);font-size:10px;font-weight:600">${esc(l.dateLabel||"")}</span></div>
      <div style="font-size:11px;color:var(--text2);font-weight:500">${esc(l.details||"")}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">👤 ${esc(l.user||"System")}</div>
    </div>`).join("");
  }catch(e){ console.error(e); }
};

// ── DATABASE VIEWER ───────────────────────────────────────────
// v13.x: cache for join lookups (owner name from ID, etc.)
let _dbOwnersMap = {}, _dbPropsMap = {}, _dbTenantsMap = {};

async function _refreshDbJoinCache(){
  try{
    let owns = await fbGet("owners");
    _dbOwnersMap = {}; owns.forEach(o=>{ _dbOwnersMap[o.id] = o.name || o.username || "(unnamed)"; });
    let props = await fbGet("properties");
    _dbPropsMap = {}; props.forEach(p=>{ _dbPropsMap[p.id] = p.name || "(unnamed)"; });
    let tens = await fbGet("tenants");
    _dbTenantsMap = {}; tens.forEach(t=>{ _dbTenantsMap[t.id] = t.name || "(unnamed)"; });
  }catch(e){ console.warn("join cache:",e); }
}
function _ownerName(id){ return id ? (_dbOwnersMap[id] || "(unknown owner)") : "—"; }
function _propName(id){ return id ? (_dbPropsMap[id] || "(unknown property)") : "—"; }
function _tenantName(id){ return id ? (_dbTenantsMap[id] || "(unknown tenant)") : "—"; }
function _fmtBool(v){ return v===true ? "✅ Yes" : v===false ? "❌ No" : "—"; }
function _fmtDate(d){
  if(!d) return "—";
  try{ return new Date(d).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch(e){ return String(d); }
}

async function loadDatabase(){
  await _refreshDbJoinCache();
  let cnt=document.getElementById("db-coll-grid");
  if(!cnt) return;
  cnt.innerHTML="";
  for(let c of DB_COLLS){
    try{
      let snap=await getDocs(collection(db,c.id));
      let n=snap.size;
      let card=document.createElement("div");
      card.className="db-coll-card";
      card.dataset.cid = c.id;
      card.innerHTML=`<div class="db-coll-icon">${c.icon}</div><div class="db-coll-name">${c.label}</div><div class="db-coll-count">${n}</div>`;
      card.onclick=()=>viewDbCollection(c.id,c.label);
      cnt.appendChild(card);
    }catch(e){ console.warn("[loadDatabase]",c.id,e); }
  }
  let wrap = document.getElementById("db-records-wrap");
  if(wrap) wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🗄️</div><div class="empty-text">Tap any tile above to see its records</div></div>`;
  dbCurrColl = "";
}

async function viewDbCollection(cid, label){
  dbCurrColl = cid;
  document.querySelectorAll(".db-coll-card").forEach(t=>{
    t.classList.toggle("active", t.dataset.cid === cid);
  });
  let wrap = document.getElementById("db-records-wrap");
  if(!wrap) return;
  wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">⏳ Loading ${esc(label)}...</div>`;
  try{
    await _refreshDbJoinCache();
    let snap = await getDocs(collection(db, cid));
    dbRecs = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderDbRecords(label);
  }catch(e){
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Error: ${esc(e.message||"unknown")}</div></div>`;
  }
}

window.backToDbList = ()=>{
  let wrap = document.getElementById("db-records-wrap");
  if(wrap) wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🗄️</div><div class="empty-text">Tap any tile above to see its records</div></div>`;
  dbCurrColl = "";
  document.querySelectorAll(".db-coll-card").forEach(c=>c.classList.remove("active"));
};

function _renderRecordCard(r){
  let body="",title="",badges="";
  switch(dbCurrColl){
    case "tenants":
      title = `🏠 ${esc(r.name||"(unnamed)")}`;
      badges = `${r.approved?'<span class="db-badge db-bg">Approved</span>':'<span class="db-badge db-bo">Pending</span>'}${r.active===false?'<span class="db-badge db-br">Deactivated</span>':''}${r.paid?'<span class="db-badge db-bg">Paid</span>':'<span class="db-badge db-bo">Unpaid</span>'}`;
      body = `
        <div class="db-row"><span class="db-k">Room</span><span class="db-v">${esc(r.room||"—")}</span></div>
        <div class="db-row"><span class="db-k">Rent</span><span class="db-v">${fmtMoney(r.rent||0)}</span></div>
        <div class="db-row"><span class="db-k">Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Property</span><span class="db-v">${esc(_propName(r.propertyId))}</span></div>
        <div class="db-row"><span class="db-k">Phone</span><span class="db-v">${esc(r.phone||"—")}</span></div>
        <div class="db-row"><span class="db-k">Email</span><span class="db-v">${esc(r.email||"—")}</span></div>
        <div class="db-row"><span class="db-k">Security Deposit</span><span class="db-v">${fmtMoney(r.securityDeposit||0)}</span></div>
        <div class="db-row"><span class="db-k">Move-in</span><span class="db-v">${esc(r.date||"—")}</span></div>`;
      break;
    case "bills":
      title = `📄 ${esc(r.monthLabel||"(no month)")} — ${esc(r.tenantName||_tenantName(r.tenantId))}`;
      badges = r.status==="paid" ? '<span class="db-badge db-bg">Paid</span>' : '<span class="db-badge db-bo">Unpaid</span>';
      body = `
        <div class="db-row"><span class="db-k">Amount</span><span class="db-v" style="color:var(--gold);font-weight:800">${fmtMoney(r.total||0)}</span></div>
        <div class="db-row"><span class="db-k">Tenant</span><span class="db-v">${esc(r.tenantName || _tenantName(r.tenantId))}</span></div>
        <div class="db-row"><span class="db-k">Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Due Date</span><span class="db-v">${esc(r.dueDate||"—")}</span></div>
        ${r.paidOn?`<div class="db-row"><span class="db-k">Paid On</span><span class="db-v">${esc(r.paidOn)}</span></div>`:""}`;
      break;
    case "owners":
      title = `👑 ${esc(r.name||r.username||"(unnamed)")}`;
      let planTxt = r.plan==="trial"?"🆓 Trial":r.plan==="monthly"?"💳 Monthly":r.plan==="annual"?"🌟 Annual":r.plan==="lifetime"?"♾️ Lifetime":(r.plan||"—");
      badges = `<span class="db-badge db-bb">${esc(planTxt)}</span>${r.active===false?'<span class="db-badge db-br">Inactive</span>':''}`;
      body = `
        <div class="db-row"><span class="db-k">Username</span><span class="db-v">${esc(r.username||"—")}</span></div>
        <div class="db-row"><span class="db-k">Phone</span><span class="db-v">${esc(r.phone||"—")}</span></div>
        <div class="db-row"><span class="db-k">Email</span><span class="db-v">${esc(r.email||"—")}</span></div>
        <div class="db-row"><span class="db-k">Subscription Ends</span><span class="db-v">${esc(r.subExpiry||"—")}</span></div>
        <div class="db-row"><span class="db-k">Trial Used</span><span class="db-v">${_fmtBool(r.trialUsed)}</span></div>`;
      break;
    case "properties":
      title = `🏘️ ${esc(r.name||"(unnamed)")}`;
      let typeLabel = ({apartment:"Apartment",house:"House",villa:"Villa",pg:"PG/Hostel",commercial:"Commercial",other:"Other"})[r.type] || r.type || "—";
      badges = `<span class="db-badge db-bp">${esc(typeLabel)}</span>`;
      body = `
        <div class="db-row"><span class="db-k">Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Address</span><span class="db-v">${esc(r.address||"—")}</span></div>
        <div class="db-row"><span class="db-k">Total Units</span><span class="db-v">${esc(String(r.units||0))}</span></div>
        <div class="db-row"><span class="db-k">Rooms Defined</span><span class="db-v">${Array.isArray(r.rooms)?r.rooms.length:0}</span></div>
        ${r.notes?`<div class="db-row"><span class="db-k">Notes</span><span class="db-v">${esc(r.notes)}</span></div>`:""}`;
      break;
    case "rooms":
      title = `🚪 Room ${esc(r.roomNum||"(none)")}`;
      body = `
        <div class="db-row"><span class="db-k">Property</span><span class="db-v">${esc(_propName(r.propertyId))}</span></div>
        <div class="db-row"><span class="db-k">Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Floor</span><span class="db-v">${esc(r.floor||"—")}</span></div>
        ${r.notes?`<div class="db-row"><span class="db-k">Notes</span><span class="db-v">${esc(r.notes)}</span></div>`:""}`;
      break;
    case "maintenanceTickets":
      title = `🔧 ${esc(r.category||"(no category)")} · ${esc(r.tenantName||_tenantName(r.tenantId))}`;
      let prMap = {urgent:"db-br",high:"db-bo",medium:"db-bg",low:"db-bb"};
      let stMap = {open:"db-bb",in_progress:"db-bo",resolved:"db-bg",closed:"db-bn"};
      badges = `<span class="db-badge ${prMap[r.priority]||"db-bn"}">${esc(r.priority||"—")}</span><span class="db-badge ${stMap[r.status]||"db-bn"}">${esc(r.status||"—")}</span>`;
      body = `
        <div class="db-row"><span class="db-k">Tenant</span><span class="db-v">${esc(r.tenantName||_tenantName(r.tenantId))}</span></div>
        <div class="db-row"><span class="db-k">Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Description</span><span class="db-v">${esc((r.description||"").slice(0,200))}</span></div>
        <div class="db-row"><span class="db-k">Reported</span><span class="db-v">${esc(r.createdOnLabel||_fmtDate(r.createdOn))}</span></div>
        ${r.eta?`<div class="db-row"><span class="db-k">ETA</span><span class="db-v">${esc(r.eta)}</span></div>`:""}
        ${r.resolutionNote?`<div class="db-row"><span class="db-k">Owner Note</span><span class="db-v">${esc(r.resolutionNote)}</span></div>`:""}`;
      break;
    case "supportTickets":
      title = `📞 ${esc(r.subject||"(no subject)")}`;
      let supStatus = ({new:"db-bb",in_progress:"db-bo",resolved:"db-bg"})[r.status||"new"]||"db-bn";
      badges = `<span class="db-badge ${supStatus}">${esc(r.status||"new")}</span><span class="db-badge db-bp">${esc(r.category||"general")}</span>`;
      body = `
        <div class="db-row"><span class="db-k">From</span><span class="db-v">${esc(r.fromOwnerName||"—")}</span></div>
        <div class="db-row"><span class="db-k">Email</span><span class="db-v">${esc(r.fromOwnerEmail||"—")}</span></div>
        <div class="db-row"><span class="db-k">Submitted</span><span class="db-v">${_fmtDate(r.createdOn)}</span></div>
        <div class="db-row"><span class="db-k">Message</span><span class="db-v">${esc((r.message||"").slice(0,300))}</span></div>
        ${(r.replies||[]).length?`<div class="db-row"><span class="db-k">Replies</span><span class="db-v">${(r.replies||[]).length}</span></div>`:""}`;
      break;
    case "vacantNotices":
      title = `📦 ${esc(_tenantName(r.tenantId))}`;
      badges = `<span class="db-badge db-bc">${esc(r.status||"pending")}</span>`;
      body = `
        <div class="db-row"><span class="db-k">Tenant</span><span class="db-v">${esc(_tenantName(r.tenantId))}</span></div>
        <div class="db-row"><span class="db-k">Vacating Date</span><span class="db-v">${esc(r.date||"—")}</span></div>
        <div class="db-row"><span class="db-k">Reason</span><span class="db-v">${esc(r.reason||"—")}</span></div>
        <div class="db-row"><span class="db-k">Sent At</span><span class="db-v">${_fmtDate(r.createdOn||r.sentOn)}</span></div>`;
      break;
    case "paymentClaims":
      title = `💰 ${fmtMoney(r.amount||0)} from ${esc(_tenantName(r.tenantId))}`;
      let clStat = ({pending:"db-bo",approved:"db-bg",rejected:"db-br"})[r.status||"pending"]||"db-bn";
      badges = `<span class="db-badge ${clStat}">${esc(r.status||"pending")}</span>`;
      body = `
        <div class="db-row"><span class="db-k">Tenant</span><span class="db-v">${esc(_tenantName(r.tenantId))}</span></div>
        <div class="db-row"><span class="db-k">Amount</span><span class="db-v" style="color:var(--gold);font-weight:800">${fmtMoney(r.amount||0)}</span></div>
        <div class="db-row"><span class="db-k">Method</span><span class="db-v">${esc(r.method||"—")}</span></div>
        <div class="db-row"><span class="db-k">For Month</span><span class="db-v">${esc(r.monthLabel||"—")}</span></div>
        ${r.ref?`<div class="db-row"><span class="db-k">Reference</span><span class="db-v">${esc(r.ref)}</span></div>`:""}
        <div class="db-row"><span class="db-k">Submitted</span><span class="db-v">${_fmtDate(r.createdOn)}</span></div>`;
      break;
    case "notifications":
      title = `🔔 ${esc((r.title||"").slice(0,60))}`;
      badges = `${r.read?'<span class="db-badge db-bn">Read</span>':'<span class="db-badge db-bb">Unread</span>'}<span class="db-badge db-bp">${esc(r.kind||"info")}</span>`;
      body = `
        <div class="db-row"><span class="db-k">For Owner</span><span class="db-v">${esc(_ownerName(r.ownerID))}</span></div>
        <div class="db-row"><span class="db-k">Body</span><span class="db-v">${esc((r.body||"").slice(0,200))}</span></div>
        <div class="db-row"><span class="db-k">When</span><span class="db-v">${esc(r.dateLabel||_fmtDate(r.createdOn))}</span></div>`;
      break;
    case "logs":
    case "activityLogs":
      title = `📊 ${esc(r.action||"(unknown action)")}`;
      body = `
        <div class="db-row"><span class="db-k">Actor</span><span class="db-v">${esc(r.actor||r.who||"—")}</span></div>
        <div class="db-row"><span class="db-k">Details</span><span class="db-v">${esc((r.details||"").slice(0,300))}</span></div>
        <div class="db-row"><span class="db-k">When</span><span class="db-v">${esc(r.date||_fmtDate(r.createdOn))}</span></div>`;
      break;
    default:
      title = `📄 ${esc(r.id||"")}`;
      let raw = JSON.stringify(r,null,2);
      if(raw.length>600) raw = raw.slice(0,600)+"...";
      body = `<pre style="font-size:10px;color:var(--text2);white-space:pre-wrap;word-break:break-all;margin:0">${esc(raw)}</pre>`;
  }
  return `<div class="db-rec-card">
    <div class="db-rec-head">
      <div class="db-rec-title">${title}</div>
      <div class="db-rec-actions">
        <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="toggleDbRecRaw('${esc(r.id)}')">📋 Raw</button>
        <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteDbRecord('${esc(dbCurrColl)}','${esc(r.id)}')">🗑</button>
      </div>
    </div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text3);margin-bottom:8px">ID: ${esc(r.id)}</div>
    ${badges?`<div style="margin-bottom:8px;display:flex;gap:4px;flex-wrap:wrap">${badges}</div>`:""}
    <div class="db-rec-body">${body}</div>
    <pre id="dbraw-${esc(r.id)}" style="display:none;font-size:10px;color:var(--text2);white-space:pre-wrap;word-break:break-all;margin:8px 0 0;padding:8px;background:var(--s1);border-radius:6px;max-height:300px;overflow-y:auto">${esc(JSON.stringify(r,null,2))}</pre>
  </div>`;
}

function renderDbRecords(labelOverride){
  let wrap = document.getElementById("db-records-wrap");
  if(!wrap) return;
  let label = labelOverride || (DB_COLLS.find(c=>c.id===dbCurrColl)?.label || dbCurrColl);
  let q = (document.getElementById("db-search")?.value||"").toLowerCase();
  let filt = dbRecs.filter(r=>!q || JSON.stringify(r).toLowerCase().includes(q));

  let header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--border)">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:11px" onclick="backToDbList()">← Collections</button>
      <div style="font-weight:800;font-size:14px;color:var(--purple)">${esc(label)}</div>
      <div style="font-size:11px;color:var(--text3);font-weight:600">${filt.length}${q?` of ${dbRecs.length}`:""} record${filt.length===1?"":"s"}</div>
    </div>
  </div>`;

  if(!filt.length){
    wrap.innerHTML = header + `<div class="empty-state"><div class="empty-icon">🗄️</div><div class="empty-text">No records${q?` matching "${esc(q)}"`:""}</div></div>`;
    return;
  }
  wrap.innerHTML = header + filt.slice(0,200).map(_renderRecordCard).join("");
}

window.toggleDbRecRaw = (id)=>{
  let el = document.getElementById("dbraw-"+id);
  if(el) el.style.display = el.style.display==="none" ? "block" : "none";
};
window.searchDbRecords=()=>renderDbRecords();
window.deleteDbRecord=async(c,id)=>{
  if(!confirm(`Delete record from ${c}?`))return;
  await fbDel(c,id);
  toast("🗑 Deleted");
  await viewDbCollection(c,c);
};

// ── BACKUP ────────────────────────────────────────────────────
window.exportJSON=async()=>{
  let backup={};
  for(let c of DB_COLLS){
    let snap=await getDocs(collection(db,c.id));
    backup[c.id]=snap.docs.map(d=>({id:d.id,...d.data()}));
  }
  let blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
  let url=URL.createObjectURL(blob);
  let a=document.createElement("a");
  a.href=url; a.download=`kiraabook-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("💾 Backup downloaded!");
};
window.exportCSV=async()=>{
  let tens=await fbGet("tenants");
  let cols=["tid","name","room","rent","phone","email","address","idType","idNum","approved","paid","ownerID"];
  let csv=cols.join(",")+"\n";
  tens.forEach(t=>{ csv+=cols.map(c=>`"${String(t[c]??"").replace(/"/g,'""')}"`).join(",")+"\n"; });
  let blob=new Blob([csv],{type:"text/csv"});
  let url=URL.createObjectURL(blob);
  let a=document.createElement("a");
  a.href=url; a.download=`kiraabook-tenants-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("📊 CSV downloaded!");
};

// ── Cross-module exports ──────────────────────────────────────
window.initAdmin         = initAdmin;         // called from auth.js and account.js
window.loadAdminStats    = loadAdminStats;
window.loadDatabase      = loadDatabase;
window.viewDbCollection  = viewDbCollection;
window.renderDbRecords   = renderDbRecords;

