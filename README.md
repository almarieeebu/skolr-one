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
| 5 | Assessed & paid | Cashier records the downpayment with an OR number (back account + minimum downpayment reached) |
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

## Fees

All fee work happens on the same page. Rules live in `lib/fees/` (pure TypeScript, with tests).
Money is in pesos (₱); the rules count in centavos so totals always match.

**Fee setup** (Registrar → *Fee setup* button in the header, side panel)
- One setup per term and track. You can add a more specific one per course and/or year level
  (college) or per grade level (K to 12). The most specific match wins.
- College: rate per unit, a higher rate for **major** subjects (tick "Major" per subject),
  lab fee per subject, misc items, minimum downpayment, and the exam periods
  (Prelim, Midterm, Semi-final, Final; 25% each by default) with due dates.
- K to 12: tuition plans (annual, quarterly, monthly) with their items, an optional installment
  surcharge, and the plan total; misc items; ESC grant and SHS voucher amounts; minimum downpayment.
- OR series: prefix, next number and digits. One series per school.
- New rates apply when a load is picked or changed. Fees already posted do not change.

**Assessment** = tuition + lab + misc (+ installment surcharge) − discounts. Posted when the load is saved.

**Payment schedule**
- College: downpayment, then the rest split over the exam periods by percent.
- K to 12: downpayment, then the rest split by plan (annual 1, quarterly 4, monthly 10 from June to March).
- Leftover centavos go on the last installment. Each line shows Paid, Partly paid, Due, Overdue, Upcoming or Carried.

**Discounts and scholarships** (Registrar → *Apply discount / scholarship*)
- On one fee item, on a group (for example tuition only) or on the total; a fixed amount or a percent; a reason is required.
- They stack in a fixed order: **item → group → total**. A percent uses what is left at that point. A discount never goes below zero.
- K to 12 students with the voucher flag get the ESC grant (Grades 7–10) or SHS voucher (Grades 11–12) as a fixed amount automatically.

**Ledger**
- Every charge, discount, payment, penalty, void and carried balance is one row (debit or credit). Balance = sum of the rows.
- Rows are never edited. A change posts a reversing row and a new row. A void is a reversing row with a reason.

**Cashier payments** (Cashier → *Take payment* in the right box)
- Amount, mode (Cash, GCash with reference, bank transfer, check), and the OR number (filled in from the series; you can type another).
- Payments pay the oldest item first: back account, then the downpayment, then installments by due date.
  Paying more than the balance keeps the extra as **credit**.
- *Void payment*: the cashier can void only today's payments; the registrar can void any payment as an override. Both need a reason.

**Statement of account**: *Print statement of account* in the Fees section prints a clean page
(school name, student, items, payments, schedule, balance). The rest of the page is hidden when printing.

**Close term** (Registrar → *Close term* button in the header)
- For each enrollment of the term with a balance, the balance is moved to the student's next-term
  enrollment as **Previous balance**. If the student has no next-term enrollment yet, it is added when one is made.
- The closed term takes no more payments, discounts or load changes.
- The next term shows the back account first, and *Approve enrollment* warns until it is paid.

**Who can do what**

| Role | Fees |
|------|------|
| Registrar | Fee setup, discounts, close term, void any payment (override) |
| Cashier | Take payments, void today's payments |
| Student / Parent | See their own fees, schedule and statement (read only) |
| Dean | See fees (read only) |
| Teacher | Nothing about fees |

**In Supabase** (`supabase/migrations/0002_fees.sql`): fee rows are **never written from the browser**.
Charges are worked out in Postgres from the saved load and the fee setup (`fees_assess`), and payments,
discounts, voids and closing are database functions that check your role first
(`fees_take_payment`, `fees_apply_discount`, `fees_remove_discount`, `fees_void_payment`, `fees_close_term`).
A payment, its ledger row, the OR number, the status change and the history row are saved in one transaction.
Ledger rows cannot be updated or deleted. Teachers cannot read any fee table.

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

The sample data also has fee setups for every term, discounts (Mark, Carla), payments,
an ESC/SHS voucher (Sofia) and a student with a carried balance from last year (*Garcia, Pedro*).

## Connect Supabase

1. Create a project at https://supabase.com.
2. Run the database files, in order, in the **SQL Editor** (or with the Supabase CLI):
   - `supabase/migrations/0001_init.sql` (tables, enums, security rules, storage bucket)
   - `supabase/migrations/0002_fees.sql` (fees: setups, discounts, payments, ledger, OR series, closing)
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
| `node scripts/fees-walkthrough.cjs` | Same for the fees flow: setup, load, payments, scholarship, statement, term closing (saves `screenshots/fees-*.png`) |

## How the code is laid out

```
app/                 the one page (/) and /login
components/          list, student card, action box, side panels
lib/enrollment/      business rules, pure TypeScript + tests
  status.ts          steps and allowed status changes
  actions.ts         who can press what; planAction() returns the changes to save
  checks.ts          papers, prerequisites, max units, time conflicts, slots, section capacity
  queue.ts           sort order and who can see what
lib/fees/            fee rules, pure TypeScript + tests
  setup.ts           pick the setup for a student, defaults, checks
  assess.ts          charges and discounts (item → group → total)
  ledger.ts          ledger rows, voids, balance
  schedule.ts        payment schedule and oldest-due-first allocation
  actions.ts         payments, discounts, voids (planners)
  closing.ts         term closing and carried balances
  roles.ts           who may do what with fees
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

- In Supabase mode the non-fee saves for one action (load, status, history) are still separate
  requests. All money is safe: it is posted by database functions in one transaction each.
- Voiding a payment does not move an enrollment back from "Assessed & paid".
- Penalties are a ledger row type, but there is no button yet to add late penalties.
- Closing carries balances owed (> 0) only; a credit (overpayment) stays on the closed term.
- A user works in the first school they belong to (no school switcher yet).
- "Passed subjects" for prerequisites is a simple list on the student (`completed_codes`) until a grades module exists.

## What's next

- **Fees:** late penalties, printable official receipts, refunds of credit.
- **Grades module:** encode grades per subject, so prerequisites use real passing grades; report cards (SF9) and TOR.
- **Online payment:** GCash / Maya / bank cards with automatic OR numbers and payment confirmation.
- School settings screen (dean step, downpayment, max units, rates).
- DepEd forms export (SF1, SF10) and CHED enrollment lists.
- Notifications (email/SMS) when a step changes.
