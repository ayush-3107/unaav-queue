# Unaav Queue Management System

A WhatsApp-based queue management system for **Unaav – The Dakshin Cafe**, replacing physical token machines across three outlets (Dwarka, Paschim Vihar, NSP). Customers scan a QR code, join the queue via WhatsApp, and receive live updates — no app download required.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [WhatsApp Flow](#whatsapp-flow)
- [Review System](#review-system)
- [Deployment](#deployment)
- [Scheduled Jobs](#scheduled-jobs)
- [Outlet Configuration](#outlet-configuration)
- [QR Codes](#qr-codes)

---

## Overview

| | |
|---|---|
| **Live Dashboard** | [queue.unaav.in](https://queue.unaav.in) |
| **Backend** | [unaav-queue.onrender.com](https://unaav-queue.onrender.com) |
| **Outlets** | Dwarka · Paschim Vihar · NSP |
| **WhatsApp Provider** | Snapto |

---

## Features

### Customer-Facing (via WhatsApp)
- Scan QR code → WhatsApp opens with pre-filled outlet message
- Select party size (1–10+) via quick reply buttons
- Receive token number and estimated wait time instantly
- Live queue position updates as the queue moves (up to 3 notifications)
- One-tap cancellation via Cancel Reservation button
- Post-visit review request 90 minutes after being seated
- Star rating: 5 Star / 4 Star / 3 Star or less
- WhatsApp Flow feedback form for negative ratings (Food / Ambiance / Service ratings + comments)

### Manager Dashboard (Web)
- Live queue view with real-time updates via Supabase Realtime
- Mark customer as entered (seat) — sends table confirmation via WhatsApp
- Delete entry — sends cancellation message to customer
- Manual walk-in entry with phone number validator
- Customer history with date, status, and rating filters
- CSV export including all review columns
- Secure per-outlet login (JWT, 8-hour sessions stored in sessionStorage)
- Logout confirmation modal

### Admin / Operations
- **Low-rating alert:** notifies configured phones immediately when a customer submits 3★ or less with detailed breakdown
- **Daily report at 8 AM IST:** total customers, pax, lunch/dinner breakdown, rating summary — sent to configured report phones for each outlet
- Fully configurable per outlet: opening hours, wait formula, manager credentials, alert phones, report phones

---

## Architecture

```
Customer
   │  scans QR code (wa.me deep link)
   │
WhatsApp ──────────────────────────────────────────────────┐
   │                                                        │
   │  Snapto delivers webhook (POST /webhook)              │
   ▼                                                        │
Backend · Node/Express · Render                            │
   ├── StateMachine.js    ← routes incoming WA messages     │
   ├── QueueEngine.js     ← creates / updates queue entries │
   ├── Notifier.js        ← position-update thresholds      │
   └── WhatsAppService.js ← Snapto API calls ───────────────┘
            │
            │  Supabase Realtime WebSocket
            ▼
      Frontend · React/Vite · Vercel
         └── Manager Dashboard (queue.unaav.in)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS v4 |
| Backend | Node.js + Express (ESM modules) |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | JWT (8-hour expiry, sessionStorage) |
| WhatsApp | Snapto API (Meta Business Solution Provider) |
| Frontend hosting | Vercel |
| Backend hosting | Render |
| Cron jobs | cron-job.org |
| Keep-alive | UptimeRobot (pings /health every 5 min) |

---

## Project Structure

```
unaav-queue/
├── backend/
│   ├── index.js                      # Express entry point, middleware, routes
│   ├── .env.example
│   └── src/
│       ├── config/
│       │   └── outlets.config.json   # Per-outlet config (hours, phones, managers)
│       ├── routes/
│       │   ├── webhook.js            # Incoming WhatsApp messages from Snapto
│       │   ├── auth.js               # Manager login → JWT
│       │   ├── queue.js              # Queue CRUD (seat, delete, walk-in)
│       │   ├── customers.js          # History, filters, pagination
│       │   ├── reviews.js            # Review entry API (web fallback)
│       │   └── cron.js               # Review requests + daily reports
│       ├── services/
│       │   ├── StateMachine.js       # WhatsApp chatbot state machine
│       │   ├── QueueEngine.js        # Queue business logic + position calc
│       │   ├── Notifier.js           # Notification threshold logic
│       │   ├── WhatsAppService.js    # Snapto API wrapper (all templates)
│       │   ├── ConfigLoader.js       # Outlet config singleton
│       │   └── AuthService.js        # JWT generation + verification
│       └── utils/
│           ├── supabaseClient.js
│           └── logger.js
└── frontend/
    ├── vercel.json                   # SPA rewrite: all routes → index.html
    └── src/
        ├── pages/
        │   ├── LoginPage.jsx         # Manager login
        │   ├── HomePage.jsx          # Live queue dashboard
        │   ├── CustomersPage.jsx     # History + rating filter + CSV export
        │   └── FeedbackPage.jsx      # Web fallback feedback form
        ├── components/
        │   ├── QueueRow.jsx          # Single queue entry row
        │   ├── ConfirmModal.jsx      # Seat / delete / logout confirm dialog
        │   ├── StatusBadge.jsx
        │   └── EmptyState.jsx
        ├── hooks/
        │   ├── useQueue.js           # Queue state + seat/remove actions
        │   ├── useRealtime.js        # Supabase Realtime subscription
        │   ├── useCustomers.js       # History fetch + CSV export
        │   ├── useCountdown.js       # Live wait-time countdown
        │   └── useAuth.js
        └── context/
            └── AuthContext.jsx       # Auth state persisted in sessionStorage
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- Supabase project (free tier works)
- Snapto account with WhatsApp Business API connected
- ngrok (for local webhook testing)

### Installation

```bash
git clone https://github.com/ayush-3107/unaav-queue.git
cd unaav-queue
```

**Backend:**
```bash
cd backend
cp .env.example .env
# Fill in all values in .env
npm install
node index.js
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Database Setup

Run in Supabase SQL Editor:

```sql
-- Review system columns (add to existing queue_entries table)
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS overall_rating      integer;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS food_rating         integer;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS service_rating      integer;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS ambiance_rating     integer;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS user_feedback       text;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS review_state        text DEFAULT 'pending';

-- Index for efficient cron job queries
CREATE INDEX IF NOT EXISTS idx_queue_entries_review_due
  ON queue_entries (status, review_state, action_at)
  WHERE status = 'seated';

-- Enable Realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;
```

### Local Webhook Testing

```bash
# Terminal 1 — start backend
cd backend && node index.js

# Terminal 2 — expose to internet
ngrok http 3000
```

Update Snapto → Settings → Webhook URL to your ngrok URL, then send a WhatsApp message to test.

---

## Environment Variables

### Backend `.env`

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Auth
JWT_SECRET=your_32_byte_hex_secret

# Snapto (WhatsApp provider)
SNAPTO_API_KEY=your_snapto_api_key
SNAPTO_PHONE_ID=your_phone_id        # required only with multiple numbers

# Webhook verification
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Cron job authentication
CRON_SECRET=your_cron_secret

# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### Frontend `.env.local`

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_BASE_URL=http://localhost:3000
```

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | None | Manager login → JWT |

### Queue
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/queue/:outletId` | JWT | Live queue (waiting entries) |
| POST | `/api/queue/:outletId/entry` | JWT | Add manual walk-in |
| PATCH | `/api/queue/entry/:id/seat` | JWT | Mark customer as seated |
| DELETE | `/api/queue/entry/:id` | JWT | Remove entry from queue |

### Customers
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/customers/:outletId` | JWT | History with filters and pagination |

### Cron
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/cron/send-review-requests` | `x-cron-secret` | Send review requests (90 min post-seating) |
| POST | `/api/cron/send-daily-reports` | `x-cron-secret` | Send daily outlet reports |

### Webhook
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/webhook` | Verify token | Snapto verification handshake |
| POST | `/webhook` | None | Incoming WhatsApp messages |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Server status check |

---

## WhatsApp Flow

```
Customer scans QR
        │
        ▼
"Hi Unaav NSP" → Welcome message + party size buttons (1–9, 10+)
        │
        ▼  customer selects party size
Queue entry created
→ Confirmation: token #, position, estimated wait + Cancel button
        │
        ▼  queue moves (manager seats / removes customers)
Update #2: sent when position ≤ floor(initial_position / 2)
Update #3: sent when position ≤ 2
        │
        ▼  manager marks entry as seated
"Your table is ready" message sent
        │
        ▼  90 minutes later (via cron job)
Review request: [ 5 Star ] [ 4 Star ] [ 3 Star or less ]
        │
   ┌────┴────────────────┐
4★ / 5★              1★ / 2★ / 3★
   │                      │
Positive              Negative template
thank-you             + WhatsApp Flow button
message               │
                  Customer fills Flow form
                  (Food / Ambiance / Service + comment)
                       │
                  Feedback saved to DB
                  Thank-you message sent
                  Low-rating alert → manager phones
```

### Notification Cap

Maximum **3 position updates** per customer per visit. Event messages (confirmation, table confirmed, cancelled, deleted by manager) are not counted toward this cap.

---

## Review System

### WhatsApp Templates

| Template | Trigger | Variables |
|---|---|---|
| `review_request_template` | Cron — 90 min after seating | name, outlet |
| `review_positive_template` | Customer taps 4★ or 5★ | name, outlet |
| `review_negative_template` | Customer taps 3★ or less | name (+ Flow button) |
| `review_feedback_received_template` | After Flow form submission | name |
| `low_rating_alert` | After Flow submission | outlet, name, food, ambiance, service, remarks, phone |
| `daily_report` | 8 AM IST daily | outlet, date, totals, lunch/dinner, ratings |

### WhatsApp Flow (Feedback Form)

A native 3-screen form rendered inside WhatsApp (no browser redirect needed):

- **Screen 1:** Food rating (Excellent / Good / Average / Poor / Very Poor)
- **Screen 2:** Ambiance rating (same options)
- **Screen 3:** Service rating + free-text comment field

On submission, the Flow sends an `nfm_reply` webhook to the backend which parses the ratings and saves them to `queue_entries`.

---

## Deployment

### Backend on Render

```
Service type:    Web Service
Runtime:         Node
Root directory:  backend
Build command:   npm install
Start command:   node index.js
```

Add all backend environment variables under Render → Settings → Environment.

### Frontend on Vercel

```
Framework preset:  Vite
Root directory:    frontend
Build command:     npm run build
Output directory:  dist
```

Add frontend environment variables under Vercel → Settings → Environment Variables.

**Custom domain:** Add `queue.unaav.in` in Vercel → Domains, then add a CNAME record in GoDaddy DNS:
```
Type:  CNAME
Name:  queue
Value: cname.vercel-dns.com
```

---

## Scheduled Jobs

Both jobs are configured on **cron-job.org** with `POST` method and `x-cron-secret` header.

| Job | Endpoint | Schedule | Description |
|---|---|---|---|
| Review Requests | `/api/cron/send-review-requests` | Every 5 minutes | Find seated entries 90+ min old, send review template |
| Daily Reports | `/api/cron/send-daily-reports` | `30 2 * * *` (8:00 AM IST) | Send outlet summary to all report_phones |

UptimeRobot pings `/health` every 5 minutes to prevent Render free tier cold starts.

---

## Outlet Configuration

Edit `backend/src/config/outlets.config.json`:

```json
{
  "slug": "nsp",
  "name": "Unaav NSP",
  "wa_identifier": "Hi Unaav NSP",
  "opening_time": "09:00",
  "closing_time": "22:00",
  "first_table_vacant_mins": 10,
  "avg_turn_mins": 10,
  "max_party_size": 10,
  "lunch_cutoff": "15:30",
  "alert_phones": ["91XXXXXXXXXX"],
  "report_phones": ["91XXXXXXXXXX"],
  "managers": [
    { "username": "RaviNSP", "password": "1234" }
  ]
}
```

| Field | Description |
|---|---|
| `wa_identifier` | Exact WhatsApp message text that triggers this outlet's flow |
| `first_table_vacant_mins` | Base wait time (minutes) for position 1 |
| `avg_turn_mins` | Additional wait per queue position |
| `lunch_cutoff` | HH:MM (IST) — entries before this time count as Lunch in daily report |
| `alert_phones` | Receive immediate low-rating alerts (format: `91XXXXXXXXXX`) |
| `report_phones` | Receive daily 8 AM reports (same format) |

**Wait time formula:**
```
estimated_wait = first_table_vacant_mins + (position - 1) × avg_turn_mins
```

---

## QR Codes

Generate QR codes pointing to these URLs (replace with your Snapto number):

```
Dwarka:         https://wa.me/91XXXXXXXXXX?text=Hi%20Unaav%20Dwarka
Paschim Vihar:  https://wa.me/91XXXXXXXXXX?text=Hi%20Unaav%20Paschim%20Vihar
NSP:            https://wa.me/91XXXXXXXXXX?text=Hi%20Unaav%20NSP
```

Use [qr-code-generator.com](https://www.qr-code-generator.com) or [goqr.me](https://goqr.me) to generate — download as high-resolution PNG for printing.

---

## Built By

**Steaming Foodworks Pvt. Ltd.** · Internal Operations Tool · 2026

GSTIN: 07ABMCS8634C1Z4 · TAN: DELS05826J
