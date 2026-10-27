# Setting up The Standard

This guide takes you from this GitHub repository to the app running on your phone with real reminders. It assumes no programming. Plan on about 45 minutes. Everything used here has a free tier that is enough for one person.

You will create:

1. A **Supabase** project — your private database and sign-in system.
2. A **Vercel** project — hosts the app at a web address.
3. Optionally, an **Anthropic** API key — for AI features (only follow-up questions in Phase 1).

Keep a private note open while you work (your password manager's secure notes is ideal). You'll copy several values into it. **Never paste the values marked "secret" into chat, email or documents.**

---

## Step 1 — Create the Supabase project

1. Go to **supabase.com** and sign up (signing in with GitHub is easiest).
2. Click **New project**.
   - Name: `the-standard`
   - Database password: click **Generate**, then save it in your private note.
   - Region: **East US (North Virginia)** — closest to Raleigh.
3. Wait about two minutes for the project to finish setting up.

## Step 2 — Create the database tables

1. In the GitHub repository, open `supabase/migrations/20261027000001_init.sql`, click the **Copy raw file** button (two overlapping squares, top-right of the file).
2. In Supabase, open **SQL Editor** (left sidebar) → **New query**.
3. Paste, then click **Run**. You should see *Success. No rows returned.*
4. Check: open **Table Editor**. You should see tables including `profiles`, `goals`, `tasks`, `commitments`, `journal_entries`, `reminders`.

## Step 3 — Copy your Supabase keys

In Supabase: **Project Settings** (gear icon) → **API Keys** (and **Data API** for the URL).

Save these three in your private note:

| Save as | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → **Project URL** (looks like `https://abcd1234.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The **Publishable key** (starts `sb_publishable_`). On older projects this is the **anon public** key. |
| `SUPABASE_SERVICE_ROLE_KEY` — **secret** | The **Secret key** (starts `sb_secret_`; click to reveal). On older projects this is the **service_role** key. |

The secret key can read and delete everything in your database. It goes only into Vercel.

## Step 4 — Put the app online with Vercel

1. Go to **vercel.com** and sign up **with GitHub**.
2. Click **Add New… → Project**, find this repository, click **Import**.
3. Leave every build setting as it is. Open **Environment Variables** and add the three Supabase values from Step 3, plus:
   - `NEXT_PUBLIC_APP_URL` → leave out for now (you'll add it in a moment).
4. Click **Deploy**. When it finishes, Vercel shows your address, something like `https://the-standard-tahir.vercel.app`. Save it in your note as `NEXT_PUBLIC_APP_URL` (no slash at the end).

### Generate the notification keys and scheduler secret

5. Open `https://YOUR-ADDRESS/setup-keys.html` (your Vercel address followed by `/setup-keys.html`).
6. Click **Generate keys**. The keys are made inside your browser; nothing is sent anywhere.
7. In Vercel: your project → **Settings → Environment Variables**. Add each of these:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | your Vercel address, e.g. `https://the-standard-tahir.vercel.app` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | from the key page |
| `VAPID_PRIVATE_KEY` — **secret** | from the key page |
| `CRON_SECRET` — **secret** | from the key page. Also save it in your note; you need it in Step 6. |
| `VAPID_SUBJECT` | `mailto:` followed by your email, e.g. `mailto:you@example.com` |

8. Go to **Deployments**, open the three-dot menu on the latest deployment → **Redeploy**. (Settings only take effect on a new deployment.)

## Step 5 — Tell Supabase where the app lives

In Supabase: **Authentication → URL Configuration**.

- **Site URL:** your Vercel address.
- **Redirect URLs:** click **Add URL** and enter your address followed by `/**` — for example `https://the-standard-tahir.vercel.app/**`.

Then **Authentication → Sign In / Providers → Email**: keep **Confirm email** turned on.

Finally, make the email links work even if you open them on a different device than the one you signed up on. In **Authentication → Emails → Templates**:

- **Confirm signup** — replace the link in the message body with:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
- **Magic Link** — replace the link with:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/today`
- **Reset Password** — replace the link with:
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/settings/password`

In each template, the link is the `href="…"` inside the `<a>` tag; replace only what's between the quotes.

> Supabase's built-in email sender is meant for testing and allows only a few emails per hour. That's fine for signing up once. If you later need password resets often, connect your own email sender under **Authentication → Emails → SMTP Settings** (Resend or Postmark both work).

## Step 6 — Turn on the reminder scheduler

This makes Supabase call your app every minute to send reminders that are due.

1. In GitHub, open `supabase/setup/schedule_jobs.sql` and copy it.
2. In Supabase **SQL Editor → New query**, paste it.
3. Replace the two values marked **CHANGE ME**:
   - `https://YOUR-APP.vercel.app` → your Vercel address (no slash at the end)
   - `YOUR-CRON-SECRET` → the `CRON_SECRET` from your note
4. Click **Run**.
5. Wait two minutes, then run this in a new query:

   ```sql
   select status_code, content, created from net._http_response order by created desc limit 3;
   ```

   You want `status_code` **200** and content that begins `{"ok":true`. A **401** means the secret in Supabase and Vercel don't match. A **500** containing "Missing environment variable" means a Vercel variable is missing — add it and redeploy.

## Step 7 — Create your account

1. Open your Vercel address on your computer.
2. Click **Create an account**, enter your email and a password of at least 10 characters.
3. Open the confirmation email and click the link. You'll land on the setup screen.
4. Choose your check-in times and quiet hours, select your focus areas, and decide about AI analysis (you can leave it off).

## Step 8 — Install on your iPhone and turn on reminders

iPhone only delivers web-app notifications to apps added to the Home Screen.

1. Open your Vercel address in **Safari** on the iPhone and sign in.
2. Tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
3. Open **The Standard from the Home Screen icon** (not from Safari).
4. Go to **More → Reminders** and tap **Turn on reminders**, then **Allow**.
5. Tap **Send a test**. The notification should appear within a few seconds, and the delivery log below should change to *Shown on the device*.

Repeat step 4 on any other device you want reminders on (Android phones and desktop Chrome work directly in the browser).

## Step 9 — Check everything works (acceptance checklist)

Do these once after setup. Each maps to an acceptance criterion in the brief.

| # | Do this | You should see |
|---|---|---|
| 1 | Sign out (More → Sign out) and sign back in | Today page |
| 2 | Goals → **Goal**, fill it in. Today → add a task | Both appear on Today |
| 3 | Plan → **Appointment** 30 minutes from now, preparation 10 min, travel 5 min | On save, Plan shows "Prepare from …", "Leave by …" |
| 4 | Wait for the appointment's reminders, phone locked and app closed | Notifications arrive; Reminders → Delivery log shows *Shown on the device* |
| 5 | Journal → **Write**, save; then search for a word in it | The entry is found |
| 6 | Check-in → Morning; answer one question with just "busy" | A follow-up asks for specifics |
| 7 | AI features | Arrive in Phase 2 (see below) |
| 8 | Weekly review | Arrives in Phase 2 |
| 9 | Quranic reflections | Arrive in Phase 3 |
| 10 | Settings & data → **Download** export; open the file | Your records as JSON |

If a reminder doesn't arrive, open **More → Reminders**. The "Not delivered" and "Delivery log" sections show exactly what happened (no device registered, push service error, or still scheduled because the scheduler isn't running — recheck Step 6).

## Optional — Enable AI follow-up questions

1. Go to **console.anthropic.com**, create an account, add a payment method, and create an API key.
2. In Vercel → Settings → Environment Variables, add `ANTHROPIC_API_KEY` (**secret**) and redeploy.
3. In the app: **Settings & data → AI analysis**, turn on **Allow Claude to read my entries**.

With both on, vague check-in answers get a follow-up written by Claude, labelled as such. With either off, the built-in rule-based follow-ups are used and nothing is sent to Anthropic.

---

## Updating the app later

When new code is pushed to the repository's main branch, Vercel redeploys automatically. If an update includes a new file in `supabase/migrations/`, run it in the SQL Editor the same way as Step 2, in filename order.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Missing environment variable …" | Add it in Vercel → Settings → Environment Variables, then Redeploy. |
| Confirmation link says it expired | Request a new one by signing up again or use **Email me a link**; check Step 5's Redirect URL. |
| "Notifications aren't configured on the server yet" | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` missing, or you didn't redeploy. |
| iPhone shows "needs the app on your Home Screen" | Open the app from the Home Screen icon, not Safari. Requires iOS 16.4 or later. |
| Reminders stay "Scheduled" past their time | The scheduler isn't calling the app — rerun the check in Step 6. |
| "Notifications are blocked for this site" | iPhone: Settings → Notifications → The Standard → Allow. Desktop: the lock icon in the address bar → Notifications → Allow. |
