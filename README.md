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

Registrar, Cashier, Teacher (types grades for their classes, otherwise view only), Student, Parent, Dean (off by default),
and Applicant (a temporary account from the online form; see *Applicant Portal*).

---

## Fees

All fee work happens on the same page. Rules live in `lib/fees/` (pure TypeScript, with tests).
Money is in pesos (₱); the rules count in centavos so totals always match.

**Fee setup** (Registrar → *Setup* in the left rail → *Fee setup*)
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

**Close term** (Registrar → *Setup* in the left rail → *Close term*)
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
- **Grade settings** (registrar, *Setup* → *Grade settings*): college average rule, period weights, grade scale,
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

## Applicant Portal

New students (or parents, for K to 12) can enroll **online without an account**, then follow their application.

**1. The enrollment form: `/apply`** (or `/apply/SA` with the school code; `/apply` works when there is only one school)

Four short pages, made for phones:

| Page | What it asks |
|------|--------------|
| 1 Personal | Last name\*, first name\*, middle name, birthdate\*, gender\*, civil status, citizenship, mobile number\* (09XXXXXXXXX), email (strongly suggested), complete address\*, guardian name\* and number\* |
| 2 Program | College or K to 12. College: school year\*, semester\*, course\*, year level\*, student type\*. K to 12: grade level\*, strand (SHS), LRN, ESC / voucher, mother tongue, IP group, 4Ps, tuition plan |
| 3 Papers | Form 138, PSA birth certificate, student picture\* (transferees: honorable dismissal and TOR). Only the picture is needed now; the rest can follow |
| 4 Confirm | Summary, "I certify that all the information provided is true and correct"\*, typed full name as signature\*, optional drawn signature, today's date |

When it is sent, the application is at step 1 (**Applied**) and a **temporary applicant account** is made:

- Username: an **applicant number** like `APP-2026-00012` (one sequence per school and year).
- Password: three words and two digits, like `mango-river-sunny-27`. It shows **once**, with a *Copy* button
  and a "Save or screenshot this" note. The applicant must pick a new password on the first sign-in.
- Anti-spam: a hidden "honeypot" field, and (Supabase mode) at most 20 forms per network per hour and 3 per email per day.

**2. The portal: `/portal`** (its own simple page). Sign in with the applicant number or the email, and the password.

- **Progress:** the 6 steps with the date of each step, and plain words: "We are checking your papers",
  "Needs a fix: *(the registrar's note)*", "Accepted! Your student number is …", plus what to do next.
- **Update details:** the applicant can change personal and program details and re-upload papers **only while
  the application is Applied** (this includes "Needs fix"). After the registrar accepts the papers, it is locked
  and the page says why. Every change is written to the history ("Contact number: 0917… → 0920…").
- **Messages to the registrar:** Follow up, Change request or Question. The registrar sees them in the main app
  (the **💬 Applicant requests** filter chip, a **Requests** section in the student card, and a reply box in the
  right column) and replies, or replies and closes. The applicant sees the reply in the portal.
- **Account:** change password, sign out.
- When the registrar presses **Assign student ID**, the applicant account becomes a normal **student** account
  (same login and password; the student number works as a login too). The portal says "You are now a student"
  and links to the main app. `/login` also accepts an applicant number or a student number.

**Demo mode:** everything works in the browser. `/apply` makes the application and the account in the demo data.
Sample logins for `/portal`: `APP-2026-00001` / `mango-river-sunny-27` (Bianca, waiting, must change the password)
and `APP-2026-00002` / `password123` (Kevin, needs a fix, with an answered question). In the main app, pick
**Applicant** in the *Viewing as* dropdown to open Kevin's portal.

**In Supabase** (`supabase/migrations/0004_applicant_portal.sql`):

- New role `applicant`, new paper type `photo`, applicant columns on `students`, the signed certification on
  `enrollments.application`, `profiles.must_change_password`, and the table `applicant_requests` (applicants see
  their own; the registrar sees all of the school; rows are written only by functions).
- `applicant_submit` (callable without login) checks every field again, applies the rate limit and makes the
  application. The server (`app/api/apply/route.ts`) then makes the login and calls `applicant_link_account`
  with a one-time token. `applicant_update_details` (only while Applied), `applicant_request_create /
  _answer / _close`, `login_email` (number + password → login email, see *Accounts and passwords*) and
  `applicant_password_changed` do the rest.
  A trigger turns the applicant into a student when the status becomes Student ID made.

**`SUPABASE_SERVICE_ROLE_KEY` (optional, server only):** put it in `.env.local` **without** `NEXT_PUBLIC_`.
It is only read by `app/api/apply/route.ts` on the server and must never reach the browser, because it skips
every security rule. With it, the server makes the applicant's login directly (no email needed) and uploads the
papers. **Without it**, the form asks for an email, Supabase sends a "confirm your email" message (signUp), and
the applicant confirms before signing in; papers are then uploaded in the portal (unless email confirmation is
off in your project). No other email service is used: the password is **not** emailed, it is only shown on the
success screen.

---

## Accounts and passwords

- **Forgot password?** is on `/login` and on the portal sign-in. It asks for the email and sends a link
  (Supabase sends the email). The page always says *"If that email is on file, we sent a link"*, so nobody
  can use it to find out which emails have an account. The link opens `/reset-password` (through
  `/auth/callback`, which signs the person in for that one step), where they type the new password twice.
- **Change password**: every signed-in person (staff, student, parent, applicant) opens the account menu
  (bottom of the left rail, or the *Account* tab on phones) → *Change password*. A side panel asks for the
  new password twice. Rules: at least 8 characters, letters and at least one number.
