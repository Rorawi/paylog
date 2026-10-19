# Paylog

A mobile-first Work and Pay vehicle tracker for drivers and sales workers in Ghana. The app has **Overview**, **Work & earnings**, and **Vehicle payments**. It tracks vehicle details, owner payments, daily work income, operating costs, take-home, money held by someone else, and upcoming payment reminders. Supabase Auth and Postgres store the data; an anonymous session means there is no sign-in screen.

## Connect Supabase

1. Create or open a Supabase project.
2. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (or your existing `.env`). `.env.example` shows the format. The legacy `VITE_SUPABASE_ANON_KEY` is also accepted.
3. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql). It creates the `paylog_data` table, enables row-level security, and sets up a private `payment-receipts` Storage bucket. Each session can access only its own records and receipt images. If Paylog is already set up, run the updated script again to add receipt storage; it is safe to rerun.
4. In the Supabase Dashboard, open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Paylog uses this to create a private browser session without a login screen. If Paylog reports that anonymous sign-ins are disabled, change this project setting and tap **Try again**.

Use only the Supabase publishable/anon key in the Vite environment. Never put a Supabase secret or service-role key in a `VITE_` variable; those values are included in browser code. Row-level security is the access control for this app.

## Run locally

```sh
npm install
npm run dev
```

Open the local address Vite prints. To use a phone on the same Wi-Fi, run `npm run dev -- --host 0.0.0.0` and open Vite’s network address.

For a production build:

```sh
npm run build
npm run preview
```

## Install Paylog

Paylog is a Progressive Web App. Deploy it over HTTPS, then use your browser's **Install app** option on desktop or Android. On iPhone, open Paylog in Safari, tap **Share**, then **Add to Home Screen**. For a local desktop check, use the production preview above at the localhost address Vite prints; the development server does not register the service worker.

The app shell and built assets are cached so Paylog can open offline after it has loaded once. Supabase records, sign-in, and receipt images still need an internet connection.

## Data and accounts

Paylog creates a Supabase anonymous Auth user and saves one JSON payload per `auth.uid()` in `public.paylog_data`. The table’s RLS policies keep rows isolated between users. Payment receipt files are stored in the private `payment-receipts` bucket under a user-specific folder; the payment record keeps the file path, and Paylog creates a short-lived private link when someone views it. The Supabase JS client is the only data access implementation in `src/data/repository.js`, so a future account-linking flow can keep using the same records.

Anonymous sessions are tied to the browser’s saved session. Clearing browser storage or moving to another browser/device creates a different anonymous user. Save payment statements when you need evidence of payments. A one-time migration imports existing `paylog.data.v1` browser data when the new Supabase account has no saved row.

## Check the main flows

1. Set up a vehicle plan with make/model, owner, agreed price, payment amount and due day. Registration, daily sales or earnings, and a deposit are optional. Check the live payoff and weekly work estimate.
2. Record daily sales or earnings. The suggested split sets money aside for the vehicle owner and running costs, then shows your take-home. Change the split if needed.
3. Record a vehicle cost such as fuel, servicing, tolls or parking, or a personal expense. Vehicle costs stay separate from payments toward the vehicle price.
4. Record a payment after the vehicle owner receives it. Optionally attach a receipt photo, then open **Vehicle payments** and tap **View receipt**. Print/save the statement as PDF or download CSV.
5. On Overview, choose **Record money held**, enter a trusted person's name and amount, then check **Money held for me**. Reserve some of that amount for the vehicle payment if needed. A reserve does not reduce the balance until the owner receives a recorded payment.
6. Record a payment from yourself or select **Someone holding my money paid** and choose the holder. The vehicle balance and payment history update once. Money returned by a holder is a transfer, not income or spending.

Run the held-money ledger checks with `npm test`.

Payoff and finish-date calculations are shared from `src/domain/payoff.js` between the agreement form and saved agreement view. The previous dashboard remains as a separate, unlisted route at `#dashboard`.
