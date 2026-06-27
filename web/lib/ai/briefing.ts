import Anthropic from '@anthropic-ai/sdk';
import { getRuntimeSettings } from '@/lib/settings';
import { callVertex } from '@/lib/ai/vertex';

export const BRIEFING_SYSTEM_PROMPT = `You are a coaching ops assistant. Summarize this student for the next coach
who is about to call them. Be concrete, cite call dates, and attribute themes to
the coach who introduced them. Do NOT invent facts. If something is unclear,
say so explicitly.

OUTPUT MARKDOWN with these sections only:
## Story (2–3 sentences)
## Ongoing threads (per coach, with date ranges)
## Open actions (with due dates)
## Flags (only if real concerns exist)`;

type Student = {
  first_name: string | null; last_name: string | null;
  membership: string | null; tags: string[] | null;
  start_date: string | null; end_date: string | null;
  background: string | null;
  month_1: boolean; month_2: boolean; month_3: boolean;
  month_4: boolean; month_5: boolean; month_6: boolean;
};

type Call = {
  created_at: string; comment: string;
  outcome: string | null; next_action: string | null;
  coach_initials: string;
};

type Emi = {
  installment_no: number; installments_total: number;
  amount: number; due_date: string;
  status: string; paid_date: string | null;
};

type Provider = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter' | 'vertex';

// Current production models (May 2026):
//   - Groq: llama-3.3-70b-versatile (3.1 was decommissioned)
//   - Google: gemini-2.5-flash (1.5 was deprecated)
const PROVIDER_CFG: Record<Provider, { endpoint: string; model: string; label: string }> = {
  openai:     { endpoint: 'https://api.openai.com/v1/chat/completions',                 model: 'gpt-4o-mini',               label: 'OpenAI GPT-4o-mini' },
  anthropic:  { endpoint: '',                                                            model: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  google:     { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',    model: 'gemini-2.5-flash',          label: 'Gemini 2.5 Flash' },
  groq:       { endpoint: 'https://api.groq.com/openai/v1/chat/completions',            model: 'llama-3.3-70b-versatile',   label: 'Groq Llama 3.3 70B' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions',              model: 'openai/gpt-4o-mini',        label: 'OpenRouter (GPT-4o-mini)' },
  vertex:     { endpoint: '',                                                            model: 'gemini-2.5-flash',          label: 'Vertex AI (Gemini 2.5 Flash)' },
};

function buildContext(student: Student, calls: Call[], emi: Emi[]): string {
  const progress = [
    student.month_1, student.month_2, student.month_3,
    student.month_4, student.month_5, student.month_6,
  ].map((b, i) => `M${i + 1}: ${b ? '✓' : '✗'}`).join(' · ');

  const emiSnap = emi.map((e) =>
    `${e.installment_no}/${e.installments_total} · ${e.amount} · due ${e.due_date} · ${e.status}${e.paid_date ? ` (paid ${e.paid_date})` : ''}`
  ).join('\n');

  const callLines = calls.map((c) =>
    `[${c.created_at.slice(0, 10)} · ${c.coach_initials}] outcome=${c.outcome ?? '?'} next=${c.next_action ?? '-'}\n  ${c.comment.replace(/\s+/g, ' ').slice(0, 400)}`
  ).join('\n');

  return [
    `STUDENT: ${student.first_name ?? ''} ${student.last_name ?? ''}`,
    `Membership: ${student.membership ?? '—'} · Tags: ${(student.tags ?? []).join(', ') || '—'}`,
    `Enrolled: ${student.start_date ?? '?'} → ${student.end_date ?? '?'}`,
    `Monthly checkpoint progress: ${progress}`,
    `Background: ${student.background ?? '—'}`,
    '',
    `EMI:\n${emiSnap || '(no EMI plan)'}`,
    '',
    `CALLS (oldest → newest):\n${callLines || '(no calls logged yet)'}`,
  ].join('\n');
}

async function callOpenAICompatible(
  endpoint: string, model: string, apiKey: string, system: string, user: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ text: string; in: number; out: number; model: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model, max_tokens: 1500,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${endpoint.split('/')[2]} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text:  data?.choices?.[0]?.message?.content ?? '',
    in:    data?.usage?.prompt_tokens     ?? 0,
    out:   data?.usage?.completion_tokens ?? 0,
    model: data?.model ?? model,
  };
}

async function callAnthropic(
  apiKey: string, model: string, system: string, user: string
): Promise<{ text: string; in: number; out: number; model: string }> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model, max_tokens: 1500, system,
    messages: [{ role: 'user', content: user }],
  });
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return { text, in: msg.usage.input_tokens, out: msg.usage.output_tokens, model: msg.model };
}

