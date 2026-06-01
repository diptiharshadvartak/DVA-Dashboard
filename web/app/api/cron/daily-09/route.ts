import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sweepEmiRemindersDue, sweepSilentStudents, sweepFollowupsDue } from '@/lib/events';
import { denyIfNotCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = denyIfNotCron(req);
  if (denied) return denied;

  const sb = supabaseAdmin();
  await sb.rpc('refresh_emi_statuses' as any);

  const wf = async (id: string) => (await sb.from('reminder_events').select('default_workflow_id, enabled').eq('id', id).maybeSingle()).data;

  const emiCfg      = await wf('emi.reminder_due');
  const silentCfg   = await wf('student.no_call_30d');
  const followupCfg = await wf('student.followup_due');

  let fired = 0;
  if (emiCfg?.enabled)      fired += await sweepEmiRemindersDue(sb, emiCfg.default_workflow_id ?? null);
  if (silentCfg?.enabled)   fired += await sweepSilentStudents(sb, silentCfg.default_workflow_id ?? null);
  if (followupCfg?.enabled) fired += await sweepFollowupsDue(sb, followupCfg.default_workflow_id ?? null);

  return NextResponse.json({ ok: true, fired });
}