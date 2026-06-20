import { db, fbGet, fbAdd, fbUpdate } from './firebase.js';
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, esc, escAttr, closeModal } from './helpers.js';

// v13 ROUND 2: VACANCY BREAKDOWN, FAQ, CONTACT, HELP BOT, WALKTHROUGH
// ═════════════════════════════════════════════════════════════

// ── VACANCY BREAKDOWN MODAL ──────────────────────────────────
// v13.x: tenant pending bills detail modal
window.openPendingDetailsModal = (tenantName)=>{
  let bills = window._tenantUnpaidBills || [];
  if(!bills.length){
    toast("No pending bills","info");
    return;
  }
  let titleEl = document.getElementById("pd-title");
  let subEl = document.getElementById("pd-sub");
  let contentEl = document.getElementById("pd-content");
  let totalPending = bills.reduce((s,b)=>s+Number(b.total||0),0);
  let overdueCount = bills.filter(b=>getBillStatus(b)==="overdue").length;

  titleEl.textContent = overdueCount ? "🚨 Pending Bills" : "📄 Pending Bills";
  subEl.innerHTML = `<strong style="color:var(--text2)">${bills.length}</strong> unpaid bill${bills.length===1?"":"s"} · Total <strong style="color:var(--gold)">${fmtMoney(totalPending)}</strong>${overdueCount?` · <span style="color:var(--red);font-weight:700">${overdueCount} overdue</span>`:""}`;

  // Summary panel at the top
  let summary = `<div style="background:var(--red-g);border:1px solid rgba(244,63,94,.25);border-radius:var(--rs);padding:12px;margin-bottom:14px;text-align:center">
    <div style="font-size:10px;color:var(--text3);font-weight:700;letter-spacing:.5px;margin-bottom:4px">TOTAL PENDING</div>
    <div style="font-size:28px;font-weight:800;color:var(--red)">${fmtMoney(totalPending)}</div>
    <div style="font-size:11px;color:var(--text3);font-weight:500;margin-top:4px">across ${bills.length} bill${bills.length===1?"":"s"}</div>
  </div>`;

  // Sort: overdue first (oldest first), then due (oldest first), then upcoming
  let sorted = [...bills].sort((a,b)=>{
    let sa = getBillStatus(a), sb = getBillStatus(b);
    let ord = {overdue:0, due:1, upcoming:2};
    if(ord[sa]!==ord[sb]) return (ord[sa]||3)-(ord[sb]||3);
    return new Date(a.dueDate||0) - new Date(b.dueDate||0);
  });

  let cards = sorted.map(b=>{
    let s = getBillStatus(b);
    let badge = s==="overdue" ? `<span style="background:var(--red-g);color:var(--red);padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700">🚨 Overdue</span>`
              : s==="due" ? `<span style="background:var(--orange-g);color:var(--orange);padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700">⏰ Due Now</span>`
              : `<span style="background:var(--s3);color:var(--text3);padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700">📅 Upcoming</span>`;
    let daysInfo = "";
    if(b.dueDate){
      let due = new Date(b.dueDate);
      let now = new Date();
      let diff = Math.floor((due - now) / 86400000);
      if(diff<0) daysInfo = `<span style="color:var(--red);font-weight:700">Overdue by ${Math.abs(diff)} day${Math.abs(diff)===1?"":"s"}</span>`;
      else if(diff===0) daysInfo = `<span style="color:var(--orange);font-weight:700">Due today</span>`;
      else daysInfo = `<span style="color:var(--text3);font-weight:600">Due in ${diff} day${diff===1?"":"s"}</span>`;
    }
    let itemsHtml = "";
    if(b.items && b.items.length){
      itemsHtml = `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        ${b.items.map(i=>`<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);padding:2px 0"><span>${esc(i.name||i.label||"")}</span><span style="font-weight:600">${fmtMoney(i.amount)}</span></div>`).join("")}
      </div>`;
    }
    return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:8px;border-left:3px solid ${s==="overdue"?"var(--red)":s==="due"?"var(--orange)":"var(--blue)"}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div>
          <div style="font-weight:800;font-size:14px;color:var(--text)">${esc(b.monthLabel||"–")}</div>
          <div style="font-size:11px;color:var(--text3);font-weight:500;margin-top:2px">Due: ${b.dueDate?fmtDate(b.dueDate):"–"} · ${daysInfo}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:800;color:var(--gold)">${fmtMoney(b.total)}</div>
          <div style="margin-top:4px">${badge}</div>
        </div>
      </div>
      ${itemsHtml}
    </div>`;
  }).join("");

  contentEl.innerHTML = summary + cards;
  document.getElementById("pending-details-modal").classList.add("open");
};

