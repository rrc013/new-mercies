# New Mercies — Phase 1 setup

Do these in order. Everything happens in your web browser; nothing needs to be installed.

## 1. Lock down sign-ups in Supabase
Authentication → Sign In / Providers → **Email**:
- Turn **off** "Allow new users to sign up". New members can still join, but only through invite codes. This stops anyone from creating an account around the invite system.
- Leave the Email provider itself enabled.

## 2. Create the database
SQL Editor → **New query** → paste all of `supabase/1-schema.sql` → **Run**.
The result at the bottom shows **your first moderator invite code** (looks like `NM-LEAD-XXXX`). Write it down; it's good for one use within 14 days.

## 3. Create the two server functions
Edge Functions → **Deploy a new function** → **Via editor**:
1. Name it `account`. Replace the sample code with all of `supabase/functions/account/index.ts`. Deploy.
2. Repeat with the name `notify` and `supabase/functions/notify/index.ts`.
3. For **each** function, open it → **Details** (or Settings) → turn **off** "Verify JWT" / "Enforce JWT verification" → Save. The code checks sign-in itself, and the newer publishable keys don't work with that setting on.

If either function later reports a missing key: Edge Functions → **Secrets** → add `SB_SECRET_KEY` with your **secret** key from Project Settings → API Keys. (Never put that key anywhere else.)

## 4. Turn on scheduled jobs
Integrations → **Cron** → enable it. Then Database → Extensions → search **pg_net** → enable.
SQL Editor → New query → paste all of `supabase/2-schedules.sql` → Run. You should see three jobs listed.

## 5. Put the app on GitHub Pages
Upload everything **except** the `supabase` folder to the `new-mercies` repo (index.html, app.js, styles.css, verses.js, sw.js, manifest.webmanifest, and the icons folder).
Settings → Pages → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → Save.
After a minute the app is live at **https://rrc013.github.io/new-mercies/**

## 6. Become the first moderator
Open the app on your phone → **Join with invite** → enter the `NM-LEAD-` code → choose your group name, password, and start date → set your PIN.
Install it to your home screen (instructions are on the Me page), open it from there, and turn on notifications on the Me page. Tap "Send a test" to confirm.
Then Me → **Moderator tools** → create invite codes for the group.

## Updating the app later
When you upload changed files, open `sw.js` and bump `VERSION` (e.g. `nm-v1` → `nm-v2`) so phones pick up the new version.

## What's stored where
- **Supabase (shared with the group):** group name, start date, current step, check-ins, shares (auto-deleted after 90 days), prayer requests, SOS alerts, and push notification addresses. No email, phone number, or real name is ever collected.
- **The phone only:** the PIN (as a salted, one-way hash). Phase 2's Step 4 work will also live only on the phone, encrypted.
- Notifications on lock screens are worded neutrally ("A brother is asking for support right now," "Time for today's check-in") so nothing sensitive shows to anyone glancing at a phone.
