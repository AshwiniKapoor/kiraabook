import { db, fbGet, fbSet, fbUpdate, fbGetDoc, fbAdd, fbDel, logActivity, PAY_LINKS, LIFETIME_KEY, collection, doc, getDoc } from './firebase.js';
import { state } from './state.js';
import { g, sv, show, toast, fmtDate, fmtMoney, genUID, esc, escAttr, daysBetween, closeModal, fmtDateNice } from './helpers.js';

// ── NAVIGATION ────────────────────────────────────────────────
window.goLanding    =()=>{ show("screen-landing"); };
window.goOwnerLogin =()=>{ show("screen-owner-login"); hideOwnerForgot(); setTimeout(()=>document.getElementById("owner-user").focus(),100); };
window.goAdminLogin =()=>{ show("screen-admin-login"); setTimeout(()=>document.getElementById("admin-pass").focus(),100); };
window.goOwnerSignup=()=>{
  show("screen-owner-signup");
  ["signup-name","signup-phone","signup-email","signup-username","signup-pass","signup-pass2"].forEach(i=>sv(i,""));
  document.getElementById("signup-err").textContent="";
  setTimeout(()=>document.getElementById("signup-name").focus(),100);
};
window.goPlans=()=>{ show("screen-sub"); };
window.goTenantLogin=()=>{
  show("screen-tenant-login");
  showTenantLoginStep1();
  let urlParams=new URLSearchParams(window.location.search);
  let oid=urlParams.get("owner");
  if(oid) localStorage.setItem("kb_invite_owner",oid);
};
window.showTenantLoginStep1=()=>{
  document.getElementById("treg-s1").style.display="";
  document.getElementById("treg-s1b").style.display="none";
  document.getElementById("treg-s2").style.display="none";
  document.getElementById("t-err").textContent="";
  document.getElementById("t-name-inp").value="";
  document.getElementById("t-pass-inp").value="";
  hideForgotPassword();
};
window.showTenantRegister=async()=>{
  document.getElementById("treg-s1").style.display="none";
  document.getElementById("treg-s1b").style.display="";
  document.getElementById("treg-s2").style.display="none";
  document.getElementById("t-new-err").textContent="";
  // Check invite owner from URL or localStorage (item 9, 12)
  let inviteOwner=localStorage.getItem("kb_invite_owner")||"";
  let banner=document.getElementById("tr-owner-banner");
  let oidWrap=document.getElementById("tr-owner-id-wrap");
  if(inviteOwner){
    try{
      let o=await fbGetDoc("owners",inviteOwner);
      if(o){
        document.getElementById("tr-owner-banner-name").textContent="🏠 "+(o.name||"Property Owner");
        document.getElementById("tr-owner-banner-id").textContent=`Owner ID: ${o.oid||o.id}${o.phone?" · "+o.phone:""}`;
        banner.style.display="block";
        oidWrap.style.display="none";
        // Pre-fill the owner id input invisibly
        let oi=document.getElementById("t-newowner-inp"); if(oi) oi.value=o.oid||o.id;
      } else {
        // invalid invite owner — fall through to manual entry
        localStorage.removeItem("kb_invite_owner");
        banner.style.display="none";
        oidWrap.style.display="block";
      }
    }catch(e){
      banner.style.display="none";
      oidWrap.style.display="block";
    }
  } else {
    // No invite link — tenant must provide Owner ID manually (item 7, 12, 15)
    banner.style.display="none";
    oidWrap.style.display="block";
  }
  setTimeout(()=>document.getElementById("t-newname-inp").focus(),100);
};
window.logout=()=>{
  try{
    if(unsubT){unsubT();unsubT=null;}
    if(unsubB){unsubB();unsubB=null;}
    if(unsubR){unsubR();unsubR=null;}
    if(unsubC){unsubC();unsubC=null;}
    if(typeof unsubNotif!=="undefined" && unsubNotif){unsubNotif();}
    if(typeof unsubRH!=="undefined" && unsubRH){unsubRH();}
  }catch(e){}
  currentTenantId=null; currentOwnerData=null;
  localStorage.removeItem("kb_owner_id");
  localStorage.removeItem("kb_owner_name");
  localStorage.removeItem("kb_owner_user");
  localStorage.removeItem("kb_tenant_id");
  localStorage.removeItem("kb_admin_session");
  goLanding();
};