window.openVacancyBreakdownModal = (breakdown)=>{
  let data = breakdown || window._vacancyBreakdown || [];
  let totalV = data.reduce((s,p)=>s+p.vacant,0);
  let totalR = data.reduce((s,p)=>s+p.total,0);
  let html = `<div style="background:var(--gold-g);border:1px solid rgba(245,166,35,.3);border-radius:var(--rs);padding:12px;margin-bottom:14px;text-align:center">
    <div style="font-size:11px;color:var(--text3);font-weight:600;margin-bottom:4px">Total Across All Properties</div>
    <div style="font-size:26px;font-weight:800;color:var(--gold)">${totalV}</div>
    <div style="font-size:11px;color:var(--text3);font-weight:600;margin-top:4px">vacant out of ${totalR} room${totalR===1?"":"s"}</div>
  </div>`;
  if(!data.length){
    html += `<div class="empty-state"><div class="empty-icon">🏘️</div><div class="empty-text">No properties added yet</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Add properties in the Properties &amp; Rooms tab to track vacancy.</div></div>`;
  } else {
    html += data.map(p=>{
      let pct = p.total>0 ? Math.round((p.occupied/p.total)*100) : 0;
      let barColor = p.vacant===0 ? "var(--green)" : (p.vacant/p.total > 0.5 ? "var(--red)" : "var(--gold)");
      return `<div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--rs);padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-weight:700;font-size:13px">${esc(p.name)}</div>
            <div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:2px">${p.occupied} occupied · ${p.vacant} vacant · ${p.total} total</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:800;color:${barColor}">${p.vacant}</div>
            <div style="font-size:9px;color:var(--text3);font-weight:600">vacant</div>
          </div>
        </div>
        <div style="background:var(--s3);height:8px;border-radius:99px;overflow:hidden">
          <div style="background:${barColor};height:100%;width:${pct}%;transition:width .4s"></div>
        </div>
        <div style="font-size:10px;color:var(--text3);font-weight:500;margin-top:4px;text-align:right">${pct}% occupied</div>
      </div>`;
    }).join("");
  }
  document.getElementById("vacancy-modal-content").innerHTML = html;
  document.getElementById("vacancy-modal").classList.add("open");
};

