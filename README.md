# AutoED CRM

Admissions and parent-relationship platform for K-12 schools and school groups, built from the School Admissions CRM PRD (v1.0).

Three ideas from the PRD shape the code:

- **The household is the customer.** One family, several guardians and children, one timeline. A known mobile number never creates a duplicate: it becomes a re-enquiry or a sibling.
- **One pipeline, academic year as a dimension.** Prospect → Enquiry → Visit → Application → Evaluation → Offer → Enrolled / Closed. Rollover is a wizard, not a second menu.
- **Configure, do not customise.** Fields, stages, roles, routing, templates, forms and workflows are settings a school admin changes without us.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. With no `DATABASE_URL` the app runs on an embedded in-memory Postgres (PGlite) seeded with a demo school group, so there is nothing to set up. Data resets when the server restarts.

The login page lists the demo accounts (password `demo1234`):

| Sign in as | Role | What to look at |
|---|---|---|
| `priya@greenfield.demo` | Counsellor | My day, own leads, 360 page, masked sensitive fields |
| `meera@greenfield.demo` | Admission Head | Team view, reassign, bulk actions |
| `farah@greenfield.demo` | Front Office | Walk-in desk, visit check-in |
| `anita@greenfield.demo` | Group Admin | Everything, including the admin console |
| `nikhil@` / `sunita@` / `vikram@` / `principal@greenfield.demo` | Marketing / Accounts / Read-only / Principal | Role-limited views |
| `ops@autoed.demo`, `support@autoed.demo` | AutoED platform team | Internal platform console at `/platform` |

### Persistent database (Postgres / Supabase)

Copy `.env.example` to `.env.local` and set `DATABASE_URL`. The schema in `db/schema.sql` is applied on boot and is idempotent. Set `SEED_DEMO=1` to load the demo group into an empty database; leave it unset for a real deployment and create the first tenant from the platform console (you will need one platform user, which the demo seed creates).

```bash
npm run db:setup
```

Row level security is enabled on every table so that, on Supabase, nothing is exposed through the auto-generated API. The app connects directly as the database owner and enforces tenant, branch, record and field scope itself.

### Scheduler

Workflow waits, SLA breach checks and automatic no-show marking run on page loads (at most once a minute per tenant) and through `GET /api/cron` with `Authorization: Bearer $CRON_SECRET`. In production point a scheduler at that URL every minute.

## Tests

```bash
npm test
```

35 tests: the PRD's acceptance criteria (Appendix E) — duplicate and sibling handling, tenant isolation, capacity-aware round robin, enforced next action, required fields on stage change, plain-language delivery failures, opt-out, workflow stop-on-reply, admission checklist — plus the Meta integration (with Meta's API faked), quiet hours and daily caps, team visibility, workflow conditions and two-factor codes. They run on the embedded database, or on Postgres when `DATABASE_URL` is set. GitHub Actions runs them, a typecheck and a production build on every push (`.github/workflows/ci.yml`).

Browser scripts drive the real UI (web app running with demo data; they use the Playwright already on the machine):

```bash
node scripts/e2e.js
```

```bash
node scripts/e2e-admissions.js
```

```bash
node scripts/e2e-2fa.js
```

The Android app's flows are tested on its web build at phone size (build it with `cd mobile && npx expo export --platform web`, serve `mobile/dist`, then):

```bash
node scripts/e2e-mobile.js http://localhost:8081 http://localhost:3000
```

## Android app

`mobile/` is an Expo (React Native) app for counsellors and front office: sign-in (with two-factor), My day, leads with search and quick chips, the family page (call with an outcome prompt when you come back from the dialler, WhatsApp/SMS/email with templates, notes, tasks with the enforced next action, visit booking and check-in, stage changes), quick add with the live duplicate check, and alerts with phone push notifications. It talks to the same server through `/api/m/*` with a bearer token, so every role and record rule of the web app applies.