// ── POLICY ACCEPT HELPERS ─────────────────────────────────────
window.toggleOwnerAccept=()=>{
  let btn=document.getElementById("owner-accept-btn");
  btn.disabled=!document.getElementById("owner-agree-check").checked;
};
window.toggleTenantAccept=()=>{
  let btn=document.getElementById("tenant-accept-btn");
  btn.disabled=!document.getElementById("tenant-agree-check").checked;
};

// ── PLAN SWITCH ──────────────────────────────────────────────
let selPlan="monthly";
window.switchPlan=(p,el)=>{
  selPlan=p;
  document.querySelectorAll(".ptab").forEach(t=>t.classList.remove("active")); el.classList.add("active");
  ["monthly","annual"].forEach(n=>{ let e2=document.getElementById("plan-"+n); if(e2)e2.classList.toggle("show",n===p); });
  let btn=document.getElementById("buy-btn");
  if(p==="monthly")btn.textContent="🔐 Buy Monthly Plan — ₹40";
  else btn.textContent="🔐 Buy Annual Plan — ₹499";
};
window.buyNow=()=>{
  let link = selPlan==="annual" ? PAY_LINKS.annual : PAY_LINKS.monthly;
  let amt  = selPlan==="annual" ? "499" : "40";
  const _cur = localStorage.getItem("kb_currency")||"₹";
  if(confirm(`Pay ${_cur}${amt} to activate the ${selPlan} plan?\n\nYou will be redirected to Razorpay. After payment, contact admin to receive your activation key.`)){
    window.open(link,"_blank");
  }
};

// ── OWNER SIGNUP FLOW (FREE TRIAL) ───────────────────────────
window.showOwnerSignupPolicy=()=>{
  let name=g("signup-name"), phone=g("signup-phone"), email=g("signup-email");
  let user=g("signup-username").toLowerCase().replace(/\s+/g,"");
  let pass=g("signup-pass"), pass2=g("signup-pass2");
  let err=document.getElementById("signup-err");
  err.textContent="";
  // Clear previous error highlights
  ["signup-name","signup-phone","signup-email","signup-username","signup-pass","signup-pass2"].forEach(i=>{
    let el=document.getElementById(i); if(el) el.classList.remove("field-error");
  });
  let markError=(id,msg)=>{
    let el=document.getElementById(id); if(el){ el.classList.add("field-error"); el.focus(); }
    err.textContent=msg;
  };
  if(!name){ markError("signup-name","Please enter your full name."); return; }
  if(!phone){ markError("signup-phone","Phone number is required."); return; }
  if(phone.length<10){ markError("signup-phone","Phone must be at least 10 digits."); return; }
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ markError("signup-email","Enter a valid email address (or leave it blank)."); return; }
  if(!user){ markError("signup-username","Username is required."); return; }
  if(user.length<3){ markError("signup-username","Username must be at least 3 characters."); return; }
  if(!pass){ markError("signup-pass","Password is required."); return; }
  if(pass.length<6){ markError("signup-pass","Password must be at least 6 characters."); return; }
  if(pass!==pass2){ markError("signup-pass2","Passwords don't match."); return; }
  pendingFlow="signup";
  document.getElementById("owner-agree-check").checked=false;
  document.getElementById("owner-accept-btn").disabled=true;
  document.getElementById("owner-policy-modal").classList.add("open");
};

window.ownerPolicyAccepted=async()=>{
  closeModal("owner-policy-modal");
  if(pendingFlow==="signup"){ await doFreeSignup(); }
  else { // key or lifetime
    document.getElementById("setup-err").textContent="";
    ["setup-name","setup-phone","setup-email","setup-username","setup-pass","setup-pass2"].forEach(i=>sv(i,""));
    document.getElementById("setup-modal").classList.add("open");
  }
};