// ── FAQ DATA + RENDER ────────────────────────────────────────
const FAQ_DATA = [
  {
    q: "How do I add a new property?",
    a: `<ol>
      <li>Go to <strong>🏘️ Properties &amp; Rooms</strong> tab.</li>
      <li>Click <strong>"➕ Add New Property"</strong>.</li>
      <li>Fill in Property Name, Address, Type (Apartment / House / Villa / PG / Commercial).</li>
      <li>Enter <strong>Total Units / Rooms</strong> (e.g. 10).</li>
      <li>Click <strong>💾 Save Property</strong>. It will ask if you want to auto-create 10 rooms numbered starting from 101.</li>
      <li>You can also add rooms manually inside the property card afterward.</li>
    </ol>`,
    tags:"property add new build"
  },
  {
    q: "How do I add rooms to a property?",
    a: `<p>You have two ways:</p>
      <ol>
        <li><strong>Auto-create on save</strong> — when adding a property, enter Total Units &gt; 0 and confirm the prompt. Rooms 101, 102, 103… will be created automatically.</li>
        <li><strong>Manual add</strong> — inside each property card, scroll to the bottom row: enter Room number (e.g. <code>201</code>) + Floor (optional) → click <strong>➕ Add Room</strong>.</li>
      </ol>
      <p>Vacant rooms appear gray; occupied rooms appear green with the tenant's name.</p>`,
    tags:"room add unit"
  },
  {
    q: "How do I add a tenant?",
    a: `<ol>
      <li>Go to <strong>➕ Add Tenant</strong> tab.</li>
      <li>Pick the <strong>Property</strong> from the dropdown (or leave as Default).</li>
      <li>Enter Full Name, Room number, Monthly Rent.</li>
      <li>Optionally add Security Deposit and Advance Rent.</li>
      <li>Fill phone, email, ID details, move-in date.</li>
      <li>Click <strong>➕ Add Tenant</strong>. A default password is auto-generated (last 6 digits of phone, or "kiraabook").</li>
      <li>Share the credentials with the tenant. They can log in and complete their profile.</li>
    </ol>`,
    tags:"tenant add new resident"
  },
  {
    q: "How does billing work?",
    a: `<p>KiraaBook supports two bill modes per tenant:</p>
      <ul>
        <li><strong>Automatic</strong> — same rent every month, auto-created bills.</li>
        <li><strong>Manual</strong> — you create each bill yourself (useful for variable rent or extra charges).</li>
      </ul>
      <p>To create a bill manually:</p>
      <ol>
        <li>Open <strong>📄 Create Bill</strong> tab.</li>
        <li>Select the tenant.</li>
        <li>Add line items: rent, electricity, water, etc.</li>
        <li>Set due date.</li>
        <li>Click <strong>Create Bill</strong>.</li>
      </ol>
      <p>All bills appear in the <strong>📋 All Bills</strong> tab. Click "PDF" on any bill to download a professional invoice. Mark bills as paid when received.</p>`,
    tags:"bill payment invoice rent monthly"
  },
  {
    q: "How does vacant room tracking work?",
    a: `<p>The <strong>Rooms Vacant</strong> tile on your dashboard shows the total vacant rooms across all properties.</p>
      <p><strong>Calculation:</strong> for each property, vacant = (total rooms in that property) − (rooms occupied by active tenants).</p>
      <p>Tap the Rooms Vacant tile to see a per-property breakdown showing how many rooms are vacant in each property, with an occupancy percentage bar.</p>
      <p>If a tenant is deactivated, their room becomes vacant automatically.</p>`,
    tags:"vacant rooms occupancy empty available"
  },
  {
    q: "How do I manage maintenance requests?",
    a: `<p>When a tenant raises an issue, you'll see:</p>
      <ul>
        <li>A bell notification (top right header)</li>
        <li>The ticket in your <strong>🔧 Maintenance</strong> tab</li>
      </ul>
      <p><strong>To respond:</strong></p>
      <ol>
        <li>Click the ticket card to expand details.</li>
        <li>See the description, photo, priority, and tenant info.</li>
        <li>Write a <strong>Resolution Note</strong> (e.g. "Plumber scheduled for Friday").</li>
        <li>Pick an <strong>ETA Date</strong> if you can estimate.</li>
        <li>Click <strong>💾 Save Note</strong>. The tenant sees this immediately.</li>
        <li>Use the <strong>Conversation</strong> panel to chat back and forth with the tenant.</li>
        <li>Update <strong>Status</strong> dropdown: Open → In Progress → Resolved → Closed.</li>
      </ol>`,
    tags:"maintenance ticket repair issue fix"
  },
  {
    q: "How are security deposits and advance rent handled?",
    a: `<p><strong>🔒 Security Deposit</strong> is a refundable amount held at the start of tenancy. It's recorded against the tenant's profile and shown in their Financial Summary card. When the tenant vacates, you refund it (minus any dues or damages).</p>
      <p><strong>💰 Advance Rent</strong> is a credit balance for future rent. Currently it's tracked as a balance — you decide when to apply it toward an upcoming bill manually (by reducing the bill amount). Future versions will support auto-deduction.</p>
      <p>Both amounts are visible on:</p>
      <ul>
        <li>The tenant's "View Details" modal (owner side)</li>
        <li>The tenant's Financial Summary card (tenant side)</li>
        <li>The auto-generated Rent Agreement PDF</li>
      </ul>`,
    tags:"deposit advance security refund balance"
  },
  {
    q: "How does room history work?",
    a: `<p>The <strong>📜 Room History</strong> tab shows a timeline of every tenant who has occupied each room.</p>
      <p>Each entry records:</p>
      <ul>
        <li>Tenant name</li>
        <li>Move-in date</li>
        <li>Move-out date (when deactivated)</li>
        <li>Duration of stay</li>
        <li>Rent amount at the time</li>
      </ul>
      <p>This is useful for keeping a multi-year record (e.g. 2+ years of tenants in one room) for legal/tax purposes.</p>`,
    tags:"room history past tenants timeline record"
  },
  {
    q: "What happens when I deactivate a tenant?",
    a: `<p>Deactivating a tenant:</p>
      <ul>
        <li>Removes them from your active tenant count</li>
        <li>Marks their room as vacant in the dashboard tile</li>
        <li>Closes their room history entry (records move-out date)</li>
        <li>Prevents them from logging in until reactivated</li>
        <li>Does NOT delete their data — past bills, payments, and history remain</li>
      </ul>
      <p>To deactivate: open the tenant in <strong>Manage Tenants</strong> → click <strong>⏸ Deactivate</strong>.</p>`,
    tags:"deactivate tenant remove disable"
  },
  {
    q: "How do I send rent reminders via WhatsApp?",
    a: `<p>KiraaBook tracks reminder schedule per bill:</p>
      <ul>
        <li>3 days before due → 1 reminder</li>
        <li>2 days before due → 1 reminder</li>
        <li>1 day before due → 1 reminder</li>
        <li>On due day → 2 reminders (morning + evening)</li>
        <li>Overdue days 1–7 → 3 reminders/day</li>
      </ul>
      <p>The dashboard shows pending reminders. Click <strong>💬 Send Now</strong> next to each one — it opens a WhatsApp tab with a pre-filled message. Send it from there.</p>
      <p><strong>Note:</strong> True automated sending (without opening WhatsApp) requires the WhatsApp Business API (paid) — not available in this version.</p>`,
    tags:"whatsapp reminder due overdue rent"
  },
  {
    q: "How do I generate a Rent Agreement?",
    a: `<ol>
      <li>Go to <strong>Manage Tenants</strong> → click a tenant's <strong>👁 View Details</strong>.</li>
      <li>Click <strong>📄 Rent Agreement</strong>.</li>
      <li>Choose a template: Residential / Commercial / PG / Custom.</li>
      <li>Review pre-filled fields (owner, tenant, property, rent, deposit, dates).</li>
      <li>Edit any clauses (maintenance, utilities, rules, custom).</li>
      <li>Fill signature names and place of signing.</li>
      <li>Click <strong>Generate PDF</strong>.</li>
    </ol>
    <p>The PDF downloads to your device AND is saved to the tenant's record. Tenant can download it anytime from their Documents card.</p>`,
    tags:"rent agreement lease contract pdf"
  },
  {
    q: "I forgot my password — what do I do?",
    a: `<p>On the login screen, click <strong>"Forgot password?"</strong>.</p>
      <ol>
        <li>Enter your registered phone number with country code (e.g. <code>+919876543210</code>).</li>
        <li>Click <strong>📨 Send OTP via SMS</strong>.</li>
        <li>Enter the 6-digit code from the SMS.</li>
        <li>Set your new password.</li>
      </ol>
      <p><strong>Requires:</strong> Firebase Phone Auth enabled in your project (Authentication → Sign-in method → Phone). If unavailable, use "verify by phone-match only" as a fallback.</p>`,
    tags:"password forgot reset otp sms"
  },
  {
    q: "How do I contact support?",
    a: `<p>Go to <strong>📞 Contact Us</strong> tab. Three ways:</p>
      <ul>
        <li>📧 Email — <code>support@kiraabook.com</code></li>
        <li>💬 WhatsApp — opens a pre-filled chat</li>
        <li>📨 Submit a support ticket form right inside the app</li>
      </ul>
      <p>Response time is typically within 24 hours.</p>`,
    tags:"contact support help email whatsapp"
  }
];

