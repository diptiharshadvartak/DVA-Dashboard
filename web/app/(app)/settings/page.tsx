import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyCredentials } from '@/lib/cashfree/client';
import { SettingsForm } from '@/components/settings/settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const sb = supabaseServer();

  const [{ data: { user } }, { data: status }] = await Promise.all([
    sb.auth.getUser(),
    sb.from('v_settings_status').select('*').eq('id', 1).maybeSingle(),
  ]);

  let isAdmin = false;
  if (user) {
    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = (profile as any)?.role === 'admin';
  }

  // "Configured" only means both fields are filled in; ask Cashfree whether
  // the saved keys actually work so the badge can't show a false green.
  let cashfreeVerified: 'ok' | 'rejected' | 'unknown' | null = null;
  if ((status as any)?.cashfree_configured) {
    const { data: cf } = await supabaseAdmin()
      .from('ghl_settings')
      .select('cashfree_app_id, cashfree_secret_key, cashfree_env')
      .eq('id', 1)
      .maybeSingle();
    if (cf?.cashfree_app_id && cf?.cashfree_secret_key) {
      cashfreeVerified = await verifyCredentials({
        appId: cf.cashfree_app_id,
        secretKey: cf.cashfree_secret_key,
        env: cf.cashfree_env === 'production' ? 'production' : 'sandbox',
      });
    }
  }

  const baseStatus = (status as any) ?? {
    location_id: null,
    ai_provider: 'anthropic',
    ghl_configured: false,       ghl_last4: '',
    openai_configured: false,    openai_last4: '',
    anthropic_configured: false, anthropic_last4: '',
    ai_configured: false,        ai_last4: '',
  };
  const safeStatus = { ...baseStatus, cashfree_verified: cashfreeVerified };

  return (
    <div className="px-7 py-7 max-w-[900px]">
      <h1 className="text-[24px] font-semibold tracking-tight mb-1">Settings</h1>
      <p className="text-[13.5px] text-ink-500 mb-6">AI assistant and Cashfree payments. GoHighLevel lives under GHL Integration.</p>
      <SettingsForm
        status={safeStatus}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? null}
        variant="core"
      />
    </div>
  );
}