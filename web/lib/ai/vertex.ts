import crypto from 'crypto';

// Google Vertex AI provider — authenticates with a service-account JSON (the
// file downloaded from Google Cloud), not a simple API key. We mint a short-
// lived OAuth access token from the service account using Node's built-in
// crypto (no extra npm dependency), then call the same Gemini generateContent
// endpoint the other Google path uses, but on the Vertex host.
//
// The whole service-account JSON is stored in ghl_settings.ai_api_key when the
// admin picks the "vertex" provider in Settings.

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

// In-memory access-token cache, keyed by service-account email. Tokens are
// valid ~1h; we refresh a little early. Cleared whenever the process restarts.
const tokenCache = new Map<string, { token: string; exp: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccount(raw: string): ServiceAccount {
  let sa: any;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error('Vertex service-account JSON is not valid JSON — paste the entire downloaded file.');
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('Vertex service-account JSON is missing client_email, private_key, or project_id.');
  }
  // Some pastes escape newlines in the private key — normalise them back.
  if (typeof sa.private_key === 'string') {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  return sa as ServiceAccount;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = now;
  const exp = now + 3600;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri,
    iat,
    exp,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = base64url(
    crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key)
  );
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Vertex auth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const token = data?.access_token;
  if (!token) throw new Error('Vertex auth returned no access_token.');

  tokenCache.set(sa.client_email, { token, exp });
  return token;
}

export async function callVertex(
  saJson: string, model: string, system: string, user: string
): Promise<{ text: string; in: number; out: number; model: string }> {
  const sa = parseServiceAccount(saJson);
  const token = await getAccessToken(sa);

  // Location defaults to the global endpoint, which serves Gemini models without
  // needing a region. Override with VERTEX_LOCATION (e.g. us-central1) if needed.
  const location = process.env.VERTEX_LOCATION?.trim() || 'global';
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${sa.project_id}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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
  if (!res.ok) throw new Error(`Vertex returned ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    const finishReason  = candidate?.finishReason ?? 'unknown';
    const blockedCat    = (candidate?.safetyRatings ?? []).find((r: any) => r.blocked)?.category ?? null;
    const promptBlocked = data?.promptFeedback?.blockReason ?? null;
    throw new Error(
      `Vertex Gemini returned no text (finishReason=${finishReason}` +
      (blockedCat ? `, blocked=${blockedCat}` : '') +
      (promptBlocked ? `, prompt_blocked=${promptBlocked}` : '') + ')'
    );
  }
  return {
    text,
    in:    data?.usageMetadata?.promptTokenCount     ?? 0,
    out:   data?.usageMetadata?.candidatesTokenCount ?? 0,
    model,
  };
}
