# Scheduled jobs (cron) — how the reminders fire

The app's automatic reminders (EMI due, overdue, silent students, follow-ups,
end-of-month) are **not** triggered by anything inside the app. They are plain
HTTP endpoints that have to be **called on a schedule by something outside the
app**. On Vercel that "something" is built in. On any other host you provide it
yourself. This doc explains both.

## The endpoints and when they should run

| Endpoint | Schedule (UTC cron) | In IST | What it does |
|---|---|---|---|
| `/api/cron/daily-09`     | `30 3 * * *`        | 09:00 daily | EMI reminders (2 days before due), silent students, follow-ups due |
| `/api/cron/daily-10`     | `30 4 * * *`        | 10:00 daily | EMI overdue reminders, etc. |
| `/api/cron/end-of-month` | `55 18 28-31 * *`   | ~00:25 IST on the 29th–1st | End-of-month roll-up |

The source of truth for the schedule is `web/vercel.json`.

## The shared password: `CRON_SECRET`

These endpoints are public URLs, so they are protected by a shared secret.
Every call **must** include the header:

```
Authorization: Bearer <CRON_SECRET>
```

If the header is missing or wrong, the endpoint returns **403** and does nothing
(see `lib/cron-auth.ts`). `CRON_SECRET` is an environment variable — a long
random string. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the **same value** in two places:
1. The app's environment (so it knows the password to check against).
2. Whatever calls the endpoints (so it sends the right password).

> Keep this value private. Never commit it to git.

---

## Option A — Vercel (recommended, zero extra setup)

Vercel reads `vercel.json` and runs the schedule automatically. It also injects
the `Authorization: Bearer <CRON_SECRET>` header for you. You only do this once:

1. **Project → Settings → Environment Variables** → add `CRON_SECRET`
   (Production scope) = your generated value.
2. **Redeploy** (env changes apply only on a new deployment).

Done. Nothing else to run. To verify, check **Deployments → (latest) → Logs**
or the function's logs around the scheduled time — a healthy run returns `200`
with `{ ok: true, fired: <n> }`; a `403` means the secret doesn't match.

---

## Option B — Any other host (AWS, Render, Railway, a VPS, Docker…)

On these hosts `vercel.json` is **ignored** — nothing calls the endpoints, so
you must add your own scheduler **and** make it send the secret. Pick ONE of the
following. Replace `https://YOUR_APP` and `YOUR_SECRET` accordingly.

### B1. Linux server / VPS / Docker host — `crontab`

Edit the crontab (`crontab -e`) and add (times are **UTC** — match the table
above; set the server timezone to UTC or adjust):

```cron
30 3  * * *     curl -sS -X GET https://YOUR_APP/api/cron/daily-09     -H "Authorization: Bearer YOUR_SECRET" >/dev/null
30 4  * * *     curl -sS -X GET https://YOUR_APP/api/cron/daily-10     -H "Authorization: Bearer YOUR_SECRET" >/dev/null
55 18 28-31 * * curl -sS -X GET https://YOUR_APP/api/cron/end-of-month -H "Authorization: Bearer YOUR_SECRET" >/dev/null
```

### B2. AWS — EventBridge Scheduler

For each endpoint, create a schedule:

1. **EventBridge → Scheduler → Schedules → Create schedule.**
2. Recurring schedule, cron expression (UTC) from the table above.
3. Target: **API destination** (or a tiny Lambda — see below).
   - Method: `GET`, URL: `https://YOUR_APP/api/cron/daily-09`
   - Add header `Authorization` = `Bearer YOUR_SECRET`
     (store the secret in **Secrets Manager** and reference it, rather than
     pasting it in plain text).
4. Repeat for `daily-10` and `end-of-month`.

If API destinations are awkward, point the schedule at a 10-line Lambda instead:

```js
// Node.js Lambda — env: APP_URL, CRON_SECRET, CRON_PATH (e.g. /api/cron/daily-09)
export const handler = async () => {
  const res = await fetch(`${process.env.APP_URL}${process.env.CRON_PATH}`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  return { status: res.status, body: await res.text() };
};
```

### B3. No server at all — GitHub Actions

Commit `.github/workflows/cron.yml`. Store the secret as a repo secret
(**Settings → Secrets and variables → Actions**) named `CRON_SECRET`, and the
app URL as `APP_URL`:

```yaml
name: app-cron
on:
  schedule:
    - cron: '30 3 * * *'   # daily-09  (UTC)
    - cron: '30 4 * * *'   # daily-10  (UTC)
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: daily-09
        if: github.event.schedule == '30 3 * * *'
        run: curl -sS -X GET "${{ secrets.APP_URL }}/api/cron/daily-09" -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
      - name: daily-10
        if: github.event.schedule == '30 4 * * *'
        run: curl -sS -X GET "${{ secrets.APP_URL }}/api/cron/daily-10" -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

> Note: GitHub Actions scheduled runs can be delayed several minutes under load,
> and are paused on repos with no activity for 60 days. Fine for reminders,
> not for to-the-second timing.

### B4. Hosted cron service (cron-job.org, EasyCron, Upstash QStash)

Create one job per endpoint: set the URL, the schedule (UTC), method `GET`, and
add a custom request header `Authorization: Bearer YOUR_SECRET`. Simplest if you
don't want to run any infrastructure.

---

## Quick test (any host)

```bash
# Wrong/no secret -> should return 403 and do nothing:
curl -i https://YOUR_APP/api/cron/daily-09

# Correct secret -> should return 200 {"ok":true,"fired":N}:
curl -i https://YOUR_APP/api/cron/daily-09 -H "Authorization: Bearer YOUR_SECRET"
```

Note: the sweeps are **idempotent** — a reminder already `queued`/`sent`/
`delivered` for an EMI is skipped, so re-running a job will not double-message
students.