window.renderFaqList = ()=>{
  let listEl = document.getElementById("faq-list");
  if(!listEl) return;
  let q = (document.getElementById("faq-search")?.value || "").trim().toLowerCase();
  let filtered = FAQ_DATA;
  if(q){
    filtered = FAQ_DATA.filter(f=>{
      let blob = (f.q + " " + (f.tags||"") + " " + f.a.replace(/<[^>]+>/g,"")).toLowerCase();
      return blob.includes(q);
    });
  }
  if(!filtered.length){
    listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">No FAQs match "${esc(q)}"</div><div style="font-size:11px;color:var(--text3);margin-top:6px">Try a different search or use Contact Us for help.</div></div>`;
    return;
  }
  listEl.innerHTML = filtered.map((f,i)=>`
    <div class="faq-item" id="faq-item-${i}">
      <div class="faq-q" onclick="toggleFaq(${i})">
        <span>${esc(f.q)}</span>
        <span class="faq-q-icon">▼</span>
      </div>
      <div class="faq-a">${f.a}</div>
    </div>`).join("");
};

window.toggleFaq = (i)=>{
  let el = document.getElementById("faq-item-"+i);
  if(el) el.classList.toggle("open");
};

// ── CONTACT FORM ─────────────────────────────────────────────
window.submitSupportTicket = async()=>{
  let subject = g("ct-subject"), category = g("ct-category"), message = g("ct-message");
  if(!subject){ toast("Subject is required","error"); document.getElementById("ct-subject").classList.add("field-error"); return; }
  if(!message){ toast("Please write your message","error"); document.getElementById("ct-message").classList.add("field-error"); return; }
  if(message.length<10){ toast("Please add more detail (at least 10 characters)","error"); return; }
  let screenshot = document.getElementById("ct-photo-data")?.value || "";
  let owner = currentOwnerData;
  let data = {
    subject, category, message,
    screenshot,
    fromOwnerID: localStorage.getItem("kb_owner_id") || "",
    fromOwnerName: owner?.name || localStorage.getItem("kb_owner_name") || "",
    fromOwnerEmail: owner?.email || "",
    fromOwnerPhone: owner?.phone || "",
    createdOn: new Date().toISOString(),
    status: "new"
  };
  try{
    await fbAdd("supportTickets", data);
    toast("✅ Message sent! We'll respond within 24 hours.","success");
    sv("ct-subject",""); sv("ct-message",""); sv("ct-photo-data","");
    document.getElementById("ct-category").value = "bug";
    // Reset screenshot preview
    let prev = document.getElementById("ct-photo-prev");
    if(prev) prev.innerHTML = `<span style="font-size:22px">📷</span><span style="font-size:10px;color:var(--text3);font-weight:600;margin-top:4px">Tap to attach a screenshot</span>`;
    try{ await logActivity("Support Ticket Submitted", `Subject: ${subject}, Category: ${category}`, owner?.name||"Owner"); }catch(e){}
    // Close the modal
    setTimeout(()=>closeModal("contact-modal"), 700);
  }catch(e){
    let msg = e.message||"unknown";
    if(msg.includes("size") || msg.includes("too large")){
      toast("Screenshot too large. Try a smaller image (under 800KB).","error");
    } else {
      toast("Error sending: "+msg,"error");
    }
  }
};

