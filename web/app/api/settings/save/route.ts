import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'groq', 'openrouter', 'vertex']);
const VALID_CF_ENVS = new Set(['sandbox', 'production']);

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse('unauthenticated', { status: 401 });

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    return new NextResponse('admin only', { status: 403 });
  }

  const body = (await req.json()) as {
    ghl_location_id?: string;
    ghl_pit_token?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
    ai_provider?: string;
    ai_api_key?: string;
    cashfree_app_id?: string;
    cashfree_secret_key?: string;
    cashfree_env?: string;
    cashfree_webhook_secret?: string;
  };

  const patch: Record<string, string> = {};
  if (body.ghl_location_id?.trim())   patch.location_id       = body.ghl_location_id.trim();
  if (body.ghl_pit_token?.trim())     patch.ghl_pit_token     = body.ghl_pit_token.trim();
  if (body.openai_api_key?.trim())    patch.openai_api_key    = body.openai_api_key.trim();
  if (body.anthropic_api_key?.trim()) patch.anthropic_api_key = body.anthropic_api_key.trim();
  if (body.ai_provider?.trim() && VALID_PROVIDERS.has(body.ai_provider.trim())) {
    patch.ai_provider = body.ai_provider.trim();
  }
  if (body.ai_api_key?.trim())        patch.ai_api_key        = body.ai_api_key.trim();

  // Cashfree fields
  if (body.cashfree_app_id?.trim())          patch.cashfree_app_id          = body.cashfree_app_id.trim();
  if (body.cashfree_secret_key?.trim())      patch.cashfree_secret_key      = body.cashfree_secret_key.trim();
  if (body.cashfree_webhook_secret?.trim())  patch.cashfree_webhook_secret  = body.cashfree_webhook_secret.trim();
  if (body.cashfree_env?.trim() && VALID_CF_ENVS.has(body.cashfree_env.trim())) {
    patch.cashfree_env = body.cashfree_env.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin
    .from('ghl_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(patch).length });
}