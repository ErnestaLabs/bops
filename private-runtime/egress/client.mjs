/** Fail-closed opt-in for the bundled, customer-owned egress network. */
export const WORKER_PROXY = 'http://bops-egress:3128';
export function proxyConfiguration(env) {
  if (!env.BOPS_WORKER_PROXY) return null;
  if (env.BOPS_WORKER_PROXY !== WORKER_PROXY) throw new Error('Use the bundled private egress proxy address.');
  const network = env.BOPS_WORKER_NETWORK;
  if (!network || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(network) || ['none', 'host', 'bridge', 'container'].includes(network)) throw new Error('Private egress requires a dedicated internal network.');
  return { network, url: WORKER_PROXY };
}
export function validateNetwork(info) {
  if (!info?.Internal || info.Driver !== 'bridge' || info.Labels?.['ernesta.egress'] !== 'true' || info.Options?.['com.docker.network.bridge.gateway_mode_ipv4'] !== 'isolated' || info.EnableIPv6) throw new Error('Worker network must be the labelled IPv4 isolated internal bridge.');
}
export async function proxyTopology(env, exec) {
  const config = proxyConfiguration(env);
  if (!config) return null;
  const network = JSON.parse(String(await exec(['network', 'inspect', config.network])))[0];
  validateNetwork(network);
  const ids = Object.keys(network.Containers || {});
  if (!ids.length || ids.length > 512) throw new Error('Private egress service is not ready.');
  // Inspect metadata only, without executing a command or changing infrastructure.
  const entries = JSON.parse(String(await exec(['inspect', '--type', 'container', ...ids])));
  const proxies = entries.filter(c => c.Config?.Labels?.['ernesta.egress'] === 'true' && c.NetworkSettings?.Networks?.[config.network]?.Aliases?.includes('bops-egress'));
  if (proxies.length !== 1 || !proxies[0].State?.Running || proxies[0].State?.Health?.Status !== 'healthy') throw new Error('Exactly one healthy private egress service is required.');
  const proxy = proxies[0];
  if (Object.values(proxy.HostConfig?.PortBindings || {}).some(v => v?.length)) throw new Error('The egress proxy must not publish host ports.');
  return { ...config, proxyId: proxy.Id };
}
