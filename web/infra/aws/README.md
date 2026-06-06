# AWS scheduler for the cron endpoints

Use this **only if you host the app on AWS** (or anywhere that isn't Vercel).
It recreates what Vercel Cron does for free: it calls the app's `/api/cron/*`
endpoints on schedule and sends the `CRON_SECRET` password.

`cron-eventbridge.yaml` is a CloudFormation template that builds everything in
one step:
- a small **Lambda** ("the driver") that calls one endpoint with the secret,
- **3 EventBridge schedules** ("the alarm clocks"): `daily-09`, `daily-10`,
  `end-of-month`,
- the **IAM roles** they need.

## Before you start

1. Your app must already be deployed and reachable at a public URL
   (e.g. `https://app.example.com`).
2. Set `CRON_SECRET` in the **app's** environment to a long random value (same
   as on Vercel — generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   You will paste this **same value** into the template below so the two match.

## Deploy — Console (click-by-click)

1. Open **AWS Console → CloudFormation → Create stack → With new resources**.
2. **Template is ready → Upload a template file →** choose
   `cron-eventbridge.yaml` → **Next**.
3. **Stack name:** `dva-dashboard-cron`. Fill the parameters:
   - **AppUrl:** your app's base URL, no trailing slash (e.g. `https://app.example.com`)
   - **CronSecret:** the exact `CRON_SECRET` value you set in the app
   → **Next**.
4. On the review page, tick **"I acknowledge that AWS CloudFormation might
   create IAM resources"** → **Submit**.
5. Wait ~1 minute for status **CREATE_COMPLETE**. Done — the schedules are live.

## Deploy — CLI (alternative)

```bash
aws cloudformation deploy \
  --template-file cron-eventbridge.yaml \
  --stack-name dva-dashboard-cron \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      AppUrl=https://app.example.com \
      CronSecret=PASTE_YOUR_SECRET_HERE
```

## Verify it works

You don't have to wait until 09:00. Invoke the Lambda once by hand:

```bash
aws lambda invoke \
  --function-name dva-dashboard-cron \
  --payload '{"path":"/api/cron/daily-09"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json
```

Expected: `{"path":"/api/cron/daily-09","status":200}`.
- `status: 200` → working.
- `status: 403` → the `CronSecret` you gave the template doesn't match the
  app's `CRON_SECRET`. Fix one so they're identical.

In the **CloudWatch Logs** for the `dva-dashboard-cron` function you'll see a
line per run with the path and status.

The endpoints are **idempotent** — re-running won't double-message anyone whose
reminder is already `queued`/`sent`/`delivered` — so this test is safe.

## Schedules created (for reference)

| Schedule name | Fires | Endpoint |
|---|---|---|
| `dva-cron-daily-09`     | 09:00 IST daily | `/api/cron/daily-09` |
| `dva-cron-daily-10`     | 10:00 IST daily | `/api/cron/daily-10` |
| `dva-cron-end-of-month` | 18:55 UTC on the 28th–31st | `/api/cron/end-of-month` |

To change a time later: **EventBridge → Schedules →** pick the schedule **→
Edit**. To remove everything: delete the `dva-dashboard-cron` CloudFormation
stack (this deletes the Lambda, schedules, and roles together).

> See also `../../docs/cron-setup.md` for the non-AWS options (crontab, GitHub
> Actions, hosted cron services) and the general explanation.
