import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, collection, onSnapshot } from '../firebase.js';
import { state } from '../state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, escAttr, closeModal, genUID } from '../helpers.js';

// ═════════════════════════════════════════════════════════════
// v12: PROPERTIES, MAINTENANCE TICKETS, FINANCIAL SUMMARY
// ═════════════════════════════════════════════════════════════

// ── PROPERTIES ───────────────────────────────────────────────
// `properties` lives on window (set in app.js) so all modules share the same array
let unsubProperties = null;

window.subscribeProperties = function subscribeProperties(ownerID){
  if(unsubProperties){ try{unsubProperties();}catch(e){} }
  try{
    unsubProperties = onSnapshot(collection(db,"properties"), snap=>{
      let ownerDocId = (currentOwnerData && currentOwnerData.id) || "";
      let savedOid = localStorage.getItem("kb_owner_id") || "";
      let savedUser = localStorage.getItem("kb_owner_user") || "";
      let all = snap.docs.map(d=>({id:d.id,...d.data()}));
      let myCandidates = [ownerID, ownerDocId, savedOid, savedUser].filter(Boolean);
      properties = all.filter(p=>p.ownerID && myCandidates.includes(p.ownerID));
      // v13.1: orphan banner removed (was confusing); just log to console for debugging
      let orphanCount = all.filter(p=>!p.ownerID).length;
      console.log("[Properties] Total in DB:", all.length, "| Mine:", properties.length, "| Orphan (hidden):", orphanCount);
      // Always re-render properties tab (even if not visible — keeps state consistent)
      window.renderProperties && window.renderProperties();
      // CRITICAL FIX: re-compute dashboard stats now that properties are loaded
      // (updateOwnerStats reads from `properties` array for vacant calculations)
      try{ updateOwnerStats(); }catch(e){ console.warn("updateOwnerStats from properties sub:", e); }
      try{ window.populatePropertySelect && window.populatePropertySelect(); }catch(e){}
    }, err=>console.warn("properties sub error:",err));
  }catch(e){ console.warn("properties sub failed:",e); }
}

window.populatePropertySelect = ()=>{
  let sel = document.getElementById("ot-property");
  if(!sel) return;
  let curr = sel.value;
  let opts = `<option value="">— Default Property —</option>`;
  properties.forEach(p=>{
    opts += `<option value="${esc(p.id)}">${esc(p.name||"Untitled")}</option>`;
  });
  sel.innerHTML = opts;
  if(curr) sel.value = curr;
};

window.openPropertyForm = ()=>{
  document.getElementById("property-form").style.display = "block";
  document.getElementById("property-form-title").textContent = "➕ Add New Property";
  ["prop-id","prop-name","prop-address","prop-units","prop-notes"].forEach(i=>sv(i,""));
  let typeSel = document.getElementById("prop-type"); if(typeSel) typeSel.value="apartment";
  document.getElementById("property-form").scrollIntoView({behavior:"smooth"});
};

window.openEditProperty = (id)=>{
  let p = properties.find(x=>x.id===id);
  if(!p){ toast("Property not found","error"); return; }
  document.getElementById("property-form").style.display = "block";
  document.getElementById("property-form-title").textContent = "✏️ Edit Property";
  sv("prop-id", p.id);
  sv("prop-name", p.name||"");
  sv("prop-address", p.address||"");
  sv("prop-units", p.units||"");
  sv("prop-notes", p.notes||"");
  document.getElementById("prop-type").value = p.type || "apartment";
  document.getElementById("property-form").scrollIntoView({behavior:"smooth"});
};

window.cancelPropertyForm = ()=>{
  document.getElementById("property-form").style.display = "none";
};

