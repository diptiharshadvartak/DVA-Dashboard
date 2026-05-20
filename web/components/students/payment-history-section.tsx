'use client';

import { useEffect, useMemo, useState } from 'react';
import { 
  CheckCircle2, XCircle, Link as LinkIcon, AlertTriangle, 
  Clock, ChevronDown, ChevronRight, Receipt 
} from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fmtINR, fmtDate } from '@/lib/utils';

type CashfreeEvent = {
  id: number;
  event_type: string;
  cashfree_link_id: string | null;
  emi_id: string | null;
  payload: any;
  error: string | null;
  created_at: string;
};

export function PaymentHistorySection({ studentId }: { studentId: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [events, setEvents] = useState<CashfreeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await sb
        .from('cashfree_events')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(50);
      setEvents((data ?? []) as CashfreeEvent[]);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [studentId, sb]);

  if (loading) return null;
  if (events.length === 0) return null;

  const successCount = events.filter(e => e.event_type === 'payment_success').length;
  const linkCount = events.filter(e => e.event_type === 'link_created').length;
  const errorCount = events.filter(e => 
    e.event_type === 'link_create_failed' || 
    e.event_type === 'webhook_invalid_signature' ||
    e.event_type === 'payment_failed'
  ).length;

  const displayEvents = expanded ? events : events.slice(0, 5);
  
  // Helper to extract payment ID from event payload
  function getPaymentId(event: CashfreeEvent): string | null {
    if (!event.payload) return null;
    const p = event.payload as any;
    // Cashfree webhook structure: data.payment.cf_payment_id
    return p?.data?.payment?.cf_payment_id?.toString()
      || p?.data?.payment?.payment_id
      || p?.cf_payment_id
      || p?.payment_id
      || null;
  }
  
  // Helper to extract payment method/mode from payload
  function getPaymentMethod(event: CashfreeEvent): string | null {
    if (!event.payload) return null;
    const p = event.payload as any;
    return p?.data?.payment?.payment_method?.card?.card_network
      || p?.data?.payment?.payment_method?.upi?.upi_id  
      || p?.data?.payment?.payment_group
      || null;
  }
  
  // Helper to extract amount from payload
  function getPaymentAmount(event: CashfreeEvent): number | null {
    if (!event.payload) return null;
    const p = event.payload as any;
    return p?.data?.payment?.payment_amount || p?.payment_amount || null;
  }

  return (
    <div className="bg-white border border-ink-200/70 rounded-xl mt-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-ink-50/50 transition rounded-xl"
      >
        <div className="w-8 h-8 rounded-lg bg-ink-100 text-ink-700 grid place-items-center shrink-0">
          <Receipt className="w-4 h-4" />
        </div>
        <div className="flex-1 text-left">
          <div className="font-semibold text-[13.5px]">Payment History</div>
          <div className="text-[11.5px] text-ink-500">
            {events.length} events · {successCount} successful payment{successCount !== 1 ? 's' : ''}
            {linkCount > 0 && ` · ${linkCount} link${linkCount > 1 ? 's' : ''} generated`}
            {errorCount > 0 && ` · ${errorCount} error${errorCount > 1 ? 's' : ''}`}
          </div>
        </div>
        <span className="text-[10.5px] uppercase tracking-wider font-medium text-ink-400 px-2 py-1 bg-ink-50 rounded">
          Read-only · cannot be deleted
        </span>
        {expanded ? <ChevronDown className="w-4 h-4 text-ink-500" /> : <ChevronRight className="w-4 h-4 text-ink-500" />}
      </button>

      {expanded && (
        <div className="border-t border-ink-100">
          {displayEvents.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {!expanded && events.length > 5 && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full px-4 py-2.5 text-[12px] text-accent-700 hover:bg-accent-50/40 font-medium border-t border-ink-100"
            >
              Show all {events.length} events →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: CashfreeEvent }) {
  const { icon, label, tone, detail } = describeEvent(event);
  
  return (
    <div className="px-4 py-3 flex items-start gap-3 border-b border-ink-100 last:border-0 hover:bg-ink-50/30 transition">
      <div className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5 ${tone.bg} ${tone.text}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[12.5px] text-ink-900">{label}</span>
          <span className="text-[11px] text-ink-500">
            {new Date(event.created_at).toLocaleString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
        {detail && (
          <div className="text-[11.5px] text-ink-600 mt-0.5 leading-relaxed">
            {detail}
          </div>
        )}
        {event.error && (
          <div className="text-[11px] text-rose-700 mt-1 font-mono break-all">
            Error: {event.error}
          </div>
        )}
        {event.cashfree_link_id && (
          <div className="text-[10.5px] text-ink-400 mt-1 font-mono break-all">
            Link ID: {event.cashfree_link_id}
          </div>
        )}
        {(() => {
          const pid = event.payload?.data?.payment?.cf_payment_id 
                   ?? event.payload?.data?.payment?.payment_id
                   ?? event.payload?.cf_payment_id
                   ?? event.payload?.payment_id;
          const ref = event.payload?.data?.payment?.bank_reference;
          return (
            <>
              {pid && (
                <div className="text-[10.5px] text-emerald-700 mt-1 font-mono break-all">
                  Payment ID: {pid}
                </div>
              )}
              {ref && (
                <div className="text-[10.5px] text-ink-400 mt-0.5 font-mono break-all">
                  Bank Ref: {ref}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function describeEvent(event: CashfreeEvent): {
  icon: React.ReactNode;
  label: string;
  tone: { bg: string; text: string };
  detail: string | null;
} {
  const payload = event.payload ?? {};
  
  switch (event.event_type) {
    case 'payment_success': {
      const amount = payload.amount ?? payload.data?.payment?.payment_amount;
      const method = payload.data?.payment?.payment_method ?? payload.method;
      const ref = payload.data?.payment?.cf_payment_id ?? payload.data?.payment?.bank_reference;
      const methodName = typeof method === 'object' 
        ? Object.keys(method)[0]?.toUpperCase() 
        : method;
      return {
        icon: <CheckCircle2 className="w-4 h-4" />,
        label: 'Payment Received',
        tone: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
        detail: [
          amount ? fmtINR(Number(amount)) : null,
          methodName ? `via ${methodName}` : null,
          ref ? `Ref: ${ref}` : null,
        ].filter(Boolean).join(' · '),
      };
    }
    
    case 'link_created': {
      const amount = payload.amount;
      const linkUrl = payload.link_url;
      return {
        icon: <LinkIcon className="w-4 h-4" />,
        label: 'Payment Link Created',
        tone: { bg: 'bg-blue-100', text: 'text-blue-700' },
        detail: [
          amount ? fmtINR(Number(amount)) : null,
          linkUrl ? `URL: ${linkUrl.substring(0, 60)}...` : null,
        ].filter(Boolean).join(' · '),
      };
    }
    
    case 'link_create_failed':
      return {
        icon: <XCircle className="w-4 h-4" />,
        label: 'Link Generation Failed',
        tone: { bg: 'bg-rose-100', text: 'text-rose-700' },
        detail: payload.amount ? `Tried to create link for ${fmtINR(Number(payload.amount))}` : null,
      };
    
    case 'webhook_received':
      return {
        icon: <Clock className="w-4 h-4" />,
        label: 'Webhook Received',
        tone: { bg: 'bg-ink-100', text: 'text-ink-700' },
        detail: payload.type ? `Event: ${payload.type}` : null,
      };
    
    case 'webhook_invalid_signature':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        label: 'Webhook Rejected (Invalid Signature)',
        tone: { bg: 'bg-amber-100', text: 'text-amber-700' },
        detail: 'Webhook arrived but signature verification failed',
      };
    
    case 'webhook_unverified':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        label: 'Webhook Processed Without Verification',
        tone: { bg: 'bg-amber-100', text: 'text-amber-700' },
        detail: 'Processed without signature check (webhook secret not configured)',
      };
    
    case 'webhook_no_matching_emi':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        label: 'Webhook for Unknown EMI',
        tone: { bg: 'bg-amber-100', text: 'text-amber-700' },
        detail: 'Webhook received but no matching EMI found',
      };

    case 'payment_failed':
      return {
        icon: <XCircle className="w-4 h-4" />,
        label: 'Payment Failed',
        tone: { bg: 'bg-rose-100', text: 'text-rose-700' },
        detail: payload.amount ? `Failed payment of ${fmtINR(Number(payload.amount))}` : null,
      };
    
    default:
      return {
        icon: <Clock className="w-4 h-4" />,
        label: event.event_type.replace(/_/g, ' '),
        tone: { bg: 'bg-ink-100', text: 'text-ink-700' },
        detail: null,
      };
  }
}