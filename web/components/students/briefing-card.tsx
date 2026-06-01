'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Copy, Info, ChevronUp, ChevronDown } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { cn } from '@/lib/utils';

type State = {
  summary_md: string | null;
  is_stale: boolean;
  source_calls_count: number;
  generated_at: string | null;
  model?: string | null;
  provider?: string | null;
};

function providerLabel(model: string | null | undefined, provider: string | null | undefined): string {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku'))    return 'Claude Haiku';
  if (m.includes('sonnet'))   return 'Claude Sonnet';
  if (m.includes('opus'))     return 'Claude Opus';
  if (m.includes('gpt-4o'))   return 'GPT-4o';
  if (m.includes('gpt-4'))    return 'GPT-4';
  if (m.includes('gemini'))   return 'Gemini';
  if (m.includes('llama'))    return 'Llama 3.3';
  switch ((provider ?? '').toLowerCase()) {
    case 'openai':     return 'OpenAI';
    case 'anthropic':  return 'Claude';
    case 'google':     return 'Gemini';
    case 'groq':       return 'Groq';
    case 'openrouter': return 'OpenRouter';
    default:           return 'AI';
  }
}

export function BriefingCard({ studentId, callsCount }: { studentId: string; callsCount: number }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Auto-regenerates briefing when callsCount changes (new call logged).
  // No more need to navigate away and come back!
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await sb
        .from('student_briefings')
        .select('summary_md, is_stale, source_calls_count, generated_at, model, provider')
        .eq('student_id', studentId)
        .maybeSingle();
      if (cancel) return;

      const briefing = data as State | null;
      const briefingCallsCount = briefing?.source_calls_count ?? -1;

      // Regenerate when:
      //   1. No briefing exists yet
      //   2. Briefing marked stale
      //   3. New calls were logged since the briefing was generated
      const needsRegen =
        !briefing ||
        briefing.is_stale ||
        briefingCallsCount !== callsCount;

      if (needsRegen) {
        regenerate();
      } else {
        setState(briefing);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, callsCount]);

  async function regenerate() {
    setLoading(true);
    try {
      const r = await fetch('/api/briefing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setState({
        summary_md:         d.summary_md,
        is_stale:           false,
        source_calls_count: d.source_calls_count,
        generated_at:       new Date().toISOString(),
        model:              d.model,
        provider:           d.provider,
      });
    } catch (e: any) {
      toast(e.message ?? 'Failed to regenerate', 'error');
    }
    setLoading(false);
  }

  if (callsCount === 0) {
    return (
      <div className="briefing-card rounded-2xl p-5 mb-6 text-[13px] text-ink-500">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-4 h-4 text-accent-600" />
          <span className="font-semibold text-ink-800">AI Briefing</span>
        </div>
        Briefing will appear once the first call is logged.
      </div>
    );
  }

  const poweredBy = providerLabel(state?.model, state?.provider);

  return (
    <div className="briefing-card rounded-2xl p-6 mb-6 relative overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-accent-50 grid place-items-center">
            <Sparkles className="w-[18px] h-[18px] text-accent-600" />
          </div>
          <div>
            <div className="font-semibold text-[14px] tracking-tight">AI Briefing</div>
            <div className="text-[11.5px] text-ink-500">
              {loading
                ? 'Regenerating…'
                : (state?.source_calls_count
                    ? `Based on ${state.source_calls_count} call${state.source_calls_count > 1 ? 's' : ''}`
                    : 'Generating…')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={regenerate} className="h-7 w-7 rounded-md hover:bg-ink-100 grid place-items-center" title="Regenerate">
            <RefreshCw className={cn('w-3.5 h-3.5 text-ink-500', loading && 'animate-spin')} />
          </button>
          <button onClick={() => { navigator.clipboard?.writeText(state?.summary_md ?? ''); toast('Copied'); }} className="h-7 w-7 rounded-md hover:bg-ink-100 grid place-items-center" title="Copy">
            <Copy className="w-3.5 h-3.5 text-ink-500" />
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="h-7 w-7 rounded-md hover:bg-ink-100 grid place-items-center" title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronUp className="w-3.5 h-3.5 text-ink-500" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        loading && !state ? (
          <BriefingSkeleton />
        ) : (
          <>
            <article className="prose-briefing text-[13.5px] leading-relaxed text-ink-800">
              <RenderBriefingMarkdown md={state?.summary_md ?? ''} />
            </article>
            <div className="mt-5 pt-4 border-t border-ink-100/80 flex items-center gap-2 text-[11px] text-ink-400">
              <Info className="w-3.5 h-3.5" />
              AI-generated · verify before quoting · powered by {poweredBy}
            </div>
          </>
        )
      )}
    </div>
  );
}

function BriefingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-2/3" />
      <div className="skeleton h-3 w-5/6" />
      <div className="briefing-divider h-px my-4" />
      <div className="skeleton h-3 w-1/3" />
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-2/3" />
    </div>
  );
}

function RenderBriefingMarkdown({ md }: { md: string }) {
  const blocks: Array<{ type: 'h2' | 'p' | 'ul'; content: string | string[] }> = [];
  let currentList: string[] | null = null;

  md.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentList) { blocks.push({ type: 'ul', content: currentList }); currentList = null; }
      return;
    }
    if (trimmed.startsWith('## ')) {
      if (currentList) { blocks.push({ type: 'ul', content: currentList }); currentList = null; }
      blocks.push({ type: 'h2', content: trimmed.slice(3) });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      currentList ??= [];
      currentList.push(trimmed.slice(2));
    } else {
      if (currentList) { blocks.push({ type: 'ul', content: currentList }); currentList = null; }
      blocks.push({ type: 'p', content: trimmed });
    }
  });
  if (currentList) blocks.push({ type: 'ul', content: currentList });

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === 'h2') {
          return (
            <h3 key={i} className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-500 mt-4 first:mt-0">
              {b.content as string}
            </h3>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="space-y-1.5 list-disc list-inside marker:text-ink-300">
              {(b.content as string[]).map((item, j) => (
                <li key={j} className="text-[13px] text-ink-800 leading-snug">{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="text-[13.5px] text-ink-800 leading-relaxed">{b.content as string}</p>;
      })}
    </div>
  );
}