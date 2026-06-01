import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

// POST /api/webhooks/ghl — receives delivery, opt-out, and contact-update events
export const runtime = 'nodejs';

function verifyHmac(rawBody: string, signature: string | null) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret || !signature) return !secret; // if no secret configured, accept (dev)
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // constant-time compare
  const a = Buffer.from(expected); const b = Buffer.from(signature.replace(/^sha256=/, ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get('x-ghl-signature') ?? req.headers.get('x-signature');
  if (!verifyHmac(raw, sig)) return new NextResponse('bad signature', { status: 401 });

  const event = JSON.parse(raw) as {
    type: string;
    contactId?: string;
    workflowId?: string;
    messageStatus?: string;        // delivered / failed / etc.
    optedOut?: boolean;
    [k: string]: any;
  };

  const sb = supabaseAdmin();

  switch (event.type) {
    case 'OutboundMessage':
    case 'WorkflowComplete': {
      // best-effort: mark the most recent reminder for this contact as delivered/failed.
      // PostgREST ignores .order()/.limit() on UPDATE, so we must first resolve
      // the single latest 'sent' reminder's id, then update by id — otherwise the
      // update would overwrite EVERY 'sent' reminder for this contact.
      const status = event.messageStatus === 'delivered' || event.type === 'WorkflowComplete' ? 'delivered' : 'failed';
      const { data: latest } = await sb.from('reminders')
        .select('id')
        .eq('ghl_contact_id', event.contactId ?? '')
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        await sb.from('reminders')
          .update({ status, fired_at: new Date().toISOString() })
          .eq('id', (latest as any).id);
      }
      break;
    }
    case 'ContactUpdate': {
      if (event.contactId && event.email) {
        await sb.from('students').update({
          first_name: event.firstName ?? undefined,
          last_name:  event.lastName ?? undefined,
          mobile:     event.phone ?? undefined,
        }).eq('ghl_contact_id', event.contactId);
      }
      break;
    }
    default:
      // ignore unknown events for now
      break;
  }

  return NextResponse.json({ ok: true });
}