// ═════════════════════════════════════════════════════════════
// KIRAABOT v2 — help & support assistant
// Designed to be intuitive and self-serve. All onclick handlers
// are exposed on window so they work inside strict-mode modules.
// ═════════════════════════════════════════════════════════════
const SUPPORT_EMAIL = "support@kiraabook.com"; // change here to update everywhere
const SUPPORT_WHATSAPP = "918860654694";       // owner's support WhatsApp

const HELP_TOPICS = {
  start: {
    title: "🎯 Getting Started",
    intro: "Set up KiraaBook in 3 minutes — here's the quickest path.",
    steps: [
      "1️⃣ <strong>Properties &amp; Rooms</strong> tab — add your first building/house.",
      "2️⃣ When prompted, let KiraaBook auto-create rooms (101, 102, 103…) based on unit count.",
      "3️⃣ Switch to <strong>Add Tenant</strong> tab — pick the property and assign a room.",
      "4️⃣ The tenant gets a default password — share it with them.",
      "5️⃣ Bills auto-create monthly (or create them from <strong>Create Bill</strong>).",
      "6️⃣ Track everything from your dashboard tiles."
    ],
    jumpTo: "properties"
  },
  properties: {
    title: "🏘️ Properties &amp; Rooms",
    intro: "Properties are buildings/houses. Each one holds multiple rooms.",
    steps: [
      "🔹 Add a property → enter name, address, type, unit count.",
      "🔹 Optionally auto-create numbered rooms when saving.",
      "🔹 Manually add a room: type room number at the bottom of each property card.",
      "🔹 Green room = occupied. Gray = vacant.",
      "🔹 Click ✕ on a vacant room to remove it.",
      "🔹 Vacant rooms are counted in the dashboard tile."
    ],
    jumpTo: "properties"
  },
  tenants: {
    title: "🏠 Tenants",
    intro: "Add tenants and let them log in to their own portal.",
    steps: [
      "🔹 <strong>Add Tenant</strong> tab — pick property, room, rent.",
      "🔹 Optional: enter Security Deposit and Advance Rent.",
      "🔹 Default password is last 6 digits of phone.",
      "🔹 Tenants log in at the same URL — choose Tenant role.",
      "🔹 They complete their own profile (photo, ID, etc).",
      "🔹 <strong>Manage Tenants</strong> → tap any tenant for full details, edit, rent agreement, deactivate, or delete."
    ],
    jumpTo: "add-tenant"
  },
  bills: {
    title: "💰 Bills &amp; Payments",
    intro: "Two bill modes: Automatic (same monthly amount) or Manual.",
    steps: [
      "🔹 <strong>Create Bill</strong> → select tenant → add line items → due date → save.",
      "🔹 <strong>All Bills</strong> → see, mark paid, download PDF, or delete.",
      "🔹 Dashboard tiles show <strong>Collected this month</strong> and <strong>Pending</strong>.",
      "🔹 Click either tile to see breakdown with PDF and WhatsApp options.",
      "🔹 Tenants can pay via UPI link or click 'I have paid' for owner approval."
    ],
    jumpTo: "billing"
  },
  maintenance: {
    title: "🔧 Maintenance",
    intro: "Tenants raise issues. You respond with status + ETA.",
    steps: [
      "🔹 Tenant submits a ticket from their dashboard → category, priority, description, photo.",
      "🔹 You see it instantly in 🔧 Maintenance tab.",
      "🔹 Click the ticket to expand → see photo, write a Resolution Note, set ETA date.",
      "🔹 Use the Conversation panel to chat back and forth with the tenant.",
      "🔹 Update Status: Open → In Progress → Resolved → Closed."
    ],
    jumpTo: "maintenance"
  },
  account: {
    title: "👤 My Account &amp; Plan",
    intro: "Manage your profile, plan, and settings.",
    steps: [
      "🔹 Upload a profile photo (tap the avatar circle).",
      "🔹 Edit name, phone, email, password.",
      "🔹 Change currency, toggle notifications.",
      "🔹 Export your data.",
      "🔹 Upgrade plan: 30-day free trial → Monthly (₹40) or Annual (₹499)."
    ],
    jumpTo: "account"
  },
  troubleshoot: {
    title: "🛠️ Troubleshooting",
    intro: "Quick fixes for common issues.",
    steps: [
      "<strong>App seems slow / data not loading:</strong> Press Ctrl+Shift+R to hard-refresh.",
      "<strong>Login not working:</strong> Use 'Forgot Password?' on the login screen.",
      "<strong>Tenant can't log in:</strong> Check the password you shared (it's the last 6 digits of their phone). Reset from Manage Tenants → Edit.",
      "<strong>Numbers look wrong:</strong> Verify the tenant's property and room are correctly assigned in Properties &amp; Rooms.",
      "<strong>Still stuck?</strong> Use the 'Contact Support' button below — we reply within 24 hours."
    ],
    jumpTo: null
  }
};