- **Sign in with a number** (applicant or student number): the database gives back the email of that
  login **only when the password is right** (`login_email(number, password)` in `0005_security.sql`).
  A wrong password and an unknown number get the same answer and the same message
  (*"Wrong login or password."*). After 10 wrong tries in 15 minutes, signing in with that number is
  paused for 15 minutes (signing in with the email still works).
- An applicant account made without an email (`…@applicants.….local`) cannot get a reset email.
  The school can set a new password for it in Supabase (*Authentication → Users*).
- **Demo mode:** *Forgot password?* shows the same message and sends nothing; `/reset-password` and
  *Change password* work with the practice data in your browser.

**Supabase settings for the email link** (*Authentication → URL Configuration*):

- **Site URL:** your app address, for example `https://skolr-one.vercel.app`.
- **Redirect URLs:** add `https://skolr-one.vercel.app/**` (and `http://localhost:3000/**` for testing on your computer).
- Supabase's built-in email sender only sends a few emails per hour and is meant for testing. For a real
  school, set up your own email sender (*Authentication → Emails → SMTP Settings*).

**Before real people use the app: remove the practice logins.** Run `supabase/remove-demo-accounts.sql`
in the SQL Editor (safe to run again). It takes away the access of every sample login (emails ending in
`@sample.edu.ph`, and the sample applicant `APP-2026-00001`): their memberships, parent links and student
links. A sample login that nothing else points to is deleted. One that is named in the sample history,
payments or grades is switched off instead (banned, with a random password nobody knows), so those records
stay complete. The sample school and its records are not deleted; to start completely empty, run `reset.sql`
and the migrations without `seed.sql`.

---

## Run it in demo mode (no setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase keys the app runs in **demo mode**:

- Data lives in your browser, filled with "Sample Academy" sample data.
- The app is one page: modules in the left rail, a list, then the details (see `docs/design.md`). Open the account menu at the bottom of the rail (the *Account* tab on phones) to switch between Registrar, Cashier, Student, Parent, Teacher and Applicant, reset the demo, or sign out.
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
   - `supabase/migrations/0004_applicant_portal.sql` (online form, applicant accounts, requests)
   - `supabase/migrations/0005_security.sql` (safe sign-in with a number, all-or-nothing saves)
   - `supabase/seed.sql` (Sample Academy and demo logins)

   Already ran 0001 to 0004 and have data you want to keep? Run only `0005_security.sql`. It changes no data.

   Ran it before, or it stopped half way (error like `type "app_role" already exists`)? Run `supabase/reset.sql` first, then the files above again. It removes only the skolr-one tables and the demo logins.

   With the CLI: `supabase link --project-ref <ref>` then `supabase db reset --linked`
   (runs the migration and the seed).
3. Copy `.env.example` to `.env.local` and fill in the values from
   *Project Settings → API*:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   # optional, server only (see Applicant Portal):
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
4. Set the Site URL and Redirect URLs for the password reset email (see *Accounts and passwords*).
5. `npm run dev` and sign in. Seed logins (password `password123`):
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
| `node scripts/applicant-walkthrough.cjs` | Same for the Applicant Portal: online form, credentials, portal, registrar reply and needs fix, re-upload, student ID (saves `screenshots/applicant-*.png`) |
| `node scripts/grades-walkthrough.cjs` | Same for grades: encode, submit, return, approve, deadline, change request, report card, phone view (saves `screenshots/grades-*.png`) |
| `node scripts/security-walkthrough.cjs` | Same for passwords: Forgot password, reset page, Change password (staff app, phone, portal) (saves `screenshots/security-*.png`) |

## How the code is laid out

```
app/                 the one page (/), /login, /forgot-password, /reset-password, /auth/callback,
                     /apply (public form), /portal, /api/apply
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
lib/applicant/       applicant portal rules, pure TypeScript + tests
  ids.ts             applicant numbers (APP-2026-00012) and login names
  password.ts        temporary passwords (3 words + 2 digits), new password checks
  validate.ts        the 4 form pages, PH mobile numbers
  rules.ts           edit allowed by status, requests open → answered → closed, promotion, portal text
lib/account/         sign-in messages, password rules, reset link (pure TypeScript + tests)
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

- Applicant Portal: the temporary password is shown on screen only (not emailed).
  The rate limit trusts the IP address the server passes in. A drawn signature is kept in the database (PNG).

- In Supabase mode every action that writes several rows is one database function (one transaction):
  `enrollment_create`, `enrollment_apply`, `document_record`, `fees_save_setup`, `grades_save_draft`
  (`0005_security.sql`), plus the fee and grade functions. Uploading a paper puts the file in storage
  first; if saving its row then fails, the file stays in storage unused. Changing a password and clearing
  the "must change password" flag are two steps (the password lives in Supabase Auth); repeating them is harmless.
- Voiding a payment does not move an enrollment back from "Assessed & paid".
- Penalties are a ledger row type, but there is no button yet to add late penalties.
- Closing carries balances owed (> 0) only; a credit (overpayment) stays on the closed term.
- A user works in the first school they belong to (no school switcher yet).
- Prerequisites use posted, passed grades. `completed_codes` on the student is still read as a
  fallback for subjects passed before the school used this app (or in another school).
- INC does not expire automatically (no "INC becomes 5.00 after one year" rule yet).

## What's next

- **Fees:** late penalties, printable official receipts, refunds of credit.
- **Grades:** INC completion deadlines, Transcript of Records (TOR), SF10, honors and dean's list, import scores from a spreadsheet.
- **Online payment:** GCash / Maya / bank cards with automatic OR numbers and payment confirmation.
- School settings screen (dean step, downpayment, max units, rates).
- DepEd forms export (SF1, SF10) and CHED enrollment lists.
- Notifications (email/SMS) when a step changes.
