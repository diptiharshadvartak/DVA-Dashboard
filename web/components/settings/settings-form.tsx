'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Save, Eye, EyeOff, Check, ChevronDown, Sparkles, Mic,
  Info, Users, UserPlus, ShieldCheck, Loader2, AlertTriangle,
  Trash2, ArrowDown, ArrowUp, CreditCard,
} from 'lucide-react';
import { useToast } from '@/components/shell/toast-region';

type Provider = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter';

type Status = {
  location_id: string | null;
  ai_provider: Provider;
  ghl_configured: boolean;       ghl_last4: string;
  openai_configured: boolean;    openai_last4: string;
  anthropic_configured: boolean; anthropic_last4: string;
  ai_configured: boolean;        ai_last4: string;
  cashfree_configured?: boolean; cashfree_app_id_last4?: string;
  cashfree_env?: 'sandbox' | 'production';
};

const PROVIDERS: Array<{ value: Provider; label: string; model: string; placeholder: string; helpUrl: string; supportsVoice: boolean }> = [
  { value: 'openai',     label: 'OpenAI',           model: 'GPT-4o-mini',           placeholder: 'sk-...',     helpUrl: 'https://platform.openai.com/api-keys',              supportsVoice: true  },
  { value: 'anthropic',  label: 'Anthropic Claude', model: 'Claude Haiku 4.5',      placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys',       supportsVoice: false },
  { value: 'google',     label: 'Google Gemini',    model: 'Gemini 1.5 Flash',      placeholder: 'AIza...',    helpUrl: 'https://aistudio.google.com/app/apikey',            supportsVoice: false },
  { value: 'groq',       label: 'Groq',             model: 'Llama 3.1 70B (fast)',  placeholder: 'gsk_...',    helpUrl: 'https://console.groq.com/keys',                     supportsVoice: true  },
  { value: 'openrouter', label: 'OpenRouter',       model: 'auto-routed',           placeholder: 'sk-or-...',  helpUrl: 'https://openrouter.ai/settings/keys',               supportsVoice: false },
];

export function SettingsForm({
  status, isAdmin, currentUserId, variant = 'all',
}: {
  status: Status;
  isAdmin: boolean;
  currentUserId: string | null;
  // 'core' → Settings page (AI + Voice + Cashfree); 'ghl' → GHL Integration page
  // (GoHighLevel connection). 'all' keeps the full form (back-compat).
  variant?: 'all' | 'core' | 'ghl';
}) {
  const showCore = variant === 'all' || variant === 'core';
  const showGhl  = variant === 'all' || variant === 'ghl';
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [aiProvider, setAiProvider] = useState<Provider>(status.ai_provider ?? 'anthropic');
  const [form, setForm] = useState({
    ghl_location_id: '', ghl_pit_token: '', ai_api_key: '', openai_api_key: '',
  });
  // Chrome ignores autoComplete="off" and autofills the saved login email into
  // the Location ID box. Loading the field read-only blocks that; it becomes
  // editable the moment the user focuses it, so editing/saving is unchanged.
  const [ghlLocReadOnly, setGhlLocReadOnly] = useState(true);

  // Cashfree integration state
  const initialCashfreeEnv: 'sandbox' | 'production' = status.cashfree_env ?? 'sandbox';
  const [cashfreeAppId, setCashfreeAppId]                 = useState('');
  const [cashfreeSecret, setCashfreeSecret]               = useState('');
  const [cashfreeEnv, setCashfreeEnv]                     = useState<'sandbox' | 'production'>(initialCashfreeEnv);
  const [cashfreeWebhookSecret, setCashfreeWebhookSecret] = useState('');

  const selectedProvider = PROVIDERS.find((p) => p.value === aiProvider) ?? PROVIDERS[1];
  const savedProviderSupportsVoice =
    PROVIDERS.find((p) => p.value === status.ai_provider)?.supportsVoice ?? false;
  const voiceAutoShared = savedProviderSupportsVoice && status.ai_configured;
  const voiceAutoProviderLabel =
    PROVIDERS.find((p) => p.value === status.ai_provider)?.label ?? 'AI provider';

  async function save() {
    if (!isAdmin) { toast('Admin role required to save settings', 'error'); return; }
    setSaving(true);
    try {
      const payload: any = {};
      if (showCore) payload.ai_provider = aiProvider;
      if (form.ghl_location_id.trim()) payload.ghl_location_id = form.ghl_location_id.trim();
      if (form.ghl_pit_token.trim())   payload.ghl_pit_token   = form.ghl_pit_token.trim();
      if (form.ai_api_key.trim())      payload.ai_api_key      = form.ai_api_key.trim();
      if (form.openai_api_key.trim())  payload.openai_api_key  = form.openai_api_key.trim();
      // Cashfree fields
      if (cashfreeAppId.trim())          payload.cashfree_app_id           = cashfreeAppId.trim();
      if (cashfreeSecret.trim())         payload.cashfree_secret_key       = cashfreeSecret.trim();
      if (cashfreeWebhookSecret.trim())  payload.cashfree_webhook_secret   = cashfreeWebhookSecret.trim();
      // Only send env if user changed it or is also setting credentials —
      // otherwise unrelated saves would clobber a stored 'production' back to 'sandbox'.
      if (cashfreeEnv !== initialCashfreeEnv || cashfreeAppId.trim() || cashfreeSecret.trim()) {
        payload.cashfree_env = cashfreeEnv;
      }

      const res = await fetch('/api/settings/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const { updated } = await res.json();
      toast(updated > 0 ? `Saved (${updated} field${updated > 1 ? 's' : ''})` : 'Nothing changed', 'success');
      setForm({ ghl_location_id: '', ghl_pit_token: '', ai_api_key: '', openai_api_key: '' });
      setCashfreeAppId('');
      setCashfreeSecret('');
      setCashfreeWebhookSecret('');
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) { toast(e.message ?? 'Save failed', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {showCore && (<>
      <Card title="AI assistant" icon={<Sparkles className="w-4 h-4 text-accent-700" />}
        desc="Powers the AI Progress summaries on every student. Pick a provider, then paste that provider's API key."
      >
        <div className="mb-3">
          <div className="text-[12px] font-medium text-ink-700 mb-1.5">Provider</div>
          <div className="relative">
            <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value as Provider)}
              className="w-full h-9 pl-3 pr-9 rounded-lg border border-ink-200 bg-white text-[13px] focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 appearance-none"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} · {p.model}{p.supportsVoice ? ' · 🎤' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
          </div>
          <div className="text-[11px] text-ink-500 mt-1.5">🎤 = also handles voice transcription</div>
        </div>
        <SecretField
          label={`${selectedProvider.label} API Key`}
          configured={status.ai_configured && status.ai_provider === aiProvider}
          last4={status.ai_last4}
          value={form.ai_api_key}
          shown={!!show.ai}
          onToggle={() => setShow((s) => ({ ...s, ai: !s.ai }))}
          onChange={(v) => setForm((f) => ({ ...f, ai_api_key: v }))}
          placeholder={selectedProvider.placeholder}
          helpUrl={selectedProvider.helpUrl}
        />
        {aiProvider !== status.ai_provider && (
          <div className="flex items-start gap-2 mt-3 text-[12px] text-amber-800 bg-amber-50 rounded-lg p-2.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-600" />
            <div>You changed the provider. Paste the new key above and click Save to switch.</div>
          </div>
        )}
      </Card>

      <Card title="Voice transcription" icon={<Mic className="w-4 h-4 text-emerald-700" />}
        desc="Powers the 🎤 mic button when logging calls and editing student backgrounds."
      >
        {voiceAutoShared ? (
          <div className="flex items-start gap-2 text-[12.5px] text-emerald-800 bg-emerald-50 rounded-lg p-3">
            <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            <div>
              <div className="font-medium">Voice ready — using {voiceAutoProviderLabel} Whisper</div>
              <div className="text-[11.5px] text-emerald-700 mt-0.5">
                Your AI key above also handles voice. Nothing more to configure.
              </div>
            </div>
          </div>
        ) : status.ai_provider && !savedProviderSupportsVoice ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-[12.5px] text-amber-800 bg-amber-50 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <div className="font-medium">{voiceAutoProviderLabel} doesn't support voice</div>
                <div className="text-[11.5px] text-amber-700 mt-0.5">
                  Either paste a separate OpenAI Whisper key below, OR switch your AI provider above to <strong>OpenAI</strong> or <strong>Groq</strong> (both have 🎤).
                </div>
              </div>
            </div>
            <SecretField label="OpenAI Whisper key (separate)"
              configured={status.openai_configured} last4={status.openai_last4}
              value={form.openai_api_key} shown={!!show.openai}
              onToggle={() => setShow((s) => ({ ...s, openai: !s.openai }))}
              onChange={(v) => setForm((f) => ({ ...f, openai_api_key: v }))}
              placeholder="sk-..." helpUrl="https://platform.openai.com/api-keys"
            />
          </div>
        ) : (
          <details className="text-[12px]">
            <summary className="text-ink-500 cursor-pointer hover:text-ink-700">Paste a dedicated OpenAI Whisper key…</summary>
            <div className="mt-2">
              <SecretField label="OpenAI Whisper key (separate)"
                configured={status.openai_configured} last4={status.openai_last4}
                value={form.openai_api_key} shown={!!show.openai}
                onToggle={() => setShow((s) => ({ ...s, openai: !s.openai }))}
                onChange={(v) => setForm((f) => ({ ...f, openai_api_key: v }))}
                placeholder="sk-..." helpUrl="https://platform.openai.com/api-keys"
              />
            </div>
          </details>
        )}
      </Card>
      </>)}

      {showGhl && (<>
      <Card title="GoHighLevel (optional)"
        desc="Only needed if you use Pull from GHL to bulk-import contacts. Reminders use webhook URLs and don't need this."
      >
        <div className="grid gap-3">
          <label className="block">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-medium text-ink-700">Location ID</span>
              {status.location_id && (
                <span className="text-[11px] text-ink-500">Current: <span className="font-mono text-ink-700">{status.location_id}</span></span>
              )}
            </div>
            <input type="text" value={form.ghl_location_id} name="ghl_location_id"
              onChange={(e) => setForm((f) => ({ ...f, ghl_location_id: e.target.value }))}
              placeholder="e.g. abc123XYZ" autoComplete="off"
              readOnly={ghlLocReadOnly} onFocus={() => setGhlLocReadOnly(false)}
              className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 bg-white"
            />
          </label>
          <SecretField label="Private Integration Token"
            configured={status.ghl_configured} last4={status.ghl_last4}
            value={form.ghl_pit_token} shown={!!show.ghl}
            onToggle={() => setShow((s) => ({ ...s, ghl: !s.ghl }))}
            onChange={(v) => setForm((f) => ({ ...f, ghl_pit_token: v }))}
            placeholder="pit-..." helpUrl="https://app.gohighlevel.com/settings/private-integrations"
          />
        </div>
      </Card>

      <Card title="Reminders" desc="Scheduled events, GHL webhook URLs, and per-event toggles.">
        <a href="/reminders" className="text-[13px] text-accent-700 font-medium hover:underline">
          Open reminder catalog →
        </a>
      </Card>
      </>)}

      {showCore && (
      <Card title="Cashfree Payments" icon={<CreditCard className="w-4 h-4 text-blue-600" />}
        desc="Generate payment links automatically for each EMI. Students pay via UPI/cards. Webhook auto-marks EMI as paid.">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium text-ink-700 mb-1 block">Environment</label>
              <select
                value={cashfreeEnv}
                onChange={(e) => setCashfreeEnv(e.target.value as 'sandbox' | 'production')}
                disabled={!isAdmin}
                className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] bg-white"
              >
                <option value="sandbox">Sandbox (Test)</option>
                <option value="production">Production (Live)</option>
              </select>
            </div>
            <div className="flex items-end">
              {status.cashfree_configured && (
                <div className="flex items-center gap-1.5 text-[12px] text-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Configured (app ID ends with {status.cashfree_app_id_last4 || '••••'})
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-ink-700 mb-1 block">App ID (x-client-id)</label>
            <input
              type="text"
              value={cashfreeAppId}
              onChange={(e) => setCashfreeAppId(e.target.value)}
              placeholder={status.cashfree_configured ? 'Already configured — leave blank to keep' : 'TEST10456abc...'}
              disabled={!isAdmin}
              className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-accent-500 focus:ring-2 focus:ring-accent-100 outline-none bg-white font-mono"
            />
          </div>

          <div>
            <label className="text-[12px] font-medium text-ink-700 mb-1 block">Secret Key (x-client-secret)</label>
            <input
              type="password"
              value={cashfreeSecret}
              onChange={(e) => setCashfreeSecret(e.target.value)}
              placeholder={status.cashfree_configured ? 'Already configured — leave blank to keep' : 'cfsk_ma_test_...'}
              disabled={!isAdmin}
              className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:border-accent-500 focus:ring-2 focus:ring-accent-100 outline-none bg-white font-mono"
            />
            <div className="text-[11px] text-ink-500 mt-1">
              From Cashfree Dashboard → Developers → API Keys. Keep this secret.
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-ink-700 mb-1 block">Webhook Secret (optional)</label>
            <input
              type="password"
              value={cashfreeWebhookSecret}
              onChange={(e) => setCashfreeWebhookSecret(e.target.value)}
              placeholder="From Cashfree → Developers → Webhooks → Add Webhook"
              disabled={!isAdmin}
              className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] bg-white font-mono"
            />
            <div className="text-[11px] text-ink-500 mt-1 leading-relaxed">
              <strong>Setup webhook in Cashfree:</strong><br/>
              1. Dashboard → Developers → Webhooks → Add Webhook<br/>
              2. Paste this URL: <code className="bg-ink-100 px-1.5 py-0.5 rounded text-[10.5px]">https://[your-domain]/api/cashfree/webhook</code><br/>
              3. Select events: <em>Payment Success</em>, <em>Payment Failed</em><br/>
              4. Copy the generated secret here → save
            </div>
          </div>
        </div>
      </Card>
      )}


      <div className="flex items-center justify-end gap-3 pt-2">
        {!isAdmin && (
          <span className="text-[12px] text-amber-700">Read-only — admin role required to save.</span>
        )}
        <button onClick={save} disabled={saving || !isAdmin}
          className="h-9 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-medium inline-flex items-center gap-2 disabled:opacity-50 hover:bg-ink-800"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Shared UI primitives
// ============================================================================

function Card({ title, icon, desc, children }: { title: string; icon?: React.ReactNode; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-5">
      <div className="flex items-center gap-2">
        {icon}
        <div className="font-semibold text-[14px]">{title}</div>
      </div>
      <div className="text-[12.5px] text-ink-500 mt-0.5 mb-4">{desc}</div>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 h-8 text-[12.5px] font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 ${
        active ? 'border-accent-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-700'
      }`}
    >{children}</button>
  );
}

function InputField({
  label, value, onChange, placeholder, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <div className="text-[11.5px] font-medium text-ink-700 mb-1">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="off"
        className="w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 bg-white"
      />
    </label>
  );
}

function SecretField({
  label, configured, last4, value, shown, onToggle, onChange, placeholder, helpUrl,
}: {
  label: string;
  configured: boolean;
  last4: string;
  value: string;
  shown: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  placeholder?: string;
  helpUrl?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-medium text-ink-700">{label}</span>
        <div className="flex items-center gap-2">
          {helpUrl && (
            <a href={helpUrl} target="_blank" rel="noopener" className="text-[11px] text-ink-500 hover:text-accent-700 hover:underline">
              get key ↗
            </a>
          )}
          {configured ? (
            <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Configured · …<span className="font-mono">{last4}</span>
            </span>
          ) : (
            <span className="text-[11px] text-amber-700">Not configured</span>
          )}
        </div>
      </div>
      <div className="relative">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full h-9 pl-3 pr-9 rounded-lg border border-ink-200 text-[13px] font-mono focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 bg-white"
        />
        <button type="button" onClick={onToggle} tabIndex={-1}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-ink-500 hover:text-ink-800 rounded-md hover:bg-ink-100"
          aria-label={shown ? 'Hide' : 'Show'}
        >
          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </label>
  );
}