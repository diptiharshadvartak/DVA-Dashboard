-- DVA Dashboard — add Google Vertex AI as an allowed AI provider.
--
-- The AI provider for summaries/briefings is stored in ghl_settings.ai_provider
-- and is guarded by a CHECK constraint. This widens that constraint to also
-- accept 'vertex'. The Vertex service-account JSON itself reuses the existing
-- ai_api_key column — no new columns or view changes are needed.
--
-- Purely additive: the existing providers are unaffected.

alter table public.ghl_settings
  drop constraint if exists ghl_settings_ai_provider_check;

alter table public.ghl_settings
  add constraint ghl_settings_ai_provider_check
  check (ai_provider = any (array[
    'openai'::text, 'anthropic'::text, 'google'::text,
    'groq'::text, 'openrouter'::text, 'vertex'::text
  ]));
