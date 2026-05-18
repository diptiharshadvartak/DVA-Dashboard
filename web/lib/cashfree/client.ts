// Cashfree Payment Links API client
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/payment-links

import crypto from 'crypto';

export class CashfreeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type CashfreeConfig = {
  appId: string;
  secretKey: string;
  env: 'sandbox' | 'production';
};

function getBaseUrl(env: 'sandbox' | 'production'): string {
  return env === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

type CreateLinkArgs = {
  linkId: string;           // unique on our side, e.g. "EMI_<emiId>"
  amount: number;           // in INR
  purpose: string;          // shown to customer
  customerName: string;
  customerPhone: string;    // E.164 format: +919876543210
  customerEmail?: string;
  expiryDate?: string;      // ISO date when link expires
  notifyUrl?: string;       // webhook URL to receive payment events
};

export type CashfreeLink = {
  link_id: string;
  link_url: string;
  link_status: string;      // ACTIVE / PAID / EXPIRED / CANCELLED
  link_amount: number;
  link_created_at: string;
};

export async function createPaymentLink(
  cfg: CashfreeConfig,
  args: CreateLinkArgs
): Promise<CashfreeLink> {
  const url = `${getBaseUrl(cfg.env)}/links`;

  const body: any = {
    link_id: args.linkId,
    link_amount: args.amount,
    link_currency: 'INR',
    link_purpose: args.purpose.substring(0, 500),  // Cashfree max
    customer_details: {
      customer_name: args.customerName,
      customer_phone: args.customerPhone,
      ...(args.customerEmail ? { customer_email: args.customerEmail } : {}),
    },
    link_notify: {
      send_sms: false,
      send_email: false,
    },
    link_partial_payments: false,
  };

  if (args.expiryDate) {
    body.link_expiry_time = args.expiryDate;
  }
  if (args.notifyUrl) {
    body.link_meta = { notify_url: args.notifyUrl };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': cfg.appId,
      'x-client-secret': cfg.secretKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.message ?? `Cashfree API returned ${res.status}`;
    throw new CashfreeError(res.status, msg);
  }

  return data as CashfreeLink;
}

export async function getPaymentLink(
  cfg: CashfreeConfig,
  linkId: string
): Promise<CashfreeLink> {
  const url = `${getBaseUrl(cfg.env)}/links/${encodeURIComponent(linkId)}`;
  const res = await fetch(url, {
    headers: {
      'x-api-version': '2023-08-01',
      'x-client-id': cfg.appId,
      'x-client-secret': cfg.secretKey,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as any)?.message ?? `Cashfree API returned ${res.status}`;
    throw new CashfreeError(res.status, msg);
  }
  return data as CashfreeLink;
}

export async function cancelPaymentLink(
  cfg: CashfreeConfig,
  linkId: string
): Promise<void> {
  const url = `${getBaseUrl(cfg.env)}/links/${encodeURIComponent(linkId)}/cancel`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-version': '2023-08-01',
      'x-client-id': cfg.appId,
      'x-client-secret': cfg.secretKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new CashfreeError(res.status, text || `Cancel failed: ${res.status}`);
  }
}

/**
 * Verifies the signature on a Cashfree webhook payload.
 * Cashfree sends:
 *   - Header `x-webhook-signature`: HMAC-SHA256(timestamp + raw_body, secret) base64
 *   - Header `x-webhook-timestamp`: unix timestamp
 * We need to recompute and compare.
 */
export function verifyWebhookSignature(
  webhookSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(timestamp + rawBody)
    .digest('base64');
  // constant-time compare
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}