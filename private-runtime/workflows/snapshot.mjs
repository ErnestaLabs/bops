/** Read-only projection. No secrets, prompts, customer names or raw errors. */
export function snapshot(state, env = process.env, now = Date.now()) {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const counts = {};
  for (const s of sessions) counts[s.status] = (counts[s.status] || 0) + 1;
  return {
    mode: 'observed-bops-state', observedAt: new Date(now).toISOString(),
    coverage: 'Bops sessions only; Trigger and Skyvern health have not been probed.',
    privateRuntime: env.BOPS_PRIVATE_RUNTIME === '1',
    integrations: {
      trigger: { configured: !!env.WORKFORCE_TRIGGER_URL, connected: false, verified: false },
      skyvern: { configured: !!env.BOPS_SKYVERN_BASE_URL && !!env.BOPS_SKYVERN_API_KEY, connected: false, verified: false },
      inference: { configured: !!env.BOPS_INFERENCE_BASE_URL && !!env.BOPS_INFERENCE_MODEL, verified: false },
    },
    counts,
    runs: sessions.slice(-100).reverse().map(s => ({ id: s.id, botId: s.botId, state: s.status, hasError: !!s.error })),
    truncated: sessions.length > 100,
  };
}