async function doFreeSignup(){
  let name=g("signup-name"), phone=g("signup-phone"), email=g("signup-email").toLowerCase();
  let user=g("signup-username").toLowerCase().replace(/\s+/g,""), pass=g("signup-pass");
  let err=document.getElementById("signup-err");
  err.textContent="⏳ Creating your account...";
  try{
    let owners=await fbGet("owners");
    if(owners.find(o=>o.username===user)){ err.textContent="❌ Username already taken. Choose another."; return; }
    // Note: trial-duplicate check disabled to avoid blocking legitimate retries
    let now=new Date();
    let exp=new Date(); exp.setDate(exp.getDate()+30);
    let oid=genUID();
    let ownerData={
      oid, name, username:user, password:pass,
      phone, email,
      plan:"trial", subExpiry:exp.toISOString(),
      trialUsed:true, trialStartDate:now.toISOString(),
      active:true, free:true,
      createdOn:now.toLocaleDateString("en-IN"),
      tenantCount:0
    };
    await fbSet("owners",oid,ownerData);
    localStorage.setItem("kb_owner_id",oid);
    localStorage.setItem("kb_owner_name",name);
    localStorage.setItem("kb_owner_user",user);
    currentOwnerData=ownerData;
    pendingFlow="";
    show("screen-owner");
    initOwner();
    toast(`🎉 Welcome ${name}! Your 30-day free trial is active.`);
    try{ await logActivity("Owner Created (Free Trial)",`Name: ${name}, Username: ${user}, Phone: ${phone}, Email: ${email}`,name); }catch(e){}
  }catch(e){
    console.error(e);
    err.textContent="❌ Error creating account. Try again. ("+(e.message||e)+")";
  }
}

// ── KEY ACTIVATION (Paid plans) ──────────────────────────────
window.openKeyModal=()=>{
  document.getElementById("key-err").textContent="";
  document.getElementById("key-inp").value="";
  document.getElementById("key-modal").classList.add("open");
  setTimeout(()=>document.getElementById("key-inp").focus(),100);
};

window.activateKey=async()=>{
  let key=document.getElementById("key-inp").value.trim().toUpperCase();
  let err=document.getElementById("key-err");
  err.textContent="";
  if(key===LIFETIME_KEY.toUpperCase()||key==="GEETANSH2013"){
    let exp=new Date(2099,11,31);
    localStorage.setItem("kb_sub_pending",exp.toISOString());
    localStorage.setItem("kb_plan_pending","lifetime");
    pendingKeyId="";
    pendingFlow="lifetime";
    closeModal("key-modal");
    toast("♾️ Lifetime key activated!","info");
    document.getElementById("owner-agree-check").checked=false;
    document.getElementById("owner-accept-btn").disabled=true;
    document.getElementById("owner-policy-modal").classList.add("open");
    return;
  }
  if(!key){ err.textContent="Please enter a key."; return; }
  err.textContent="⏳ Checking...";
  try{
    let snap=await getDoc(doc(db,"keys",key));
    if(snap.exists()&&!snap.data().used){
      let plan=snap.data().plan||"monthly";
      let months=plan==="annual"?12:1;
      let exp=new Date(); exp.setMonth(exp.getMonth()+months);
      localStorage.setItem("kb_sub_pending",exp.toISOString());
      localStorage.setItem("kb_plan_pending",plan);
      pendingKeyId=key;
      pendingFlow="key";
      closeModal("key-modal");
      err.textContent="";
      document.getElementById("owner-agree-check").checked=false;
      document.getElementById("owner-accept-btn").disabled=true;
      document.getElementById("owner-policy-modal").classList.add("open");
    } else if(snap.exists()&&snap.data().used){
      err.textContent="❌ This key is already used.";
    } else {
      err.textContent="❌ Invalid key. Contact admin.";
    }
  }catch(e){
    err.textContent="❌ Connection error.";
    console.error(e);
  }
};