Every push that touches `mobile/` builds an installable APK on GitHub Actions (`.github/workflows/android.yml`); download it from the run's **Artifacts**. It is signed with a debug key until you add these repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (needed for the Play Store). Push notifications also need an Expo project id (`extra.eas.projectId` in `mobile/app.json`) and Firebase credentials for Android.

## WhatsApp and lead ads (Meta)

Each school connects its own Meta Business account in **Admin › Channels and integrations**:

1. In Meta Business Suite, create or open an app with the WhatsApp product and add the school's number.
2. Create a System User with a permanent token that has `whatsapp_business_messaging` and `whatsapp_business_management` (and `leads_retrieval`, `pages_manage_metadata` for lead ads).
3. In the app's Webhooks settings, paste the callback URL and verify token shown on the admin page; subscribe to `messages` and `message_template_status_update`, and on the Page object to `leadgen`.
4. Paste the phone number ID, WhatsApp Business Account ID, token and app secret, tick **Use for sending**, save, press **Test connection**, then **Sync templates with Meta** and wait for approval.

When connected: free text is sent only inside the 24-hour window, templates go out with Meta's positional parameters, delivered / read / failed statuses come back on the timeline in plain words, and new chats and lead-ad leads become enquiries (lead form questions are matched by name). Tokens are encrypted at rest with `APP_SECRET`, so keep that value stable.

## What is built

**School workspace**
- Quick add from any screen (`N`), walk-in desk, hosted enquiry forms with UTM capture and spam protection, REST API, CSV import with review queue and one-click undo
- Real-time duplicate check, re-enquiry badge and re-open, sibling in one action
- Leads as table (column chooser, density), Kanban (drag to move, asks only for what the stage requires), cards; stage tabs with counts, quick chips, filters, saved and shared views, bulk actions on a selection or the whole filtered set, CSV export with watermark and audit entry
- Global search and command palette (`Ctrl/Cmd+K`) across parent, student, mobile, email, application number, receipt number and notes
- Household 360: tabs per child, header with stage / owner / score (with "what moved it") / next action, one action bar, unified timeline with type filters, inline-editable details, tasks, visits, application, payments, source touches, consent
- Assignment: sticky family owner, ordered rules, round robin or least load, leave and daily capacity, rule simulator, reassign with reason
- Tasks of several types, My day, team view, month calendar with drag to reschedule, and the rule that an open enquiry cannot be left without a next action
- Visits: booking with per-hour capacity, front-desk check-in, outcome required, automatic no-show and rebooking task
- Team WhatsApp inbox: unread, read-but-not-replied, SLA timer, 24-hour window rule, internal notes, quick replies
- Application: multi-section form (assisted by staff or filled by the parent on a mobile link, prefilled, save and resume), application number series, document checklist with verify / reject, age-eligibility check with override, payment links and offline payments with accounts verification and receipt series, seat check, single "Confirm admission"
- Campaigns with audience count and cost before sending, consent and enrolled-family exclusions, results funnel
- Workflow engine with 16 shipped recipes, a step editor, test run on a sample record, run log, and safeguards (one run per record, stop on reply, stop on stage exit)
- Rule-based scoring and temperature; reports with drill-down (funnel, forecast, seats vs admissions, branches, sources and cost, counsellor effort, closure reasons, untouched ageing)
- Notification centre, escalation to heads, phone push alerts for the Android app
- Automated messages respect the school's quiet hours (they wait until the window ends) and a daily cap per family
- Managers who see only their own records also see their team's (reporting lines)
- Custom fields as optional table columns, filters, CSV export columns, Quick add fields, a report breakdown and workflow conditions
- Two-factor sign-in with any authenticator app; schools can require it for everyone who can change settings; admins can reset it

**School admin console** – organisation and defaults, branches, academic years and rollover wizard, programmes and seats, users, role and permission matrix (PRD section 12, every cell editable), custom fields (including sensitive), pipeline editor with record mapping when a stage is retired, sources and spend, routing and scoring, templates, forms, workflows, API keys and webhooks, wallet ledger, data import, access and erasure requests, audit log, tickets and consent-based support access.