window.saveProperty = async()=>{
  let id = g("prop-id");
  let name = g("prop-name"), address = g("prop-address");
  if(!name){ toast("Property name is required","error"); document.getElementById("prop-name").classList.add("field-error"); return; }
  if(!address){ toast("Address is required","error"); document.getElementById("prop-address").classList.add("field-error"); return; }
  let ownerID = localStorage.getItem("kb_owner_id") || "";
  let units = Number(g("prop-units")) || 0;
  let data = {
    name, address,
    type: document.getElementById("prop-type").value || "apartment",
    units,
    notes: g("prop-notes"),
    ownerID,
    updatedOn: new Date().toISOString()
  };
  try{
    if(id){
      await fbUpdate("properties", id, data);
      toast(`✅ Property "${name}" updated`);
      await logActivity("Property Updated", `Name: ${name}`, "Owner");
      cancelPropertyForm();
    } else {
      data.createdOn = new Date().toISOString();
      // If user gave a unit count > 0, ask if they want rooms auto-created
      if(units > 0){
        let autoCreate = confirm(`Create ${units} room${units>1?"s":""} now (Room 101, Room 102, ...)?\n\nClick OK to auto-create. Click Cancel to add rooms manually later.`);
        if(autoCreate){
          // Try to figure out starting number — default to 101
          let startInput = prompt("Starting room number? (e.g. 101 → creates 101, 102, 103...)", "101");
          let start = parseInt(startInput, 10);
          if(!isNaN(start)){
            let roomsArr = [];
            for(let i=0;i<units;i++) roomsArr.push({roomNum: String(start+i), floor:"", notes:""});
            data.rooms = roomsArr;
          }
        }
      }
      await fbAdd("properties", data);
      toast(`✅ Property "${name}" added — scroll down to view`);
      await logActivity("Property Added", `Name: ${name}`, "Owner");
      cancelPropertyForm();
      // Scroll to the property list area after a brief delay (so the snapshot has time to fire)
      setTimeout(()=>{
        let listEl = document.getElementById("properties-list");
        if(listEl) listEl.scrollIntoView({behavior:"smooth", block:"start"});
      }, 500);
    }
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.deleteProperty = async(id, name)=>{
  let linkedTenants = tenants.filter(t=>t.propertyId===id && t.active!==false);
  if(linkedTenants.length){
    alert(`Cannot delete "${name}" — it has ${linkedTenants.length} active tenant(s) linked to it.\n\nFirst move or remove those tenants, then try again.`);
    return;
  }
  if(!confirm(`Delete property "${name}"? This cannot be undone.`)) return;
  try{
    await fbDel("properties", id);
    toast("🗑 Property deleted");
    await logActivity("Property Deleted", `Name: ${name}`, "Owner");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

// v13: claim orphan property (link to current owner)
window.claimOrphanProperty = async(propId)=>{
  let ownerID = localStorage.getItem("kb_owner_id") || "";
  if(!ownerID){ toast("Session expired — log in again","error"); return; }
  if(!confirm("Link this property to your account?")) return;
  try{
    await fbUpdate("properties", propId, {ownerID, claimedOn:new Date().toISOString()});
    toast("✅ Property linked to your account");
    await logActivity("Property Claimed", `ID: ${propId}`, "Owner");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.renderProperties = ()=>{
  let list = document.getElementById("properties-list");
  if(!list) return;
  if(!properties.length){
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🏘️</div><div class="empty-text">No properties added yet</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Click "Add New Property" above to add your first property and its rooms.</div></div>`;
    return;
  }
  properties.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  list.innerHTML = properties.map(p=>{
    // Only approved + active tenants count as occupying a room (same filter as updateOwnerStats)
    let myTenants = tenants.filter(t=>t.propertyId===p.id && t.approved && t.active!==false);
    // Rooms come from p.rooms array — use a copy to avoid mutating the property object
    let propRooms = Array.isArray(p.rooms) ? [...p.rooms] : [];
    // Also include any rooms occupied by tenants that aren't yet in p.rooms
    myTenants.forEach(t=>{
      if(t.room && !propRooms.find(r=>r.roomNum===t.room)){
        propRooms.push({roomNum:t.room, floor:"", notes:"(auto-added from tenant)"});
      }
    });
    // Use unique occupied room set — same method as updateOwnerStats so tile and tab agree
    let occupiedRooms = new Set(myTenants.map(t=>String(t.room||"").trim()).filter(Boolean));
    let occupied = occupiedRooms.size;
    let totalUnits = propRooms.length || Number(p.units)||0;
    let vacant = Math.max(0, totalUnits - occupied);
    let typeIcons = {apartment:"🏢",house:"🏠",villa:"🏡",pg:"🏨",commercial:"🏬",other:"🏗️"};
    let icon = typeIcons[p.type] || "🏘️";
    let roomsHtml = "";
    if(propRooms.length){
      roomsHtml = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.5px;text-transform:uppercase">🚪 Rooms (${propRooms.length})</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">
          ${propRooms.map((r,idx)=>{
            let t = myTenants.find(x=>String(x.room).trim()===String(r.roomNum).trim());
            let isOcc = !!t;
            return `<div style="background:${isOcc?"var(--green-g)":"var(--s3)"};border:1px solid ${isOcc?"rgba(34,197,94,.3)":"var(--border)"};border-radius:var(--rs);padding:8px;text-align:center;position:relative">
              <div style="font-weight:800;font-size:13px;color:${isOcc?"var(--green)":"var(--text)"}">Room ${esc(r.roomNum)}</div>
              <div style="font-size:9px;color:var(--text3);font-weight:600;margin-top:2px">${isOcc?esc(t.name):"Vacant"}</div>
              ${r.floor?`<div style="font-size:8px;color:var(--text3);font-weight:500;margin-top:2px">${esc(r.floor)}</div>`:""}
              ${!isOcc?`<button onclick="removeRoomFromProperty('${p.id}','${esc(r.roomNum)}')" style="position:absolute;top:2px;right:2px;background:none;border:none;color:var(--red);font-size:10px;cursor:pointer;padding:2px 4px">✕</button>`:""}
            </div>`;
          }).join("")}
        </div>
      </div>`;
    }
    return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:15px;display:flex;align-items:center;gap:6px"><span>${icon}</span><span>${esc(p.name||"Untitled")}</span></div>
          <div style="font-size:11px;color:var(--text3);font-weight:500;margin-top:3px">${esc(p.address||"")}</div>
          ${p.notes?`<div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:3px;font-style:italic">${esc(p.notes)}</div>`:""}
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn btn-edit" style="padding:4px 8px;font-size:11px" onclick="openEditProperty('${p.id}')">✏️</button>
          <button class="btn btn-danger" style="padding:4px 8px;font-size:11px" onclick="deleteProperty('${p.id}','${escAttr(p.name||"")}')">🗑</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        <div style="background:var(--green-g);border:1px solid rgba(34,197,94,.2);border-radius:var(--rs);padding:8px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--green)">${occupied}</div>
          <div style="font-size:9px;color:var(--text3);font-weight:600">Occupied</div>
        </div>
        <div style="background:var(--gold-g);border:1px solid rgba(245,166,35,.2);border-radius:var(--rs);padding:8px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--gold)">${vacant}</div>
          <div style="font-size:9px;color:var(--text3);font-weight:600">Vacant</div>
        </div>
        <div style="background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:8px;text-align:center">
          <div style="font-size:18px;font-weight:800;color:var(--text)">${totalUnits||"–"}</div>
          <div style="font-size:9px;color:var(--text3);font-weight:600">Total Rooms</div>
        </div>
      </div>
      ${roomsHtml}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <input id="newroom-${p.id}" placeholder="Room number (e.g. 101)" style="flex:1;min-width:120px;margin:0;padding:7px 10px"/>
        <input id="newroomfloor-${p.id}" placeholder="Floor (optional)" style="flex:1;min-width:100px;margin:0;padding:7px 10px"/>
        <button class="btn btn-success" style="padding:7px 14px;font-size:11px" onclick="addRoomToProperty('${p.id}')">➕ Add Room</button>
      </div>
    </div>`;
  }).join("");
};

window.addRoomToProperty = async(propId)=>{
  let roomNum = (document.getElementById("newroom-"+propId)?.value||"").trim();
  let floor = (document.getElementById("newroomfloor-"+propId)?.value||"").trim();
  if(!roomNum){ toast("Enter a room number","error"); return; }
  let p = properties.find(x=>x.id===propId);
  if(!p){ toast("Property not found","error"); return; }
  let propRooms = Array.isArray(p.rooms) ? [...p.rooms] : [];
  if(propRooms.find(r=>String(r.roomNum).trim()===roomNum)){
    toast("Room "+roomNum+" already exists in this property","error"); return;
  }
  propRooms.push({roomNum, floor, notes:""});
  try{
    await fbUpdate("properties", propId, {rooms: propRooms, updatedOn:new Date().toISOString()});
    toast(`✅ Room ${roomNum} added`);
    document.getElementById("newroom-"+propId).value="";
    document.getElementById("newroomfloor-"+propId).value="";
    await logActivity("Room Added", `Property: ${p.name}, Room: ${roomNum}`, "Owner");
  }catch(e){ toast("Error: "+(e.message||"unknown"),"error"); }
};

window.removeRoomFromProperty = async(propId, roomNum)=>{
  let p = properties.find(x=>x.id===propId);
  if(!p) return;
  // Check if occupied
  let t = tenants.find(x=>x.propertyId===propId && String(x.room).trim()===String(roomNum).trim() && x.active!==false);
  if(t){ toast(`Room ${roomNum} has tenant ${t.name}. Move/remove them first.`,"error"); return; }
  if(!confirm(`Remove Room ${roomNum} from ${p.name}?`)) return;
  let propRooms = (p.rooms||[]).filter(r=>String(r.roomNum).trim()!==String(roomNum).trim());
  try{
    await fbUpdate("properties", propId, {rooms:propRooms, updatedOn:new Date().toISOString()});
    toast(`🗑 Room ${roomNum} removed`);
  }catch(e){ toast("Error","error"); }
};