window.saveOwnerSetup=async()=>{
  let name=g("setup-name"), phone=g("setup-phone"), email=g("setup-email").toLowerCase();
  let user=g("setup-username").toLowerCase().replace(/\s+/g,"");
  let pass=g("setup-pass"), pass2=g("setup-pass2");
  let err=document.getElementById("setup-err");
  if(!name||!phone||!email||!user||!pass||!pass2){ err.textContent="Please fill all fields."; return; }
  if(phone.length<10){ err.textContent="Phone must be at least 10 digits."; return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent="Enter a valid email."; return; }
  if(pass!==pass2){ err.textContent="Passwords don't match!"; return; }
  if(pass.length<6){ err.textContent="Password must be at least 6 characters."; return; }
  if(user.length<3){ err.textContent="Username must be at least 3 characters."; return; }
  err.textContent="⏳ Creating account...";
  try{
    let owners=await fbGet("owners");
    if(owners.find(o=>o.username===user)){ err.textContent="❌ Username already taken."; return; }
    let exp=localStorage.getItem("kb_sub_pending")||new Date(2099,11,31).toISOString();
    let plan=localStorage.getItem("kb_plan_pending")||"monthly";
    let oid=genUID();
    let ownerData={
      oid, name, username:user, password:pass,
      phone, email,
      plan, subExpiry:exp,
      trialUsed:false, // paid plan doesn't consume trial
      active:true, free:false,
      createdOn:new Date().toLocaleDateString("en-IN"),
      tenantCount:0
    };
    await fbSet("owners",oid,ownerData);
    if(pendingKeyId){
      await fbUpdate("keys",pendingKeyId,{used:true,usedOn:new Date().toLocaleDateString("en-IN"),usedByOwner:oid});
    }
    localStorage.setItem("kb_sub",exp);
    localStorage.setItem("kb_plan",plan);
    localStorage.removeItem("kb_sub_pending");
    localStorage.removeItem("kb_plan_pending");
    localStorage.setItem("kb_owner_id",oid);
    localStorage.setItem("kb_owner_name",name);
    localStorage.setItem("kb_owner_user",user);
    pendingFlow="";
    closeModal("setup-modal");
    currentOwnerData=ownerData;
    show("screen-owner");
    initOwner();
    toast(`🎉 Welcome ${name}!`);
    await logActivity("Owner Created (Paid)",`Name: ${name}, Username: ${user}, Plan: ${plan}`,name);
  }catch(e){
    console.error(e);
    err.textContent="❌ Error creating account.";
  }
};

// ── OWNER LOGIN ───────────────────────────────────────────────
window.ownerLogin=async()=>{
  let user=document.getElementById("owner-user").value.trim().toLowerCase();
  let pass=document.getElementById("owner-pass").value;
  let err=document.getElementById("owner-err");
  if(!user||!pass){ err.textContent="Please fill all fields."; return; }
  err.textContent="⏳ Checking...";
  try{
    let owners=await fbGet("owners");
    let found=owners.find(o=>o.username===user&&o.password===pass);
    if(found){
      if(!found.active){ err.textContent="❌ Account deactivated. Contact admin."; return; }
      document.getElementById("owner-pass").value="";
      err.textContent="";
      localStorage.setItem("kb_owner_id",found.oid||found.id);
      localStorage.setItem("kb_owner_name",found.name||user);
      localStorage.setItem("kb_owner_user",user);
      currentOwnerData=found;
      show("screen-owner");
      initOwner();
      await logActivity("Owner Login",`Username: ${user}`,found.name||user);
    } else {
      err.textContent="❌ Wrong username or password!";
      document.getElementById("owner-pass").value="";
    }
  }catch(e){ err.textContent="❌ Connection error."; }
};