let _helpBotView = "menu"; // "menu" | "topic" | "search" | "results"
let _helpBotCurrentTopic = null;
let _helpBotSearchResults = [];
let _helpBotSearchQuery = "";

// Entry point — opens the help bot
window.openHelpBot = ()=>{
  document.getElementById("help-bot-modal").classList.add("open");
  _helpBotView = "menu";
  renderHelpBotPanel();
  setTimeout(()=>{ document.getElementById("help-bot-input")?.focus(); }, 100);
};

// Main view renderer — switches between menu / topic detail / search results
window.renderHelpBotPanel = ()=>{
  let el = document.getElementById("help-bot-content");
  if(!el) return;
  if(_helpBotView === "menu") el.innerHTML = renderHelpBotMenu();
  else if(_helpBotView === "topic") el.innerHTML = renderHelpBotTopic();
  else if(_helpBotView === "results") el.innerHTML = renderHelpBotResults();
  el.scrollTop = 0;
};

function renderHelpBotMenu(){
  let topicCards = Object.entries(HELP_TOPICS).map(([key,t])=>`
    <div class="hbot-topic-card" onclick="helpBotOpenTopic('${key}')">
      <div class="hbot-topic-title">${t.title}</div>
      <div class="hbot-topic-desc">${esc(t.intro)}</div>
    </div>
  `).join("");
  return `
    <div class="hbot-welcome">
      <div class="hbot-welcome-icon">🤖</div>
      <div class="hbot-welcome-title">Hi! I'm KiraaBot.</div>
      <div class="hbot-welcome-sub">Ask me anything about KiraaBook, or pick a topic below.</div>
    </div>
    <div class="hbot-grid">${topicCards}</div>
    <div class="hbot-divider"><span>or</span></div>
    <div class="hbot-actions">
      <button class="hbot-action-btn" onclick="helpBotStartWalkthrough()">
        <span style="font-size:18px">🚀</span>
        <span>Take a guided tour</span>
      </button>
      <button class="hbot-action-btn" onclick="helpBotOpenFaq()">
        <span style="font-size:18px">❓</span>
        <span>Browse full FAQ</span>
      </button>
      <button class="hbot-action-btn hbot-action-primary" onclick="helpBotOpenContact()">
        <span style="font-size:18px">📞</span>
        <span>Contact Support Team</span>
      </button>
    </div>
  `;
}

function renderHelpBotTopic(){
  let topic = HELP_TOPICS[_helpBotCurrentTopic];
  if(!topic) return renderHelpBotMenu();
  let jumpBtn = topic.jumpTo ? `<button class="hbot-action-btn hbot-action-primary" onclick="helpBotJumpToTab('${topic.jumpTo}')"><span style="font-size:18px">🎯</span><span>Take me to this section</span></button>` : "";
  return `
    <div class="hbot-topic-header">
      <button class="hbot-back-btn" onclick="helpBotBackToMenu()">← Back</button>
      <div class="hbot-topic-h-title">${topic.title}</div>
    </div>
    <div class="hbot-topic-intro">${esc(topic.intro)}</div>
    ${topic.steps.map(s=>`<div class="hbot-stepline">${s}</div>`).join("")}
    <div class="hbot-actions" style="margin-top:14px">
      ${jumpBtn}
      <button class="hbot-action-btn" onclick="helpBotBackToMenu()"><span style="font-size:18px">📚</span><span>Other topics</span></button>
      <button class="hbot-action-btn" onclick="helpBotOpenContact()"><span style="font-size:18px">📞</span><span>Still need help? Contact support</span></button>
    </div>
  `;
}

