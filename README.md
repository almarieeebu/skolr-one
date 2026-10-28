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

Registrar, Cashier, Teacher (types grades for their classes, otherwise view only), Student, Parent, and Dean (off by default).

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

## Grades

Teachers type grades in the same page. Rules live in `lib/grades/` (pure TypeScript, with tests).

**Where things are**

- **Teacher:** opens on **My classes**. Click a class to open its grade sheet. Tab moves across,
  Enter moves down and Shift+Enter moves up, like a spreadsheet. **Save draft**, then **Submit grades**.
- **Registrar:** the **Grades** tab shows all classes. The **Grades to approve** filter shows only
  submitted sheets. Open one and **Approve and post** it, or **Return to teacher** with a note.
- **Grade settings** (header button, registrar): college average rule, period weights, grade scale,
  K to 12 weights per subject group, and deadlines.
- **Student card → Grades:** the grades of that student, with GWA or general average, and
  **Print grade slip / Print report card** (SF9 style). Students and parents see posted grades only.

**College (CHED)**

- Four periods: Prelim, Midterm, Semi-final, Final. Teachers type a percent (e.g. 87) or a mark
  (INC, DRP, W). Each period sheet is submitted and posted on its own.
- The average of the periods is worked out on the percents, then changed to a grade with the
  scale (default: 97-100% = 1.00 … 75% = 3.00, below 75% = 5.00). The school picks the average rule:
  divide by all four, divide by the grades present, or "the Final period is the average".
- The final grade shows only when the Final period has a value. W beats DRP, DRP beats INC.
- Remarks: Passed (3.00 or better), Failed, Incomplete, Dropped, Withdrawn.
- **GWA** = sum of (grade × units) ÷ units. It leaves out INC, DRP, W and non-credit subjects (NSTP).
- **Prerequisites** now use real passed grades (posted, remark Passed). The old `completed_codes`
  list on the student still counts too, for subjects taken before the school used this app.

**K to 12 (DepEd Order 8, s. 2015)**

- Each quarter has Written Work, Performance Tasks and Quarterly Assessment. The teacher adds score
  items (with the highest possible score) and types scores.
- Percentage score → weighted score (weights per subject group, e.g. Languages/AP/EsP 30/50/20,
  Science/Math 40/40/20, MAPEH/EPP/TLE 20/60/20) → initial grade → the DepEd transmutation table
  → quarterly grade (60 lowest, 75 passing).
- Final grade = average of the quarters. **General average** = average of the final grades, with
  MAPEH counted **once** (the average of Music, Arts, PE and Health).
- Descriptors: Outstanding 90-100, Very Satisfactory 85-89, Satisfactory 80-84,
  Fairly Satisfactory 75-79, Did Not Meet Expectations below 75.
- **Kinder** uses a simple checklist per domain: B (Beginning), D (Developing), C (Consistent).

**Steps of a grade sheet**

Draft → Submitted → Posted. The registrar posts it (the dean does instead when dean approval is on).
The registrar or that approver can **Return to teacher**
a submitted sheet with a note; it goes back to the teacher to fix and submit again.
After the deadline the teacher sees a warning and cannot submit until the registrar presses
**Allow late submission**. Posted grades are locked. To change one, the teacher sends a
**Change grade request** with a reason; the registrar approves or rejects it. Every change is kept
in the sheet history.

| Role | Can do with grades |
|------|--------------------|
| Teacher | Type, save and submit grades for their own classes; ask for a grade change |
| Registrar | See all grades, approve and post (when dean approval is off), return, allow late, decide change requests, settings |
| Dean | Approve and post or return when dean approval is on; otherwise view only |
| Student / Parent | See their own posted grades and print the report card |
| Cashier | Nothing about grades |

**In Supabase** (`supabase/migrations/0003_grades.sql`): teachers can only write draft grades in
their own classes (row level security). Grades are worked out again in Postgres by a trigger, so a
typed-in grade cannot be faked. Submit, approve, return, allow late and change requests go through
database functions that check your role (`grades_sheet_action`, `grades_request_change`,
`grades_decide_change`). Posted rows cannot be changed except by those functions.
Students and parents can read posted grades only.

**Choices we made (assumptions)**

- One sheet per class per period (college) or per quarter and learning area (K to 12).
- In K to 12 the section's class adviser grades all its learning areas in this MVP.
- Senior High subjects run for two quarters per semester (Q1-Q2 or Q3-Q4).
- The college grade slip uses the current grade scale when it is printed.
- Kinder checklist marks have no change request (the registrar can return the sheet before posting).

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
   - `supabase/migrations/0003_grades.sql` (grades: sheets, scores, settings, change requests, history)
   - `supabase/seed.sql` (Sample Academy and demo logins)

   Ran it before, or it stopped half way (error like `type "app_role" already exists`)? Run `supabase/reset.sql` first, then the files above again. It removes only the skolr-one tables and the demo logins.

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
   Subject teachers: `teacher.ge@sample.edu.ph`, `teacher.math@sample.edu.ph`,
   `teacher.pe@sample.edu.ph`, `teacher.kinder@sample.edu.ph`.

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
| `node scripts/grades-walkthrough.cjs` | Same for grades: encode, submit, return, approve, deadline, change request, report card, phone view (saves `screenshots/grades-*.png`) |

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
lib/grades/          grade rules, pure TypeScript + tests
  college.ts         CHED periods, average, 1.00-5.00 scale, INC/DRP/W, GWA
  k12.ts             DepEd WW/PT/QA, transmutation table, general average, Kinder checklist
  workflow.ts        draft → submit → post, return, late, change requests (planners)
  report.ts          grade slip / report card rows, passed subjects for prerequisites
  settings.ts        grade settings, deadlines
  roles.ts           who may do what with grades
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
- Prerequisites use posted, passed grades. `completed_codes` on the student is still read as a
  fallback for subjects passed before the school used this app (or in another school).
- INC does not expire automatically (no "INC becomes 5.00 after one year" rule yet).
- In Supabase mode, saving a draft grade sheet writes rows one request at a time (posting is one transaction).

## What's next

- **Fees:** late penalties, printable official receipts, refunds of credit.
- **Grades:** INC completion deadlines, Transcript of Records (TOR), SF10, honors and dean's list, import scores from a spreadsheet.
- **Online payment:** GCash / Maya / bank cards with automatic OR numbers and payment confirmation.
- School settings screen (dean step, downpayment, max units, rates).
- DepEd forms export (SF1, SF10) and CHED enrollment lists.
- Notifications (email/SMS) when a step changes.