**Platform console (internal)** – create a tenant with a starter pack in one step, lifecycle states (suspended is read-only), plan, credit wallet, onboarding tracker, feature flags, health score, ticket desk, time-boxed impersonation only after the school admin approves, job and staff audit views.

## What is simulated, and what is not built yet

Being direct about this matters more than the feature list.

**Simulated (works end to end inside the product, does not reach the outside world):**
- SMS and email sending, and WhatsApp until a school connects Meta. Messages are recorded, merged, consent-checked and charged to the wallet, but do not leave the system. Mobile numbers ending in `00` simulate an undeliverable WhatsApp number.
- Payment checkout. `/pay/<token>` is a labelled simulator, available only on the embedded database or with `DEMO_PAYMENTS=1`. A real gateway must call `settlePayment` from its verified webhook.
- Inbound parent messages and missed calls arrive through `POST /api/v1/messages/inbound` and `/api/v1/calls/missed`, or the "simulate reply" box in the inbox (demo mode).
- Click-to-call opens the phone dialler (`tel:`) and asks for a disposition; there is no cloud telephony, recording or IVR.

**Stored but not acted on:**
- Uploaded documents: only the file name and status are saved. File storage is not connected, so files cannot be viewed.
- Feature flags and the branding colour (used on parent-facing pages only).

**Not built** (PRD items, mostly P1 / P2, plus a few P0 that need vendor accounts):
- iOS app, offline capture at events, automatic SIM call logging and caller ID (the Android app asks for the outcome after each call instead).
- Google Ads lead forms, Google Business Profile, ERP hand-off, calendar / Meet / Zoom, SSO, IP allow-list.
- Parent portal with OTP login (parents use tokenised application and payment links instead), helpdesk, referrals, partner portal.
- Offers, fee plans, concession engine and approvals, waitlist, refunds, reconciliation.
- Drag-and-drop form builder, layout editor, custom objects, terminology dictionary, sandbox and configuration versioning with rollback, multi-language interface.
- Filter builder with OR groups, map view, custom report builder, scheduled digests, year-on-year comparison, targets.
- AI features (summary, drafts, voice agent, predictive score, ask-your-data). The "At a glance" box on the 360 page is built from the record's data and says so.
- Household merge with undo, retention schedules, cross-branch transfer with acceptance.
- Invoicing with GST, dunning, usage metering, reseller accounts, uptime monitoring.

**Known limits of this build**
- Login throttling, API rate limits and idempotency keys are held in server memory, so they are per instance. Use a shared store before running more than one instance.
- Custom fields are not yet in the public enquiry form, the application form or the mobile app's details.
- The live demo runs on Supabase's free plan in Mumbai: no backups, and the project pauses after a week without use. Move to a paid plan before real school data goes in.
- The legal position on consent, retention and children's data (PRD section 14) must be confirmed with counsel before launch.

## Code map

```
db/schema.sql          Schema (multi-tenant; every table carries tenant_id)
lib/db.ts              Postgres or embedded PGlite behind one query helper
lib/core.ts            Capture, duplicates, assignment, stages, tasks, scoring, messaging
lib/workflows.ts       Recipe library and workflow engine
lib/admissions.ts      Application, documents, payments, seat check, confirm admission
lib/perm.ts            Default roles and the permission model
lib/leads.ts           One filter-to-SQL builder shared by list, Kanban, bulk, export, reports
lib/seed.ts            Tenant provisioning (starter packs) and demo data
lib/meta.ts            WhatsApp Cloud API, Meta webhooks and lead ads
lib/secrets.ts         Encrypted per-school provider credentials
lib/totp.ts            Two-factor codes
app/api/m/             JSON API for the Android app
mobile/                Android app (Expo / React Native)
app/(app)/             School workspace and admin console
app/platform/          Internal platform console
app/f, app/apply, app/pay   Parent-facing pages
app/api/v1/            Public REST API
app/actions/           Server actions (all mutations)
tests/, scripts/e2e*.js    Automated tests and browser checks
```

Stack: Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind CSS 4, PostgreSQL.