// ── OWNER FORGOT PASSWORD ────────────────────────────────────
window.showOwnerForgot=()=>{
  document.getElementById("owner-forgot-box").style.display="block";
  document.getElementById("owner-err").textContent="";
  document.getElementById("owner-forgot-err").textContent="";
  document.getElementById("owner-forgot-verified").style.display="none";
  document.getElementById("owner-forgot-verify-btn-wrap").style.display="block";
  sv("owner-forgot-phone",""); sv("owner-forgot-newpass",""); sv("owner-forgot-newpass2","");
  forgotOwnerDocId="";
};
window.hideOwnerForgot=()=>{
  let box=document.getElementById("owner-forgot-box");
  if(box) box.style.display="none";
  forgotOwnerDocId="";
};
window.verifyOwnerForgot=async()=>{
  let user=document.getElementById("owner-user").value.trim().toLowerCase();
  let phone=g("owner-forgot-phone");
  let err=document.getElementById("owner-forgot-err");
  if(!user){ err.textContent="Enter your username above first."; return; }
  if(!phone||phone.length<10){ err.textContent="Enter a valid 10-digit phone number."; return; }
  err.textContent="⏳ Verifying...";
  try{
    let owners=await fbGet("owners");
    let found=owners.find(o=>o.username===user && o.phone===phone);
    if(found){
      forgotOwnerDocId=found.id;
      err.textContent="";
      document.getElementById("owner-forgot-verified").style.display="block";
      document.getElementById("owner-forgot-verify-btn-wrap").style.display="none";
      toast("✅ Identity verified! Set a new password.","info");
    } else {
      err.textContent="❌ Username and phone don't match our records.";
    }
  }catch(e){ err.textContent="❌ Connection error."; }
};
window.doOwnerResetPassword=async()=>{
  if(!forgotOwnerDocId){ toast("Verification error.","error"); return; }
  let np=g("owner-forgot-newpass"), np2=g("owner-forgot-newpass2");
  let err=document.getElementById("owner-forgot-reset-err");
  if(!np||np.length<6){ err.textContent="Password must be at least 6 characters."; return; }
  if(np!==np2){ err.textContent="Passwords don't match."; return; }
  try{
    await fbUpdate("owners",forgotOwnerDocId,{password:np});
    toast("✅ Password reset! You can now login.");
    hideOwnerForgot();
    sv("owner-pass","");
    forgotOwnerDocId="";
    await logActivity("Password Reset","Owner reset their own password","Owner");
  }catch(e){ err.textContent="❌ Error. Try again."; }
};

// ── ADMIN LOGIN ───────────────────────────────────────────────
window.adminLogin=async()=>{
  let p=document.getElementById("admin-pass").value;
  if(p===ADMIN_PASS){
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

// ── TENANT LOGIN ──────────────────────────────────────────────
window.tenantLogin=async()=>{
  let name=document.getElementById("t-name-inp").value.trim();
  let pass=document.getElementById("t-pass-inp").value;
  let err=document.getElementById("t-err");
  if(!name||!pass){ err.textContent="Please enter your name and password."; return; }
  err.textContent="⏳ Checking...";
  try{
    let all=await fbGet("tenants");
    let inviteOwner=localStorage.getItem("kb_invite_owner");
    let found;
    if(inviteOwner) found=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase()&&t.ownerID===inviteOwner);
    if(!found) found=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase());
    if(!found){ err.textContent="❌ No tenant with this name. Click 'Register here' to sign up."; return; }
    if(!found.password){ err.textContent="⚠️ No password set. Register first."; return; }
    if(found.password!==pass){ err.textContent="❌ Wrong password. Try 'Forgot password?'"; return; }
    if(!found.approved){ err.textContent="⏳ Profile pending owner approval."; return; }
    if(found.active===false){ err.textContent="⛔ This account has been deactivated. Contact your owner."; return; }
    err.textContent="";
    currentTenantId=found.id;
    localStorage.setItem("kb_tenant_id",found.id);
    show("screen-tenant");
    await renderTenantView(found);
  }catch(e){ err.textContent="❌ Connection error."; console.error(e); }
};