function renderHelpBotResults(){
  if(!_helpBotSearchResults.length){
    return `
      <div class="hbot-results-header">
        <button class="hbot-back-btn" onclick="helpBotBackToMenu()">← Back</button>
        <div class="hbot-topic-h-title">No matches for "${esc(_helpBotSearchQuery)}"</div>
      </div>
      <div class="hbot-no-results">
        <div style="font-size:34px;margin-bottom:8px">🤔</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px;line-height:1.5">I couldn't find a direct answer. Try rephrasing or pick one of these:</div>
        <div class="hbot-actions">
          <button class="hbot-action-btn" onclick="helpBotBackToMenu()"><span style="font-size:18px">📚</span><span>Browse all topics</span></button>
          <button class="hbot-action-btn" onclick="helpBotOpenFaq()"><span style="font-size:18px">❓</span><span>Browse full FAQ</span></button>
          <button class="hbot-action-btn hbot-action-primary" onclick="helpBotOpenContact()"><span style="font-size:18px">📞</span><span>Contact Support</span></button>
        </div>
      </div>
    `;
  }
  return `
    <div class="hbot-results-header">
      <button class="hbot-back-btn" onclick="helpBotBackToMenu()">← Back</button>
      <div class="hbot-topic-h-title">${_helpBotSearchResults.length} result${_helpBotSearchResults.length===1?"":"s"} for "${esc(_helpBotSearchQuery)}"</div>
    </div>
    ${_helpBotSearchResults.map(f=>`
      <div class="hbot-result-card">
        <div class="hbot-result-q">${esc(f.q)}</div>
        <div class="hbot-result-a">${f.a}</div>
      </div>
    `).join("")}
    <div class="hbot-actions" style="margin-top:14px">
      <button class="hbot-action-btn" onclick="helpBotBackToMenu()"><span style="font-size:18px">📚</span><span>Back to topics</span></button>
      <button class="hbot-action-btn" onclick="helpBotOpenContact()"><span style="font-size:18px">📞</span><span>Need more help? Contact us</span></button>
    </div>
  `;
}

// ── Navigation handlers (all on window for onclick safety) ──
window.helpBotOpenTopic = (key)=>{
  _helpBotCurrentTopic = key;
  _helpBotView = "topic";
  renderHelpBotPanel();
};
window.helpBotBackToMenu = ()=>{
  _helpBotView = "menu";
  renderHelpBotPanel();
};
window.helpBotJumpToTab = (tabKey)=>{
  closeModal("help-bot-modal");
  // Use jumpToOwnerTab if it exists (owner side)
  if(typeof window.jumpToOwnerTab === "function"){
    window.jumpToOwnerTab(tabKey);
  } else {
    // Fallback: try clicking the tab button directly
    let btns = document.querySelectorAll(".t-tab");
    for(let btn of btns){
      let inline = btn.getAttribute("onclick")||"";
      if(inline.includes(`'${tabKey}'`)){ btn.click(); break; }
    }
  }
};
window.helpBotOpenFaq = ()=>{
  closeModal("help-bot-modal");
  if(typeof window.openFaqModal === "function") window.openFaqModal();
};
window.helpBotOpenContact = ()=>{
  closeModal("help-bot-modal");
  if(typeof window.openContactModal === "function") window.openContactModal();
};

// ── Search ──
window.helpBotAsk = ()=>{
  let inp = document.getElementById("help-bot-input");
  if(!inp) return;
  let q = inp.value.trim();
  if(!q){ inp.focus(); return; }
  _helpBotSearchQuery = q;
  let qLower = q.toLowerCase();
  let words = qLower.split(/\s+/).filter(w=>w.length>2);
  _helpBotSearchResults = FAQ_DATA.filter(f=>{
    let blob = (f.q + " " + (f.tags||"") + " " + f.a.replace(/<[^>]+>/g,"")).toLowerCase();
    if(blob.includes(qLower)) return true;
    return words.length>0 && words.some(w=>blob.includes(w));
  }).slice(0,5);
  _helpBotView = "results";
  renderHelpBotPanel();
  inp.value = "";
};

// ═════════════════════════════════════════════════════════════
// WALKTHROUGH — first-time login guided tour
// ═════════════════════════════════════════════════════════════
const WALKTHROUGH_STEPS = [
  {
    selector: ".t-tab[onclick*=\"'properties'\"]",
    title: "🏘️ Step 1: Add Properties",
    text: "Start here. Click this tab to add the buildings, houses or PG you rent out. Each property can have multiple rooms."
  },
  {
    selector: ".t-tab[onclick*=\"'add-tenant'\"]",
    title: "➕ Step 2: Add Tenants",
    text: "Once you've added a property, switch to this tab to add a tenant. Pick the property + room number, set rent and (optional) security deposit."
  },
  {
    selector: ".t-tab[onclick*=\"'tenants'\"]",
    title: "🏠 Step 3: Manage Tenants",
    text: "See all your tenants here. Click 'View Details' on any card to see their profile, generate a rent agreement, or deactivate them."
  },
  {
    selector: ".t-tab[onclick*=\"'billing'\"]",
    title: "📄 Step 4: Create Bills",
    text: "Generate rent bills here. Auto-created monthly or manual with multiple line items (rent, electricity, water etc.)."
  },
  {
    selector: ".t-tab[onclick*=\"'maintenance'\"]",
    title: "🔧 Step 5: Maintenance",
    text: "When tenants raise issues here, you see them in this tab. Update status, write resolution notes, chat with the tenant."
  },
  {
    selector: "#help-fab",
    title: "💬 Help is always one tap away",
    text: "This floating button opens KiraaBot — your help assistant. Tap it anytime to get guidance, search FAQs, or contact support. You're all set!"
  }
];

