import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, collection, onSnapshot } from '../firebase.js';
import { state } from '../state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, escAttr, closeModal, genUID } from '../helpers.js';

// ── MAINTENANCE TICKETS ──────────────────────────────────────
// `tickets` lives on window (set in app.js) so all modules share the same array
let unsubTickets = null;
let maintFilter = "all";

function subscribeTickets(ownerID){
  if(unsubTickets){ try{unsubTickets();}catch(e){} }
  try{
    unsubTickets = onSnapshot(collection(db,"maintenanceTickets"), snap=>{
      // Capture fresh on every snapshot
      let ownerDocId = (currentOwnerData && currentOwnerData.id) || "";
      let savedOid = localStorage.getItem("kb_owner_id") || "";
      let savedUser = localStorage.getItem("kb_owner_user") || "";
      let myCandidates = [ownerID, ownerDocId, savedOid, savedUser].filter(Boolean);
      let myTenantIds = new Set((tenants||[]).map(t=>t.id));
      let all = snap.docs.map(d=>({id:d.id,...d.data()}));
      tickets = all.filter(t=>{
        if(t.ownerID && myCandidates.includes(t.ownerID)) return true;
        // Fallback: ticket belongs to one of my tenants even if ownerID is stale
        if(t.tenantId && myTenantIds.has(t.tenantId)) return true;
        return false;
      });
      // Track orphan tickets (no ownerID, no matching tenant) — show in UI as "unlinked"
      window._orphanTickets = all.filter(t=>!t.ownerID && !(t.tenantId && myTenantIds.has(t.tenantId)));
      console.log("[Tickets] Total in DB:", all.length, "| Mine:", tickets.length, "| Orphan:", window._orphanTickets.length, "| My tenants:", myTenantIds.size, "| Filter:", myCandidates);
      if(all.length && !tickets.length){
        console.warn("[Tickets] None matched. Sample:", all.slice(0,5).map(t=>({ownerID:t.ownerID, tenantId:t.tenantId, tenantName:t.tenantName, status:t.status})));
      }
      let tab = document.getElementById("tab-maintenance");
      if(tab && tab.style.display!=="none") window.renderMaintenance && window.renderMaintenance();
      try{ refreshBellBadge(); }catch(e){}
    }, err=>console.warn("tickets sub error:",err));
  }catch(e){ console.warn("tickets sub failed:",e); }
}

window.setMaintFilter = (f, el)=>{
  maintFilter = f;
  document.querySelectorAll("#tab-maintenance .f-tab").forEach(t=>t.classList.remove("active"));
  el.classList.add("active");
  window.renderMaintenance && window.renderMaintenance();
};

function maintStatusBadge(status){
  let map = {
    open:        {label:"🆕 Open",          color:"var(--blue)",   bg:"rgba(59,130,246,.15)"},
    in_progress: {label:"⏳ In Progress",   color:"var(--orange)", bg:"rgba(251,146,60,.15)"},
    resolved:    {label:"✅ Resolved",      color:"var(--green)",  bg:"rgba(34,197,94,.15)"},
    closed:      {label:"🔒 Closed",        color:"var(--text3)",  bg:"rgba(148,163,184,.12)"}
  };
  let s = map[status] || map.open;
  return `<span style="background:${s.bg};color:${s.color};padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700">${s.label}</span>`;
}

function priorityBadge(p){
  let map = {
    low:    {label:"🟢 Low",    color:"var(--green)"},
    medium: {label:"🟡 Medium", color:"var(--gold)"},
    high:   {label:"🟠 High",   color:"var(--orange)"},
    urgent: {label:"🔴 Urgent", color:"var(--red)"}
  };
  let pr = map[p] || map.medium;
  return `<span style="color:${pr.color};font-weight:700;font-size:10px">${pr.label}</span>`;
}