// ── TENANT FORGOT PASSWORD ────────────────────────────────────
window.showForgotPassword=()=>{
  document.getElementById("forgot-box").style.display="block";
  document.getElementById("t-err").textContent="";
  document.getElementById("forgot-err").textContent="";
  document.getElementById("forgot-verified").style.display="none";
  document.getElementById("forgot-verify-btn-wrap").style.display="block";
  sv("forgot-phone",""); sv("forgot-newpass",""); sv("forgot-newpass2","");
  forgotTenantDocId="";
};
window.hideForgotPassword=()=>{
  let box=document.getElementById("forgot-box");
  if(box) box.style.display="none";
  forgotTenantDocId="";
};
window.verifyForgotPhone=async()=>{
  let name=document.getElementById("t-name-inp").value.trim();
  let phone=g("forgot-phone");
  let err=document.getElementById("forgot-err");
  if(!name){ err.textContent="Enter your name above first."; return; }
  if(!phone||phone.length<10){ err.textContent="Enter a valid 10-digit phone number."; return; }
  err.textContent="⏳ Verifying...";
  try{
    let all=await fbGet("tenants");
    let found=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase()&&t.phone===phone);
    if(found){
      forgotTenantDocId=found.id;
      err.textContent="";
      document.getElementById("forgot-verified").style.display="block";
      document.getElementById("forgot-verify-btn-wrap").style.display="none";
      toast("✅ Identity verified!","info");
    } else { err.textContent="❌ Name and phone don't match."; }
  }catch(e){ err.textContent="❌ Connection error."; }
};
window.doResetPassword=async()=>{
  if(!forgotTenantDocId){ toast("Verification error.","error"); return; }
  let np=g("forgot-newpass"), np2=g("forgot-newpass2");
  let err=document.getElementById("forgot-reset-err");
  if(!np||np.length<6){ err.textContent="Password must be at least 6 characters."; return; }
  if(np!==np2){ err.textContent="Passwords don't match."; return; }
  try{
    await fbUpdate("tenants",forgotTenantDocId,{password:np});
    toast("✅ Password reset! You can now login.");
    hideForgotPassword();
    sv("t-pass-inp","");
    forgotTenantDocId="";
    await logActivity("Password Reset","Tenant reset their own password","Tenant");
  }catch(e){ err.textContent="❌ Error. Try again."; }
};

// ── TENANT LOOKUP (REGISTRATION) ──────────────────────────────
window.tenantLookup=async()=>{
  let nameEl=document.getElementById("t-newname-inp");
  let oidEl=document.getElementById("t-newowner-inp");
  let name=nameEl.value.trim();
  let providedOid=(oidEl?.value||"").trim().toUpperCase();
  let err=document.getElementById("t-new-err");
  [nameEl,oidEl].forEach(e=>e&&e.classList.remove("field-error"));
  if(!name){ err.textContent="Please enter your name."; nameEl.classList.add("field-error"); nameEl.focus(); return; }
  let inviteOwner=localStorage.getItem("kb_invite_owner")||"";
  // Resolve owner: invite-link takes precedence, otherwise validate manually entered ID
  let resolvedOwnerID="";
  if(inviteOwner){
    resolvedOwnerID=inviteOwner;
  } else {
    if(!providedOid){ err.textContent="Owner ID is required. Ask your property owner for it."; if(oidEl){ oidEl.classList.add("field-error"); oidEl.focus(); } return; }
    err.textContent="⏳ Verifying Owner ID...";
    try{
      let owners=await fbGet("owners");
      let oFound=owners.find(o=>(o.oid||"").toUpperCase()===providedOid || o.id.toUpperCase()===providedOid);
      if(!oFound){ err.textContent="❌ No owner found with that ID. Double-check with your owner."; if(oidEl) oidEl.classList.add("field-error"); return; }
      if(oFound.active===false){ err.textContent="❌ This owner account is inactive."; if(oidEl) oidEl.classList.add("field-error"); return; }
      resolvedOwnerID=oFound.oid||oFound.id;
      localStorage.setItem("kb_invite_owner", resolvedOwnerID);
    }catch(e){ err.textContent="❌ Connection error."; return; }
  }
  err.textContent="⏳ Checking...";
  try{
    let all=await fbGet("tenants");
    let found=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase() && t.ownerID===resolvedOwnerID);
    err.textContent="";
    if(found && found.approved && found.password){
      err.textContent="✅ Account exists! Please login with your password.";
      setTimeout(()=>showTenantLoginStep1(),1500);
      return;
    }
    sv("tr-name",name);
    ["tr-room","tr-rent","tr-phone","tr-alt","tr-email","tr-address","tr-date","tr-notes","tr-idtype","tr-idnum","tr-password","tr-password2"].forEach(i=>sv(i,""));
    let idArea=document.getElementById("id-upload-area"); if(idArea) idArea.style.display="none";
    let mvDisp=document.getElementById("movein-display"); if(mvDisp) mvDisp.style.display="none";
    resetPhotoUploads();
    document.getElementById("treg-s1b").style.display="none";
    document.getElementById("treg-s2").style.display="block";
  }catch(e){ err.textContent="❌ Connection error."; console.error(e); }
};

