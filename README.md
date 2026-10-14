# Paylog

A mobile-first installment tracker for an item you are buying. The app has two destinations: **My purchase** for the agreement, payoff estimate and cash kept from work, and **Payment history** for an editable payment record you can print/save as PDF or download as CSV. Supabase Auth and Postgres store the data; an anonymous session means there is no sign-in screen.

## Connect Supabase

1. Create or open a Supabase project.
2. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (or your existing `.env`). `.env.example` shows the format. The legacy `VITE_SUPABASE_ANON_KEY` is also accepted.
3. In the Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql). It creates the `paylog_data` table, enables row-level security, and limits each session to its own row.
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

## Data and accounts

Paylog creates a Supabase anonymous Auth user and saves one JSON payload per `auth.uid()` in `public.paylog_data`. The table’s RLS policies keep rows isolated between users. The Supabase JS client is the only data access implementation in `src/data/repository.js`, so a future account-linking flow can keep using the same records.

Anonymous sessions are tied to the browser’s saved session. Clearing browser storage or moving to another browser/device creates a different anonymous user. Save payment statements when you need evidence of payments. A one-time migration imports existing `paylog.data.v1` browser data when the new Supabase account has no saved row.

## Check the main flows

1. Create an agreement with its price, weekly payment, start date and optional amount already paid. Check the live payoff summary and remaining balance.
2. Add a payment with its date and time. Open **Payment history**, then print/save it as PDF or download the CSV statement.
3. Add work earnings. For example, with a GH₵100 installment, GH₵200 earned suggests GH₵100 to the seller and GH₵100 kept as profit. Change the split if needed.
4. Record an expense and confirm the cash available card subtracts it from the money kept.

Payoff and finish-date calculations are shared from `src/domain/payoff.js` between the agreement form and saved agreement view. The previous dashboard remains as a separate, unlisted route at `#dashboard`.
