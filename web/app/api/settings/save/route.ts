import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkCredentials } from '@/lib/cashfree/client';

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

  // If any Cashfree credential is changing, test the resulting combination
  // against Cashfree before saving, so bad keys never show as "Configured".
  if (patch.cashfree_app_id || patch.cashfree_secret_key || patch.cashfree_env) {
    if (patch.cashfree_app_id?.includes('@')) {
      return new NextResponse(
        'Cashfree App ID looks like an email address. Copy the App ID from Cashfree → Developers → API Keys.',
        { status: 400 }
      );
    }
    const { data: current } = await admin
      .from('ghl_settings')
      .select('cashfree_app_id, cashfree_secret_key, cashfree_env')
      .eq('id', 1)
      .maybeSingle();
    const appId = patch.cashfree_app_id ?? current?.cashfree_app_id;
    const secretKey = patch.cashfree_secret_key ?? current?.cashfree_secret_key;
    const env = (patch.cashfree_env ?? current?.cashfree_env) === 'production' ? 'production' : 'sandbox';
    if (appId && secretKey) {
      const check = await checkCredentials({ appId, secretKey, env });
      if (check.result === 'rejected') {
        const label = (e: string) => (e === 'production' ? 'Production' : 'Sandbox');
        const other = env === 'production' ? 'sandbox' : 'production';
        // Most common mistake: right keys, wrong environment. Say so directly.
        const otherCheck = await checkCredentials({ appId, secretKey, env: other });
        if (otherCheck.result === 'ok') {
          return new NextResponse(
            `These are ${label(other)} keys. Change Environment to "${label(other)}" and save again. Nothing was saved.`,
            { status: 400 }
          );
        }
        const usedStored =
          !patch.cashfree_app_id ? ' (the App ID box was empty, so the previously saved App ID was used)' :
          !patch.cashfree_secret_key ? ' (the Secret Key box was empty, so the previously saved secret was used)' : '';
        return new NextResponse(
          `Cashfree rejected these keys in both Sandbox and Production${usedStored}. Cashfree said: "${check.message || `HTTP ${check.status}`}". Re-copy the App ID and Secret Key from the same row in Cashfree → Developers → API Keys. Nothing was saved.`,
          { status: 400 }
        );
      }
    }
  }
  const { error } = await admin
    .from('ghl_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true, updated: Object.keys(patch).length });
}