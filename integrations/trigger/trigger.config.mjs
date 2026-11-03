import { defineConfig } from '@trigger.dev/sdk';
const project = process.env.WORKFORCE_TRIGGER_PROJECT;
const origin = process.env.TRIGGER_API_URL;
if (!project || !origin) throw new Error('Configure the customer-owned Trigger project and TRIGGER_API_URL. No cloud default is allowed.');
const url = new URL(origin);
if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', 'trigger', 'trigger-webapp'].includes(url.hostname)) || url.hostname === 'trigger.dev' || url.hostname.endsWith('.trigger.dev') || url.username || url.password || url.search || url.hash) throw new Error('Customer-owned Trigger endpoint required');
export default defineConfig({
  project, runtime: 'node', dirs: ['./tasks'], maxDuration: 60,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
