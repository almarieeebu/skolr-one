# School Enrollment (MVP)

A simple enrollment system for schools in the Philippines. It covers
**College** (CHED rules) and **K to 12** (DepEd rules), and it can hold many
schools in one database.

Everything happens on **one page**:

- **Left:** the list of enrollments, with search and filter chips (status, College / K to 12, level).
  Items waiting on you come first.
- **Middle:** the student card. A 6-step progress bar, then Profile, Papers, Load, Fees and History.
- **Right:** the action box. It only shows the buttons your role can press right now.
- **New application** opens a side panel. Switch between College and K to 12 to change the fields.

### The 6 steps

| # | Status | Who moves it |
|---|--------|--------------|
| 1 | Applied | Student or parent sends the form and papers |
| 2 | Papers checked | Registrar: Accept papers / Needs fix (back to step 1 with a note) / Reject |
| 3 | Student ID made | Registrar assigns an ID like `SA-2026-0005` |
| 4 | Load set | Student, parent or registrar picks subjects (college) or a section (K to 12) |
| 5 | Assessed & paid | Cashier records the downpayment with an OR number |
| 6 | Officially enrolled | Registrar approves (and can later Withdraw) |

- Returning students (they already have an ID) start at step 4.
- Every change is saved in the history (who, when, from, to, reason).
- When a check fails (missing papers, prerequisites, too many units, time conflict,
  full class, no downpayment) a warning shows. Only the **registrar** can override, and must type a reason.
- Optional dean step: set `use_dean_approval: true` in the school settings. Then the dean
  approves before the registrar's final approval.

### Roles

Registrar, Cashier, Teacher (view only, sees students in their classes), Student, Parent, and Dean (off by default).

---

## Run it in demo mode (no setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase keys the app runs in **demo mode**:

- Data lives in your browser, filled with "Sample Academy" sample data.
- Use the **Viewing as** dropdown in the header to switch between Registrar, Cashier, Student, Parent and Teacher.
- **Reset demo** puts the sample data back.

Try this: as Registrar, open *Dela Cruz, Juan* → Accept papers → Assign student ID.
Switch to Student → Pick subjects → Save. Switch to Cashier → record a payment with an OR number.
Switch back to Registrar → Approve enrollment.

## Connect Supabase

1. Create a project at https://supabase.com.
2. Run the database files, in order, in the **SQL Editor** (or with the Supabase CLI):
   - `supabase/migrations/0001_init.sql` (tables, enums, security rules, storage bucket)
   - `supabase/seed.sql` (Sample Academy and demo logins)

   With the CLI: `supabase link --project-ref <ref>` then `supabase db reset --linked`
   (runs the migration and the seed).
3. Copy `.env.example` to `.env.local` and fill in the values from
   *Project Settings → API*:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
4. `npm run dev` and sign in. Seed logins (password `password123`):
   `registrar@sample.edu.ph`, `cashier@sample.edu.ph`, `teacher@sample.edu.ph`,
   `juan@sample.edu.ph` (student), `parent@sample.edu.ph`, `dean@sample.edu.ph`.

New users need a row in `memberships` (user, school, role) before they can use the app.
The registrar can add these in the Supabase table editor for now.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the app |
| `npm run build` | Production build |
| `npm test` | Unit tests for the business rules (vitest) |
| `npm run seed:sql` | Rebuild `supabase/seed.sql` from `lib/data/seed.ts` |
| `node scripts/demo-walkthrough.cjs` | Click through the whole flow with Playwright and save screenshots (needs Playwright installed and the dev server running; set `BASE_URL`) |

## How the code is laid out

```
app/                 the one page (/) and /login
components/          list, student card, action box, side panels
lib/enrollment/      business rules, pure TypeScript + tests
  status.ts          steps and allowed status changes
  actions.ts         who can press what; planAction() returns the changes to save
  checks.ts          papers, prerequisites, max units, time conflicts, slots, section capacity
  fees.ts            college and K to 12 fee assessment
  queue.ts           sort order and who can see what
lib/data/
  store.ts           the ONE data interface the UI uses
  demo-store.ts      in-browser data (demo mode)
  supabase-store.ts  Supabase data (real mode)
  seed.ts            sample data shared by demo mode and seed.sql
supabase/            migration and seed
proxy.ts             keeps the Supabase login fresh (Next.js 16 "proxy")
```

Both stores use the same rules: `planAction()` decides what should change, then the
store saves it. So demo mode and Supabase mode behave the same.

## Known limits of this MVP

- In Supabase mode the saves for one action are separate requests, not one transaction.
- Fee lines are written from the browser. Row Level Security limits who can write, but a
  determined student could change their own fee lines while picking a load. Moving
  `planAction` into a Postgres function (RPC) fixes both points.
- A user works in the first school they belong to (no school switcher yet).
- "Passed subjects" for prerequisites is a simple list on the student (`completed_codes`) until a grades module exists.

## What's next

- **Fees module:** fee templates per course/grade, discounts and scholarships, installment due dates, statement of account, receipts.
- **Grades module:** encode grades per subject, so prerequisites use real passing grades; report cards (SF9) and TOR.
- **Online payment:** GCash / Maya / bank cards with automatic OR numbers and payment confirmation.
- School settings screen (dean step, downpayment, max units, rates).
- DepEd forms export (SF1, SF10) and CHED enrollment lists.
- Notifications (email/SMS) when a step changes.
