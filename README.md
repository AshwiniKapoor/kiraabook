# KiraaBook v9 — Smart Rent Manager

A full-featured, single-page web app for managing rental properties. Handles tenant onboarding, monthly billing, payment tracking, maintenance tickets, and rent reminders — all backed by Firebase Firestore and accessible from any device.

---

## Live Features

| Area | What it does |
|---|---|
| **Owner Portal** | Signup (free trial), login, manage tenants, create bills, track payments, view room history |
| **Tenant Portal** | Login, view bills, pay via UPI, submit "I Have Paid" claims, file maintenance tickets, send vacating notice |
| **Admin Panel** | Full DB viewer, owner/tenant/bill management, key generation, activity logs, data backup/export |
| **Auto Billing** | Monthly bills auto-created for tenants on `billMode: "auto"` |
| **WhatsApp Reminders** | One-click WhatsApp rent reminders (day before, day of, overdue) |
| **Maintenance Tickets** | Tenants report issues → owners update status → conversation thread |
| **Rent Agreement PDF** | jsPDF-powered agreement builder with multiple templates |
| **KiraaBot Help** | In-app help assistant with topic cards, FAQ search, guided walkthrough |
| **Notifications** | In-app bell with Firestore-backed notification queue |
| **Multi-currency** | ₹ INR, $ USD, € EUR, £ GBP and more |
| **Persistent Login** | localStorage session restore on page reload |

---

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS3 (custom properties), ES2022 modules — no build step
- **Database:** Firebase Firestore (real-time listeners + one-shot reads)
- **Auth:** Custom username/password stored in Firestore (+ Firebase Phone Auth for OTP resets)
- **PDF:** [jsPDF](https://cdnjs.cloudflare.com/ajax/libs/jspdf/) + jsPDF-autotable (CDN)
- **Fonts:** Sora + JetBrains Mono (Google Fonts)
- **Hosting:** Any static host (Firebase Hosting, Vercel, Netlify, GitHub Pages)

---

## Project Structure

```
kiraabook/
├── index.html                  # App shell — all screens & modals, links external CSS & JS
├── README.md
│
├── assets/
│   ├── css/
│   │   ├── variables.css       # CSS custom properties (colors, radii, shadows)
│   │   ├── global.css          # Reset, body, animations, loading screen, toast, FAB
│   │   ├── components.css      # Buttons, forms, cards, modals, billing, badges, tables
│   │   └── screens.css         # Screen-specific styles (landing, auth, dashboard, tenant, admin)
│   │
│   ├── js/
│   │   ├── app.js              # Entry point — imports all modules, runs boot()
│   │   ├── firebase.js         # Firebase config, Firestore init, db helper functions
│   │   ├── state.js            # Shared mutable state object (tenants, bills, etc.)
│   │   ├── helpers.js          # DOM utilities, formatting, photo upload, error handlers
│   │   ├── auth.js             # Owner/tenant/admin login, signup, forgot-password flows
│   │   ├── owner.js            # Owner dashboard: init, stats, tabs, billing, tenant list
│   │   ├── tenant.js           # Tenant portal: view rendering, payment, vacant notice
│   │   ├── admin.js            # Admin panel: owner/tenant/bill CRUD, keys, DB viewer, backup
│   │   ├── ui.js               # FAQ, KiraaBot help assistant, guided walkthrough, contact modal
│   │   │
│   │   └── features/
│   │       ├── account.js      # Currency, notifications, room history, bill PDF download, owner edit
│   │       ├── properties.js   # Property management (add, edit, delete, render)
│   │       ├── maintenance.js  # Maintenance tickets (owner view, tenant form, replies, status)
│   │       └── rent-agreement.js  # Digital rent agreement builder (jsPDF output)
│   │
│   └── images/                 # Place any static images/icons here
```

---

## Getting Started

### 1. Clone & open

```bash
git clone https://github.com/AshwiniKapoor/kiraabook.git
cd kiraabook
# Open index.html directly in a browser — or serve it:
npx serve .
```

> **Note:** The app uses ES modules (`type="module"`). You must serve it over HTTP/HTTPS — opening `index.html` directly via `file://` will cause CORS errors with module imports. Use `npx serve .` or VS Code Live Server.

### 2. Firebase project

The app is already connected to the `kiraabook-326bc` Firebase project. To use your own Firebase:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore** (Native mode)
3. Copy your config object and replace the values in [assets/js/firebase.js](assets/js/firebase.js)

### 3. Admin access

Default admin passkey: `Geetansh2013`  
Change it in [assets/js/firebase.js](assets/js/firebase.js) → `ADMIN_PASS` constant.

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `owners` | Owner accounts, plan, subscription expiry |
| `tenants` | Tenant profiles, documents (base64), payment history |
| `bills` | Monthly bills with line items and status |
| `rooms` | Room records per owner |
| `properties` | Property/building metadata |
| `maintenanceTickets` | Maintenance requests with thread replies |
| `supportTickets` | Owner-submitted support messages |
| `paymentClaims` | Tenant "I Have Paid" claims awaiting approval |
| `notifications` | In-app notification queue per owner |
| `vacantNotices` | Vacating notices from tenants |
| `keys` | Paid plan activation keys (monthly / annual) |
| `logs` | Activity audit log |

---

## Subscription Plans

| Plan | Price | Tenants | Features |
|---|---|---|---|
| **Free Trial** | ₹0 / 30 days | Up to 3 | All core features |
| **Monthly** | ₹40 / month | Unlimited | All features + priority |
| **Annual** | ₹499 / year | Unlimited | All features + save 50% |
| **Lifetime** | Key: `Geetansh2013` | Unlimited | Never expires |

Payments via Razorpay. After payment, admin generates an activation key.

---

## Development Notes

- **No build step** — edit CSS/JS files directly and refresh.
- All JS uses ES modules. Each module imports from `firebase.js`, `state.js`, and `helpers.js`.
- Shared mutable state lives in `state.js` as a single exported object (`state.tenants`, `state.bills`, etc.).
- Functions exposed to inline HTML `onclick` handlers are assigned to `window.*` in their module.
- Photos are compressed client-side (Canvas API) and stored as base64 in Firestore.

---

## Security Notes

- Passwords are stored in plaintext in Firestore — **not suitable for production without hashing**.
- The Firebase config is public (client-side). Secure your Firestore rules in the Firebase console.
- Admin passkey is hardcoded — change it before deploying to production.

---

## License

Private project — all rights reserved by Ashwini Kapoor.
