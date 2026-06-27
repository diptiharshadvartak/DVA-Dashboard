import { supabaseAdmin } from '@/lib/supabase/admin';

// Cached runtime settings — reads from ghl_settings table first, falls back
// to environment variables. Cache TTL avoids hammering the DB on every call.
let cache: {
  token?: string;
  openai?: string;
  anthropic?: string;
  locationId?: string;
  aiProvider?: 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter' | 'vertex';
  aiApiKey?: string;
  at: number;
} | null = null;

const TTL_MS = 60_000;

export async function getRuntimeSettings() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;

  let row: any = null;
  try {
    const { data } = await supabaseAdmin()
      .from('ghl_settings')
      .select('location_id, ghl_pit_token, openai_api_key, anthropic_api_key, ai_provider, ai_api_key')
      .eq('id', 1)
      .maybeSingle();
    row = data;
  } catch {
    /* DB unreachable — fall through to env vars */
  }

  cache = {
    token:      row?.ghl_pit_token     || process.env.GHL_PIT_TOKEN     || undefined,
    openai:     row?.openai_api_key    || process.env.OPENAI_API_KEY    || undefined,
    anthropic:  row?.anthropic_api_key || process.env.ANTHROPIC_API_KEY || undefined,
    locationId: row?.location_id       || process.env.GHL_LOCATION_ID   || undefined,
    aiProvider: (row?.ai_provider as any) || (process.env.AI_PROVIDER as any) || 'anthropic',
    aiApiKey:   row?.ai_api_key        || process.env.AI_API_KEY        || undefined,
    at: Date.now(),
  };
  return cache;
}

export function clearSettingsCache() { cache = null; }