async function callGoogle(
  apiKey: string, model: string, system: string, user: string
): Promise<{ text: string; in: number; out: number; model: string }> {
  const url = `${PROVIDER_CFG.google.endpoint}/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 1500, temperature: 0.7 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Google returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    const finishReason   = candidate?.finishReason ?? 'unknown';
    const safetyRatings  = candidate?.safetyRatings ?? [];
    const blockedCat     = safetyRatings.find((r: any) => r.blocked)?.category ?? null;
    const promptFeedback = data?.promptFeedback?.blockReason ?? null;
    throw new Error(
      `Gemini returned no text (finishReason=${finishReason}` +
      (blockedCat ? `, blocked=${blockedCat}` : '') +
      (promptFeedback ? `, prompt_blocked=${promptFeedback}` : '') + ')'
    );
  }
  return {
    text,
    in:    data?.usageMetadata?.promptTokenCount     ?? 0,
    out:   data?.usageMetadata?.candidatesTokenCount ?? 0,
    model,
  };
}

export async function generateBriefing(input: {
  student: Student; calls: Call[]; emi: Emi[];
}): Promise<{ briefing_md: string; model: string; tokens_in: number; tokens_out: number; provider: string }> {
  const { aiProvider, aiApiKey, anthropic } = await getRuntimeSettings();

  const provider: Provider = (aiProvider as Provider) || 'anthropic';
  const effectiveKey = aiApiKey || (provider === 'anthropic' ? anthropic : undefined);
  const cfg = PROVIDER_CFG[provider];

  if (!effectiveKey) {
    return {
      briefing_md: [
        '## Story',
        `_AI briefing is unavailable — pick an AI provider in **Settings → AI assistant** and save its API key._`,
        '',
        '## Ongoing threads',
        input.calls.length === 0
          ? '_No calls logged yet._'
          : `${input.calls.length} call(s) on file. View the timeline below.`,
        '',
        '## Open actions',
        '_Configure AI to surface open actions automatically._',
        '',
      ].join('\n'),
      model: 'stub', tokens_in: 0, tokens_out: 0, provider,
    };
  }

  const context = buildContext(input.student, input.calls, input.emi);

  try {
    let result;
    switch (provider) {
      case 'anthropic':
        result = await callAnthropic(effectiveKey, cfg.model, BRIEFING_SYSTEM_PROMPT, context);
        break;
      case 'google':
        result = await callGoogle(effectiveKey, cfg.model, BRIEFING_SYSTEM_PROMPT, context);
        break;
      case 'vertex':
        result = await callVertex(effectiveKey, cfg.model, BRIEFING_SYSTEM_PROMPT, context);
        break;
      case 'openrouter':
        result = await callOpenAICompatible(cfg.endpoint, cfg.model, effectiveKey, BRIEFING_SYSTEM_PROMPT, context, {
          'HTTP-Referer': 'https://dipti-dashboard.vercel.app',
          'X-Title': 'DVA Operations Dashboard',
        });
        break;
      case 'openai':
      case 'groq':
      default:
        result = await callOpenAICompatible(cfg.endpoint, cfg.model, effectiveKey, BRIEFING_SYSTEM_PROMPT, context);
        break;
    }

    if (!result.text || !result.text.trim()) {
      return {
        briefing_md: '## Story\n_AI returned an empty response. Try clicking 🔄 to regenerate, or switch providers in Settings._',
        model: `${result.model}:empty`, tokens_in: result.in, tokens_out: result.out, provider,
      };
    }

    return {
      briefing_md: result.text,
      model: result.model,
      tokens_in: result.in,
      tokens_out: result.out,
      provider,
    };
  } catch (e: any) {
    return {
      briefing_md: [
        '## Story',
        `_AI briefing failed: ${(e?.message ?? 'unknown error').slice(0, 300)}_`,
        '',
        '_Click 🔄 to retry, or pick a different provider in Settings._',
      ].join('\n'),
      model: `${provider}:error`, tokens_in: 0, tokens_out: 0, provider,
    };
  }
}