window.renderMaintenance = ()=>{
  let list = document.getElementById("maint-list");
  if(!list) return;

  // Build status counters
  let counts = {total:tickets.length, open:0, in_progress:0, resolved:0, closed:0, urgent:0};
  tickets.forEach(t=>{
    if(t.status==="open") counts.open++;
    else if(t.status==="in_progress") counts.in_progress++;
    else if(t.status==="resolved") counts.resolved++;
    else if(t.status==="closed") counts.closed++;
    if(t.priority==="urgent" && t.status!=="closed") counts.urgent++;
  });
  let summaryEl = document.getElementById("maint-summary");
  if(summaryEl){
    let tile = (label, value, color, filterKey, icon)=>`
      <div onclick="document.querySelectorAll('#tab-maintenance .f-tab').forEach(t=>t.classList.remove('active'));event.currentTarget.classList.add('active');maintFilter='${filterKey}';window.renderMaintenance && window.renderMaintenance()" style="background:var(--s2);border:1px solid var(--border);border-left:3px solid ${color};border-radius:var(--rs);padding:10px 8px;text-align:center;cursor:pointer;transition:all .15s" onmouseover="this.style.background='var(--s3)'" onmouseout="this.style.background='var(--s2)'">
        <div style="font-size:9px;color:var(--text3);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">${icon} ${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
      </div>`;
    summaryEl.innerHTML =
      tile("Open", counts.open, "var(--blue)", "open", "🆕") +
      tile("In Progress", counts.in_progress, "var(--orange)", "in_progress", "⏳") +
      tile("Resolved", counts.resolved, "var(--green)", "resolved", "✅") +
      tile("Urgent", counts.urgent, "var(--red)", "urgent", "🚨");
  }

  let filt = tickets.filter(t=>{
    if(maintFilter==="all") return true;
    if(maintFilter==="urgent") return t.priority==="urgent" && t.status!=="closed";
    return t.status===maintFilter;
  });
  filt.sort((a,b)=>{
    let pri = {urgent:3,high:2,medium:1,low:0};
    let pa = pri[a.priority]||0, pb = pri[b.priority]||0;
    if(pa!==pb) return pb-pa;
    return (b.createdOn||"").localeCompare(a.createdOn||"");
  });
  // Orphan tickets banner
  let orphans = window._orphanTickets || [];
  let orphanHtml = "";
  if(orphans.length){
    orphanHtml = `<div style="background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.4);border-radius:var(--rs);padding:12px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--gold);font-size:12px;margin-bottom:6px">⚠️ ${orphans.length} ticket${orphans.length>1?"s":""} found without an owner link</div>
      <div style="font-size:11px;color:var(--text3);font-weight:500;margin-bottom:10px;line-height:1.5">These tickets exist but aren't linked to any owner. If they belong to your tenants, click "Claim".</div>
      ${orphans.map(t=>`<div style="display:flex;justify-content:space-between;align-items:center;background:var(--s3);border-radius:var(--rs);padding:8px 10px;margin-bottom:6px">
        <div>
          <div style="font-weight:700;font-size:12px">${esc(t.tenantName||"Unknown")} — ${esc(t.category||"")}</div>
          <div style="font-size:10px;color:var(--text3);font-weight:500">${esc((t.description||"").slice(0,80))}${(t.description||"").length>80?"...":""}</div>
        </div>
        <button class="btn btn-gold" style="padding:5px 10px;font-size:11px;flex-shrink:0" onclick="claimOrphanTicket('${t.id}')">🔗 Claim</button>
      </div>`).join("")}
    </div>`;
  }

  if(!filt.length){
    list.innerHTML = orphanHtml + `<div class="empty-state"><div class="empty-icon">🔧</div><div class="empty-text">No maintenance tickets ${maintFilter==="all"?"yet":"matching this filter"}</div></div>`;
    return;
  }
  list.innerHTML = orphanHtml + filt.map(t=>{
    let catIcons = {electrical:"⚡",plumbing:"🚿",appliance:"🔌",furniture:"🪑",paint_walls:"🎨",cleaning:"🧹",security:"🔒",other:"📋"};
    let cIcon = catIcons[t.category] || "📋";
    let tenant = tenants.find(x=>x.id===t.tenantId);
    let isExpanded = window._expandedTickets && window._expandedTickets.has(t.id);
    let etaText = "";
    if(t.eta && t.status!=="resolved" && t.status!=="closed"){
      try{ etaText = "🗓 ETA: "+new Date(t.eta).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){}
    }
    return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:10px;border-left:3px solid ${t.priority==="urgent"?"var(--red)":t.priority==="high"?"var(--orange)":"var(--blue)"}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px;cursor:pointer" onclick="toggleTicketExpand('${t.id}')">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:6px;align-items:center;font-weight:700;font-size:13px">
            <span style="font-size:16px">${cIcon}</span>
            <span>${esc(tenant?.name||t.tenantName||"Unknown")}</span>
            <span style="font-size:10px;color:var(--text3);font-weight:500">· Room ${esc(tenant?.room||t.room||"–")}</span>
          </div>
          <div style="font-size:11px;color:var(--text2);font-weight:500;margin-top:4px;line-height:1.5">${esc(t.description||"")}</div>
          ${etaText?`<div style="font-size:11px;color:var(--cyan);font-weight:600;margin-top:4px">${etaText}</div>`:""}
          ${t.resolutionNote?`<div style="font-size:11px;color:var(--green);font-weight:500;margin-top:4px;background:rgba(34,197,94,.08);padding:6px 8px;border-radius:6px">💬 ${esc(t.resolutionNote)}</div>`:""}
          ${(t.comments||[]).some(c=>c.author==="tenant" && !c.readByOwner)?`<div style="font-size:11px;color:var(--red);font-weight:700;margin-top:4px;background:rgba(244,63,94,.1);padding:6px 8px;border-radius:6px">🔴 New reply from tenant — tap to read</div>`:(t.comments||[]).length?`<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:4px">💬 ${(t.comments||[]).length} message${(t.comments||[]).length===1?"":"s"} in conversation</div>`:""}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
          ${maintStatusBadge(t.status)}
          ${priorityBadge(t.priority)}
          <span style="font-size:9px;color:var(--text3);font-weight:600;margin-top:2px">${isExpanded?"▲ collapse":"▼ details"}</span>
        </div>
      </div>
      ${isExpanded ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        ${t.photo ? `<div style="margin-bottom:10px"><div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:4px">📷 Attached Photo:</div><img src="${t.photo}" style="max-width:100%;max-height:300px;border-radius:var(--rs);cursor:pointer;border:1px solid var(--border)" onclick="viewImg('${t.photo}')"/></div>`:""}
        <div style="background:var(--s3);border-radius:var(--rs);padding:10px;margin-bottom:8px">
          <div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:6px">💬 RESOLUTION NOTE FOR TENANT</div>
          <textarea id="reso-${t.id}" rows="2" placeholder="e.g. Plumber scheduled for Friday. Will fix by 28 May." style="width:100%;resize:none;margin:0;font-size:11px">${esc(t.resolutionNote||"")}</textarea>
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap">
            <label style="font-size:10px;color:var(--text3);font-weight:600;margin:0">🗓 ETA Date:</label>
            <input type="date" id="eta-${t.id}" value="${t.eta||""}" style="flex:1;margin:0;padding:5px 8px;font-size:11px;min-width:120px"/>
            <button class="btn btn-success" style="padding:5px 12px;font-size:11px" onclick="saveTicketNoteAndEta('${t.id}')">💾 Save Note</button>
          </div>
        </div>

        <!-- v13: Conversation thread -->
        <div style="background:var(--s3);border-radius:var(--rs);padding:10px;margin-bottom:8px">
          <div style="font-size:10px;color:var(--text3);font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <span>💬 CONVERSATION WITH TENANT</span>
            ${(t.comments||[]).some(c=>c.author==="tenant" && !c.readByOwner)?`<span style="background:var(--red);color:#fff;padding:1px 6px;border-radius:99px;font-size:9px;font-weight:700">NEW REPLY</span>`:""}
          </div>
          <div style="max-height:300px;overflow-y:auto;margin-bottom:8px">
            ${renderTicketThread(t, "owner")}
          </div>
          <textarea id="ownerreply-${t.id}" rows="2" placeholder="Reply to tenant..." style="width:100%;margin:0;font-size:11px;resize:none"></textarea>
          <button class="btn btn-primary" style="margin-top:6px;width:100%;font-size:11px;padding:7px 10px" onclick="sendOwnerTicketReply('${t.id}')">📤 Send Reply</button>
        </div>

        <div style="font-size:10px;color:var(--text3);font-weight:500">
          Reported: ${esc(t.createdOnLabel||"–")}<br>
          Last update: ${t.updatedOn?new Date(t.updatedOn).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"–"}<br>
          ${t.assignedTo?`Assigned to: ${esc(t.assignedTo)}`:""}
        </div>
      </div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text3);font-weight:500">
          📅 ${esc(t.createdOnLabel||"–")}
          ${t.assignedTo?` · 👷 ${esc(t.assignedTo)}`:""}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <select onchange="updateTicketStatus('${t.id}',this.value)" style="margin:0;padding:4px 8px;font-size:10px;width:auto;min-width:130px">
            <option value="open" ${t.status==="open"?"selected":""}>🆕 Open</option>
            <option value="in_progress" ${t.status==="in_progress"?"selected":""}>⏳ In Progress</option>
            <option value="resolved" ${t.status==="resolved"?"selected":""}>✅ Resolved</option>
            <option value="closed" ${t.status==="closed"?"selected":""}>🔒 Closed</option>
          </select>
          <button class="btn btn-edit" style="padding:3px 8px;font-size:10px" onclick="assignTicket('${t.id}')">👷 Assign</button>
          <button class="btn btn-danger" style="padding:3px 8px;font-size:10px" onclick="deleteTicket('${t.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
};

// v13: expand/collapse ticket detail
window._expandedTickets = new Set();
window.toggleTicketExpand = async(id)=>{
  if(!window._expandedTickets) window._expandedTickets = new Set();
  let wasOpen = window._expandedTickets.has(id);
  if(wasOpen) window._expandedTickets.delete(id);
  else {
    window._expandedTickets.add(id);
    // Mark tenant replies as read by owner when opening the thread
    try{
      let t = await fbGetDoc("maintenanceTickets", id);
      if(t && Array.isArray(t.comments)){
        let hasUnread = t.comments.some(c=>c.author==="tenant" && !c.readByOwner);
        if(hasUnread){
          let updated = t.comments.map(c=>{
            if(c.author==="tenant" && !c.readByOwner) return {...c, readByOwner:true};
            return c;
          });
          await fbUpdate("maintenanceTickets", id, {comments:updated});
        }
      }
    }catch(e){}
  }
  window.renderMaintenance && window.renderMaintenance();
};

// v13: Owner sends a reply on a ticket
window.sendOwnerTicketReply = async(ticketId)=>{
  let textEl = document.getElementById("ownerreply-"+ticketId);
  if(!textEl) return;
  let text = textEl.value.trim();
  if(!text){ toast("Type a message first","error"); textEl.focus(); return; }
  let t = await fbGetDoc("maintenanceTickets", ticketId);
  if(!t){ toast("Ticket not found","error"); return; }
  let ownerName = currentOwnerData?.name || localStorage.getItem("kb_owner_name") || "Owner";
  let comments = Array.isArray(t.comments) ? [...t.comments] : [];
  comments.push({
    author: "owner",
    authorName: ownerName,
    text,
    date: new Date().toISOString(),
    readByOwner: true,
    readByTenant: false
  });
  try{
    await fbUpdate("maintenanceTickets", ticketId, {
      comments,
      lastReplyOn: new Date().toISOString(),
      lastReplyBy: "owner"
    });
    toast("✅ Reply sent to tenant","info");
    textEl.value = "";
    await logActivity("Owner Replied on Maintenance Ticket", `Ticket: ${ticketId.slice(0,8)}, Msg: ${text.slice(0,50)}`, "Owner");
  }catch(e){
    toast("Error: "+(e.message||"unknown"),"error");
  }
};

// v13: save resolution note + ETA
window.saveTicketNoteAndEta = async(id)=>{
  let noteEl = document.getElementById("reso-"+id);
  let etaEl = document.getElementById("eta-"+id);
  if(!noteEl||!etaEl) return;
  let note = noteEl.value.trim();
  let eta = etaEl.value;
  try{
    await fbUpdate("maintenanceTickets", id, {
      resolutionNote: note,
      eta: eta,
      updatedOn: new Date().toISOString()
    });
    toast("✅ Note saved — tenant will see this");
    let t = tickets.find(x=>x.id===id);
    if(t && t.tenantId){
      let tenant = tenants.find(x=>x.id===t.tenantId);
      if(tenant && tenant.ownerID){
        // No-op: tenant sees via Firestore listener already
      }
    }
    await logActivity("Maintenance Note Updated", `Ticket: ${id.slice(0,8)}, Note: ${note.slice(0,40)}`, "Owner");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

// v13: claim orphan ticket
window.claimOrphanTicket = async(id)=>{
  let ownerID = localStorage.getItem("kb_owner_id") || "";
  if(!ownerID){ toast("Session expired","error"); return; }
  if(!confirm("Link this ticket to your account?")) return;
  try{
    await fbUpdate("maintenanceTickets", id, {ownerID, claimedOn:new Date().toISOString()});
    toast("✅ Ticket linked to your account");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.updateTicketStatus = async(id, status)=>{
  try{
    let upd = {status, updatedOn:new Date().toISOString()};
    if(status==="resolved") upd.resolvedOn = new Date().toLocaleDateString("en-IN");
    await fbUpdate("maintenanceTickets", id, upd);
    let t = tickets.find(x=>x.id===id);
    toast("✅ Status updated");
    // Notify tenant
    if(t && t.tenantId){
      await logActivity("Maintenance Status Updated", `Ticket: ${t.description?.slice(0,40)||""}, Status: ${status}`,"Owner");
    }
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.assignTicket = async(id)=>{
  let t = tickets.find(x=>x.id===id);
  let curr = t?.assignedTo || "";
  let name = prompt("Assign this ticket to (electrician, plumber, name):", curr);
  if(name===null) return;
  try{
    await fbUpdate("maintenanceTickets", id, {assignedTo:name.trim(), updatedOn:new Date().toISOString()});
    toast(name.trim() ? `✅ Assigned to ${name.trim()}` : "Assignment cleared");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.deleteTicket = async(id)=>{
  if(!confirm("Delete this ticket? This cannot be undone.")) return;
  try{
    await fbDel("maintenanceTickets", id);
    toast("🗑 Ticket deleted");
  }catch(e){ toast("Error","error"); }
};

// ── TENANT-SIDE MAINTENANCE ──────────────────────────────────
window.openTenantMaintForm = ()=>{
  document.getElementById("tv-maint-form").style.display = "block";
  document.getElementById("tv-maint-form").scrollIntoView({behavior:"smooth"});
};
window.closeTenantMaintForm = ()=>{
  document.getElementById("tv-maint-form").style.display = "none";
  sv("tv-maint-desc",""); sv("tv-maint-photo-data","");
  let prev=document.getElementById("tv-maint-photo-prev");
  if(prev) prev.innerHTML = '<span style="font-size:18px">📷</span><span style="font-size:10px;color:var(--text3);font-weight:600">Tap to add photo</span>';
};

window.submitTenantMaintTicket = async()=>{
  let desc = g("tv-maint-desc");
  if(!desc){ toast("Please describe the issue","error"); document.getElementById("tv-maint-desc").classList.add("field-error"); return; }
  if(desc.length<10){ toast("Please add more detail (at least 10 characters)","error"); return; }
  let t = tenants.find(x=>x.id===currentTenantId);
  if(!t){ try{ let all=await fbGet("tenants"); t=all.find(x=>x.id===currentTenantId); }catch(e){} }
  if(!t){ toast("Session expired","error"); return; }
  let now = new Date();
  let ticket = {
    tenantId: t.id,
    tenantName: t.name,
    tenantPhone: t.phone||"",
    ownerID: t.ownerID||"",
    room: t.room||"",
    propertyId: t.propertyId||"",
    category: g("tv-maint-cat"),
    priority: g("tv-maint-pri"),
    description: desc,
    photo: document.getElementById("tv-maint-photo-data")?.value||"",
    status: "open",
    assignedTo: "",
    createdOn: now.toISOString(),
    createdOnLabel: now.toLocaleString("default",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})
  };
  try{
    await fbAdd("maintenanceTickets", ticket);
    toast("✅ Ticket submitted! Owner has been notified.");
    closeTenantMaintForm();
    // Push notification to owner
    if(t.ownerID){
      await pushNotification(t.ownerID,
        `🔧 Maintenance request from ${t.name}`,
        `${ticket.category.toUpperCase()} · ${ticket.priority.toUpperCase()}: ${desc.slice(0,80)}${desc.length>80?"...":""}`,
        "maintenance_ticket");
    }
    await logActivity("Maintenance Ticket Created", `By: ${t.name}, Category: ${ticket.category}, Priority: ${ticket.priority}`, t.name);
    // Refresh tenant view
    setTimeout(()=>renderTenantMaintList(t.id), 600);
  }catch(e){ console.error(e); toast("Error: "+(e.message||"unknown"),"error"); }
};

// v13: render conversation thread on a ticket (used by both owner + tenant)
function renderTicketThread(ticket, viewerRole){
  // viewerRole: "owner" or "tenant"
  let comments = Array.isArray(ticket.comments) ? ticket.comments : [];
  let intro = "";
  // Treat the original description as the first message from tenant
  intro += `<div style="display:flex;gap:8px;margin-bottom:8px"><div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${esc((ticket.tenantName||"T").slice(0,1).toUpperCase())}</div><div style="flex:1;background:rgba(59,130,246,.08);border-radius:10px 10px 10px 4px;padding:8px 10px"><div style="font-size:10px;color:var(--blue);font-weight:700;margin-bottom:2px">${esc(ticket.tenantName||"Tenant")} · Original request</div><div style="font-size:11px;color:var(--text2);font-weight:500;line-height:1.4">${esc(ticket.description||"")}</div><div style="font-size:9px;color:var(--text3);margin-top:3px">${esc(ticket.createdOnLabel||"")}</div></div></div>`;
  // Resolution note as a special "pinned" owner message if present
  if(ticket.resolutionNote){
    intro += `<div style="display:flex;gap:8px;margin-bottom:8px;flex-direction:row-reverse"><div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">O</div><div style="flex:1;background:rgba(34,197,94,.1);border-radius:10px 10px 4px 10px;padding:8px 10px"><div style="font-size:10px;color:var(--green);font-weight:700;margin-bottom:2px">Owner · 📌 Resolution Plan</div><div style="font-size:11px;color:var(--text2);font-weight:500;line-height:1.4">${esc(ticket.resolutionNote)}</div>${ticket.eta?`<div style="font-size:10px;color:var(--cyan);margin-top:3px;font-weight:600">🗓 ETA: ${new Date(ticket.eta).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}</div>`:""}</div></div>`;
  }
  // Then all comments in chronological order
  let body = comments.map(c=>{
    let isMe = c.author === viewerRole;
    let isOwner = c.author === "owner";
    let bg = isOwner ? "rgba(34,197,94,.08)" : "rgba(59,130,246,.08)";
    let color = isOwner ? "var(--green)" : "var(--blue)";
    let initial = (c.authorName || (isOwner?"O":"T")).slice(0,1).toUpperCase();
    let avatarBg = isOwner ? "var(--green)" : "var(--blue)";
    let timeLabel = "";
    try{ timeLabel = new Date(c.date).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); }catch(e){ timeLabel=""; }
    let bubbleRadius = isMe ? "10px 10px 4px 10px" : "10px 10px 10px 4px";
    return `<div style="display:flex;gap:8px;margin-bottom:8px${isMe?";flex-direction:row-reverse":""}">
      <div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${avatarBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${esc(initial)}</div>
      <div style="flex:1;background:${bg};border-radius:${bubbleRadius};padding:8px 10px">
        <div style="font-size:10px;color:${color};font-weight:700;margin-bottom:2px">${esc(c.authorName || (isOwner?"Owner":"Tenant"))}${isMe?" (you)":""}</div>
        <div style="font-size:11px;color:var(--text2);font-weight:500;line-height:1.4;white-space:pre-wrap">${esc(c.text)}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:3px">${esc(timeLabel)}</div>
      </div>
    </div>`;
  }).join("");
  return intro + body;
}

async function renderTenantMaintList(tenantId){
  let listEl = document.getElementById("tv-maint-list");
  if(!listEl) return;
  try{
    let all = await fbGet("maintenanceTickets");
    let mine = all.filter(t=>t.tenantId===tenantId).sort((a,b)=>(b.createdOn||"").localeCompare(a.createdOn||""));
    if(!mine.length){ listEl.innerHTML = `<div style="font-size:11px;color:var(--text3);font-weight:500;text-align:center;padding:8px 0">No maintenance requests yet</div>`; return; }
    let catIcons = {electrical:"⚡",plumbing:"🚿",appliance:"🔌",furniture:"🪑",paint_walls:"🎨",cleaning:"🧹",security:"🔒",other:"📋"};
    if(!window._tenantExpandedThreads) window._tenantExpandedThreads = new Set();
    listEl.innerHTML = mine.slice(0,8).map(t=>{
      let etaText = "";
      if(t.eta && t.status!=="resolved" && t.status!=="closed"){
        try{ etaText = "🗓 ETA: "+new Date(t.eta).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }catch(e){}
      }
      let photoExp = window._tenantExpandedTickets && window._tenantExpandedTickets.has(t.id);
      let threadOpen = window._tenantExpandedThreads.has(t.id);
      let commentCount = (t.comments||[]).length;
      let unreadOwnerReply = (t.comments||[]).some(c=>c.author==="owner" && !c.readByTenant);
      return `<div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:10px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-weight:700;font-size:12px;display:flex;gap:6px;align-items:center">
            <span>${catIcons[t.category]||"📋"}</span>
            <span style="text-transform:capitalize">${esc((t.category||"").replace(/_/g," "))}</span>
            ${priorityBadge(t.priority)}
          </div>
          ${maintStatusBadge(t.status)}
        </div>
        <div style="font-size:11px;color:var(--text2);font-weight:500;margin-top:6px;line-height:1.4">${esc(t.description||"")}</div>
        ${etaText?`<div style="font-size:11px;color:var(--cyan);font-weight:600;margin-top:4px">${etaText}</div>`:""}
        ${t.resolutionNote && !threadOpen?`<div style="font-size:11px;color:var(--green);font-weight:500;margin-top:4px;background:rgba(34,197,94,.08);padding:6px 8px;border-radius:6px">💬 Owner: ${esc(t.resolutionNote)}</div>`:""}
        ${t.photo?`<div style="margin-top:6px"><img src="${t.photo}" style="max-width:100%;max-height:${photoExp?"300px":"60px"};border-radius:6px;cursor:pointer;transition:all .2s" onclick="toggleTenantTicketPhoto('${t.id}')"/><div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:2px">📷 Tap to ${photoExp?"shrink":"expand"} photo</div></div>`:""}

        <!-- v13: Conversation thread toggle -->
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          <button class="btn btn-edit" style="font-size:10px;padding:5px 10px;width:100%;text-align:left" onclick="toggleTenantTicketThread('${t.id}')">
            💬 ${threadOpen?"Hide":"Show"} conversation
            ${commentCount?` (${commentCount} message${commentCount===1?"":"s"})`:""}
            ${unreadOwnerReply && !threadOpen?` <span style="background:var(--red);color:#fff;padding:1px 6px;border-radius:99px;font-size:9px;font-weight:700;margin-left:4px">NEW</span>`:""}
          </button>
          ${threadOpen?`
          <div style="margin-top:10px;padding:10px;background:var(--s2);border-radius:var(--rs)">
            ${renderTicketThread(t, "tenant")}
            <!-- Reply box -->
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
              <textarea id="tenantreply-${t.id}" rows="2" placeholder="Add a reply to your owner..." style="width:100%;margin:0;font-size:11px;resize:none"></textarea>
              <button class="btn btn-success" style="margin-top:6px;width:100%;font-size:11px;padding:7px 10px" onclick="sendTenantTicketReply('${t.id}')">📤 Send Reply</button>
            </div>
          </div>`:""}
        </div>

        <div style="font-size:9px;color:var(--text3);margin-top:6px">Reported ${esc(t.createdOnLabel||"–")}${t.assignedTo?` · 👷 ${esc(t.assignedTo)}`:""}</div>
      </div>`;
    }).join("");
  }catch(e){ console.warn("tenant maint list error:",e); }
}

window._tenantExpandedTickets = new Set();
window._tenantExpandedThreads = new Set();
window.toggleTenantTicketPhoto = (id)=>{
  if(!window._tenantExpandedTickets) window._tenantExpandedTickets = new Set();
  if(window._tenantExpandedTickets.has(id)) window._tenantExpandedTickets.delete(id);
  else window._tenantExpandedTickets.add(id);
  if(currentTenantId) renderTenantMaintList(currentTenantId);
};
window.toggleTenantTicketThread = async(id)=>{
  if(!window._tenantExpandedThreads) window._tenantExpandedThreads = new Set();
  let wasOpen = window._tenantExpandedThreads.has(id);
  if(wasOpen) window._tenantExpandedThreads.delete(id);
  else {
    window._tenantExpandedThreads.add(id);
    // Mark owner replies as read by tenant
    try{
      let t = await fbGetDoc("maintenanceTickets", id);
      if(t && Array.isArray(t.comments)){
        let updated = t.comments.map(c=>{
          if(c.author==="owner" && !c.readByTenant) return {...c, readByTenant:true};
          return c;
        });
        await fbUpdate("maintenanceTickets", id, {comments:updated});
      }
    }catch(e){}
  }
  if(currentTenantId) renderTenantMaintList(currentTenantId);
};

// Tenant sends a reply on a ticket
window.sendTenantTicketReply = async(ticketId)=>{
  let textEl = document.getElementById("tenantreply-"+ticketId);
  if(!textEl) return;
  let text = textEl.value.trim();
  if(!text){ toast("Type a message first","error"); textEl.focus(); return; }
  let t = await fbGetDoc("maintenanceTickets", ticketId);
  if(!t){ toast("Ticket not found","error"); return; }
  let tenant = tenants.find(x=>x.id===currentTenantId);
  if(!tenant){
    try{ let all=await fbGet("tenants"); tenant=all.find(x=>x.id===currentTenantId); }catch(e){}
  }
  let comments = Array.isArray(t.comments) ? [...t.comments] : [];
  comments.push({
    author: "tenant",
    authorName: tenant?.name || "Tenant",
    text,
    date: new Date().toISOString(),
    readByOwner: false,
    readByTenant: true
  });
  try{
    await fbUpdate("maintenanceTickets", ticketId, {
      comments,
      lastReplyOn: new Date().toISOString(),
      lastReplyBy: "tenant"
    });
    toast("✅ Reply sent","info");
    textEl.value = "";
    // Notify owner via push notification
    if(t.ownerID){
      try{
        await pushNotification(t.ownerID,
          `💬 Tenant reply on ticket from ${tenant?.name||"tenant"}`,
          text.slice(0,100)+(text.length>100?"...":""),
          "maintenance_ticket");
      }catch(e){}
    }
    if(currentTenantId) renderTenantMaintList(currentTenantId);
  }catch(e){
    toast("Error sending reply: "+(e.message||"unknown"),"error");
  }
};

// ── FINANCIAL SUMMARY (tenant side) ──────────────────────────
async function renderTenantFinancialSummary(t){
  let el = document.getElementById("tv-financial-content");
  if(!el) return;
  let security = Number(t.securityDeposit)||0;
  let advBalance = t.advanceRentBalance!=null ? Number(t.advanceRentBalance) : Number(t.advanceRent)||0;
  el.innerHTML = `
    <div style="background:var(--s3);border-radius:var(--rs);padding:10px;text-align:center">
      <div style="font-size:9px;color:var(--text3);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">🔒 Security Deposit</div>
      <div style="font-weight:800;font-size:18px;color:var(--cyan)">${fmtMoney(security)}</div>
      <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:3px">Refundable when you vacate</div>
    </div>
    <div style="background:var(--s3);border-radius:var(--rs);padding:10px;text-align:center">
      <div style="font-size:9px;color:var(--text3);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px">💰 Advance Balance</div>
      <div style="font-weight:800;font-size:18px;color:var(--green)">${fmtMoney(advBalance)}</div>
      <div style="font-size:9px;color:var(--text3);font-weight:500;margin-top:3px">Credit toward future rent</div>
    </div>`;
}

// Hook properties + tickets into initOwner
// Note: initOwner is a local function declaration, not on window. So we patch by
// listening for the owner screen becoming active and starting subs then.
let _v12SubsStarted = false;
function startV12Subscriptions(){
  let ownerID = localStorage.getItem("kb_owner_id");
  if(!ownerID){ console.warn("[v12] No owner ID, skipping subs"); return; }
  if(_v12SubsStarted){ console.log("[v12] Subs already started"); return; }
  _v12SubsStarted = true;
  console.log("[v12] Starting Properties + Tickets subscriptions for owner:", ownerID);
  // subscribeProperties lives in properties.js — call via window
  if(typeof window.subscribeProperties === "function") window.subscribeProperties(ownerID);
  subscribeTickets(ownerID);
}
// Expose on window so show() in helpers.js can find it
window.startV12Subscriptions = startV12Subscriptions;
// Patch logout to reset the flag and tear down subs
let _origLogoutV12 = window.logout;
window.logout = function(){
  _v12SubsStarted = false;
  try{ if(unsubProperties){unsubProperties();unsubProperties=null;} }catch(e){}
  try{ if(unsubTickets){unsubTickets();unsubTickets=null;} }catch(e){}
  if(_origLogoutV12) _origLogoutV12.apply(this, arguments);
};

// ═════════════════════════════════════════════════════════════
