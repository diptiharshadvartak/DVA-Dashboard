import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sweepEmiOverdue } from '@/lib/events';
import { denyIfNotCron } from '@/lib/cron-auth';

// Vercel Cron 10:00 IST → UTC 04:30
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = denyIfNotCron(req);
  if (denied) return denied;

  const sb = supabaseAdmin();
  const cfg = (await sb.from('reminder_events').select('default_workflow_id, enabled').eq('id', 'emi.overdue').maybeSingle()).data;
  let fired = 0;
  if (cfg?.enabled) fired = await sweepEmiOverdue(sb, cfg.default_workflow_id ?? null);
  return NextResponse.json({ ok: true, fired });
}