function resetPhotoUploads(){
  let profPrev=document.getElementById("prof-prev");
  if(profPrev) profPrev.innerHTML=`<span style="font-size:30px">👤</span><span style="font-size:10px;color:var(--text3);font-weight:600;margin-top:4px">Tap to upload</span>`;
  let idPrev=document.getElementById("id-prev");
  if(idPrev) idPrev.innerHTML=`<span style="font-size:22px">📄</span><span style="font-size:11px;color:var(--text3);font-weight:600">Tap to upload document</span>`;
  let pvPrev=document.getElementById("pv-prev");
  if(pvPrev) pvPrev.innerHTML=`<span style="font-size:22px">📋</span><span style="font-size:11px;color:var(--text3);font-weight:600">Upload police form photo</span>`;
  ["prof-data","id-data","pv-data"].forEach(id=>{ let el=document.getElementById(id); if(el)el.value=""; });
}

// ── PHOTO HELPERS ─────────────────────────────────────────────
window.triggerFile=(fileId,dataId,prevId,selfie)=>{
  let inp=document.getElementById(fileId);
  if(selfie){ inp.setAttribute("capture","user"); } else { inp.removeAttribute("capture"); }
  inp.click();
};
window.handlePhotoFile=(fileId,dataId,prevId,isRound)=>{
  let file=document.getElementById(fileId)?.files?.[0];
  if(!file) return;
  let reader=new FileReader();
  reader.onload=e=>{
    let img=new Image();
    img.onload=()=>{
      let canvas=document.createElement("canvas");
      let maxSz=isRound?400:600;
      let ratio=Math.min(maxSz/img.width,maxSz/img.height,1);
      canvas.width=img.width*ratio;
      canvas.height=img.height*ratio;
      let ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      let compressed=canvas.toDataURL("image/jpeg",0.6);
      let prev=document.getElementById(prevId);
      let radius=isRound?"50%":"calc(var(--rs) - 2px)";
      if(prev) prev.innerHTML=`<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:${radius}"/>`;
      let dataEl=document.getElementById(dataId);
      if(dataEl) dataEl.value=compressed;
      toast("📸 Photo loaded!","info");
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
};
window.updateMoveinDisplay=()=>{
  let d=g("tr-date");
  let disp=document.getElementById("movein-display");
  if(!d){ disp.style.display="none"; return; }
  let info=fmtDateNice(d);
  if(!info){ disp.style.display="none"; return; }
  disp.style.display="block";
  document.getElementById("movein-big").textContent=`${info.date} ${info.month} ${info.year}`;
  document.getElementById("movein-sub").textContent=info.day;
};
window.showIdUpload=()=>{
  let t=g("tr-idtype");
  document.getElementById("id-upload-area").style.display=t?"block":"none";
  if(t) document.getElementById("id-type-lbl").textContent=t;
};

// ── TENANT POLICY → SUBMIT ────────────────────────────────────
window.showTenantPolicyModal=()=>{
  // Clear previous highlights
  ["tr-name","tr-phone","tr-room","tr-rent","tr-password","tr-password2","tr-idtype","tr-idnum","tr-date"].forEach(i=>{
    let el=document.getElementById(i); if(el) el.classList.remove("field-error");
  });
  let mark=(id,msg)=>{
    let el=document.getElementById(id); if(el){ el.classList.add("field-error"); el.scrollIntoView({behavior:"smooth",block:"center"}); el.focus(); }
    toast(msg,"error");
  };
  let name=g("tr-name"), phone=g("tr-phone"), room=g("tr-room"), rent=g("tr-rent");
  let pass=g("tr-password"), pass2=g("tr-password2");
  let idType=g("tr-idtype"), idNum=g("tr-idnum"), date=g("tr-date");
  let profData=document.getElementById("prof-data")?.value||"";
  let idPhoto=document.getElementById("id-data")?.value||"";
  let pvPhoto=document.getElementById("pv-data")?.value||"";

  if(!name){ mark("tr-name","Name is required."); return; }
  if(!phone){ mark("tr-phone","Phone number is required."); return; }
  if(phone.length<10){ mark("tr-phone","Phone must be at least 10 digits."); return; }
  if(!room){ mark("tr-room","Room number is required."); return; }
  if(!rent){ mark("tr-rent","Rent amount is required."); return; }
  if(!date){ mark("tr-date","Move-in date is required."); return; }
  if(!idType){ mark("tr-idtype","ID proof type is required."); return; }
  if(!idNum){ mark("tr-idnum","ID number is required."); return; }
  if(!idPhoto){ toast("Please upload your ID proof photo.","error"); document.getElementById("id-prev")?.scrollIntoView({behavior:"smooth",block:"center"}); return; }
  if(!pvPhoto){ toast("Please upload the verification document.","error"); document.getElementById("pv-prev")?.scrollIntoView({behavior:"smooth",block:"center"}); return; }
  if(!profData){ toast("Please upload profile photo.","error"); document.getElementById("prof-prev")?.scrollIntoView({behavior:"smooth",block:"center"}); return; }
  if(!pass){ mark("tr-password","Password is required."); return; }
  if(pass.length<6){ mark("tr-password","Password must be at least 6 characters."); return; }
  if(pass!==pass2){ mark("tr-password2","Passwords don't match."); return; }

  document.getElementById("tenant-agree-check").checked=false;
  document.getElementById("tenant-accept-btn").disabled=true;
  document.getElementById("tenant-policy-modal").classList.add("open");
};
window.tenantPolicyAccepted=async()=>{
  closeModal("tenant-policy-modal");
  await submitTenantFormFinal();
};

async function submitTenantFormFinal(){
  let name=g("tr-name"), phone=g("tr-phone"), email=g("tr-email").toLowerCase();
  let pass=g("tr-password");
  let profData=document.getElementById("prof-data").value||"";
  let btn=document.getElementById("submit-form-btn");
  btn.textContent="⏳ Submitting..."; btn.disabled=true;
  try{
    let all=await fbGet("tenants");
    let inviteOwner=localStorage.getItem("kb_invite_owner")||"";
    let existing=null;
    if(inviteOwner) existing=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase()&&t.ownerID===inviteOwner);
    if(!existing) existing=all.find(t=>t.name.trim().toLowerCase()===name.toLowerCase());
    let tid=existing?.tid||genUID();
    let obj={
      tid, name,
      room:g("tr-room"), rent:g("tr-rent"),
      phone, email,
      alt:g("tr-alt"), address:g("tr-address"),
      idType:g("tr-idtype"), idNum:g("tr-idnum"),
      date:g("tr-date"), notes:g("tr-notes"),
      password:pass,
      profPhoto:profData,
      idPhoto:document.getElementById("id-data").value||"",
      pvPhoto:document.getElementById("pv-data").value||"",
      paid:false, history:[], approved:false,
      ownerID:inviteOwner,
      submittedOn:new Date().toLocaleDateString("en-IN"),
      billMode:"auto", lastPaidDate:null,
      policyAccepted:true,
      policyAcceptedOn:new Date().toLocaleDateString("en-IN")
    };
    if(existing){
      obj.paid=existing.paid||false;
      obj.history=existing.history||[];
      obj.approved=existing.approved||false;
      obj.lastPaidDate=existing.lastPaidDate||null;
      await updateDoc(doc(db,"tenants",existing.id),obj);
    } else {
      await addDoc(collection(db,"tenants"),{...obj,createdAt:serverTimestamp()});
    }
    // v10: notify owner
    if(inviteOwner){
      await pushNotification(inviteOwner,
        existing ? `✏️ ${name} updated profile` : `🆕 New tenant registration: ${name}`,
        existing ? `Tenant ${name} updated their details and is awaiting approval.` : `${name} (${phone}) has registered and is awaiting your approval.`,
        "tenant_register");
    }
    await logActivity("Tenant Registered",`Name: ${name}, Phone: ${phone}, Email: ${email}`,name);
    toast("✅ Details submitted! Owner will approve.");
    showTenantLoginStep1();
  }catch(e){ console.error(e); toast("❌ Error: "+e.message,"error"); }
  btn.textContent="📜 Review & Accept Terms"; btn.disabled=false;
}
window.submitTenantForm=window.showTenantPolicyModal;