let _walkthroughStep = 0;

function shouldShowWalkthroughAuto(){
  // Show walkthrough once per owner account
  let key = "kb_walkthrough_seen_" + (localStorage.getItem("kb_owner_id")||"x");
  return !localStorage.getItem(key);
}

function markWalkthroughSeen(){
  let key = "kb_walkthrough_seen_" + (localStorage.getItem("kb_owner_id")||"x");
  localStorage.setItem(key, "1");
}

window.helpBotStartWalkthrough = ()=>{
  closeModal("help-bot-modal");
  startWalkthrough();
};

window.startWalkthrough = ()=>{
  _walkthroughStep = 0;
  document.getElementById("walkthrough-overlay").style.display = "block";
  showWalkthroughStep();
};

function showWalkthroughStep(){
  let step = WALKTHROUGH_STEPS[_walkthroughStep];
  if(!step){ walkthroughSkip(); return; }
  let target = document.querySelector(step.selector);
  if(!target){
    // Skip steps whose target isn't on screen
    _walkthroughStep++;
    if(_walkthroughStep >= WALKTHROUGH_STEPS.length){ walkthroughSkip(); return; }
    showWalkthroughStep();
    return;
  }
  let rect = target.getBoundingClientRect();
  // Spotlight
  let spot = document.getElementById("wt-spotlight");
  spot.style.left = (rect.left-6)+"px";
  spot.style.top = (rect.top-6)+"px";
  spot.style.width = (rect.width+12)+"px";
  spot.style.height = (rect.height+12)+"px";
  // Tooltip — position below if possible, above if no room
  let tip = document.getElementById("wt-tooltip");
  document.getElementById("wt-title").textContent = step.title;
  document.getElementById("wt-text").innerHTML = step.text;
  document.getElementById("wt-step").textContent = `Step ${_walkthroughStep+1} of ${WALKTHROUGH_STEPS.length}`;
  document.getElementById("wt-prev").style.visibility = _walkthroughStep===0 ? "hidden" : "visible";
  document.getElementById("wt-next").textContent = _walkthroughStep===WALKTHROUGH_STEPS.length-1 ? "Finish ✓" : "Next →";
  // Position tooltip
  tip.style.left = "0px"; tip.style.top = "0px";  // measure
  let tipRect = tip.getBoundingClientRect();
  let vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left + rect.width/2 - tipRect.width/2;
  let top = rect.bottom + 16;
  if(top + tipRect.height > vh - 10){ top = rect.top - tipRect.height - 16; }
  if(left < 10) left = 10;
  if(left + tipRect.width > vw - 10) left = vw - tipRect.width - 10;
  if(top < 10) top = 10;
  tip.style.left = left+"px";
  tip.style.top = top+"px";
}

window.walkthroughNext = ()=>{
  if(_walkthroughStep >= WALKTHROUGH_STEPS.length-1){ walkthroughSkip(); return; }
  _walkthroughStep++;
  showWalkthroughStep();
};
window.walkthroughPrev = ()=>{
  if(_walkthroughStep<=0) return;
  _walkthroughStep--;
  showWalkthroughStep();
};
window.walkthroughSkip = ()=>{
  document.getElementById("walkthrough-overlay").style.display = "none";
  markWalkthroughSeen();
};

// Auto-trigger walkthrough on first owner login
let _walkthroughTriggerArmed = false;
function maybeAutoWalkthrough(){
  if(_walkthroughTriggerArmed) return;
  _walkthroughTriggerArmed = true;
  setTimeout(()=>{
    if(shouldShowWalkthroughAuto() && document.getElementById("screen-owner")?.classList.contains("active")){
      startWalkthrough();
    }
  }, 1500);
}

// Hook into show() to trigger walkthrough when owner screen activates
let _origShowForWT = window.show;
window.show = function(id){
  if(_origShowForWT) _origShowForWT.call(this, id);
  if(id==="screen-owner") setTimeout(maybeAutoWalkthrough, 800);
};

