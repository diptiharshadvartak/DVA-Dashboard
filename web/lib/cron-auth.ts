import { NextResponse } from 'next/server';

// Authorize a Vercel Cron request. Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is configured, so a
// shared-secret check is sufficient. The previous fallback that accepted any
// request whose user-agent was 'vercel-cron/1.0' was insecure — that header is
// fully attacker-controlled, so anyone could trigger these privileged sweeps.
//
// Returns a 403 NextResponse if the request is not an authorized cron call,
// or null if it may proceed.
export function denyIfNotCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse('forbidden', { status: 403 });
  }
  return null;
}
