/** A local stand-in for the Skyvern API, for exercising the dispatch and
 * verification path without a Skyvern deployment.
 *
 * It is NOT Skyvern and it does not make a live result real. It implements only
 * the documented wire subset the adapter uses, it marks every response with
 * `x-bops-stand-in: true`, and it answers `GET /__standin/health` so a live run
 * can refuse to treat it as a real deployment. Its extraction output is
 * synthetic and says so.
 */
import { createServer } from 'node:http';

const readBody = async req => {
  const chunks = [];
  for await (const chunk of req) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 1048576) throw new Error('too_large'); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

export async function startSkyvernStandIn({ host = '127.0.0.1', port = 0, apiKey = 'stand-in-key' } = {}) {
  const runs = new Map();
  let sequence = 0;
  let dropNextResponse = false;
  let dropUsed = false;
  // Counted here rather than by the caller, because "how many times did this
  // reach the service" is a property of the destination, and it is the number
  // every no-duplicate guarantee is really about.
  const submissions = new Map();
  let total = 0;
  // One-shot faults for the scenarios that need the destination itself to
  // misbehave (a run that parks for a human, a run whose model falls over).
  let nextFault = null;

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-bops-stand-in': 'true' });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    try {
      if (url.pathname === '/__standin/health') return send(res, 200, { standIn: true, service: 'skyvern-wire-stand-in' });
      if (req.headers['x-api-key'] !== apiKey) return send(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/__standin/find') {
        const actionKey = url.searchParams.get('actionKey');
        for (const run of runs.values()) if (run.actionKey === actionKey) return send(res, 200, { run_id: run.run_id, status: run.status });
        return send(res, 404, { error: 'not_found' });
      }

      if (req.method === 'POST' && url.pathname === '/v1/run/workflows') {
        const body = await readBody(req);
        const run = {
          run_id: `wr_standin_${++sequence}`,
          status: 'queued',
          workflow_id: body.workflow_id,
          actionKey: body.run_metadata?.ernesta_action_key ?? null,
          polls: 0,
        };
        // Commit first, then lose the response: the durable record exists but
        // the caller cannot know that. That is the case we must recover from.
        runs.set(run.run_id, run);
        total += 1;
        submissions.set(run.actionKey, (submissions.get(run.actionKey) ?? 0) + 1);
        if (nextFault) {
          const fault = nextFault; nextFault = null;
          // 'pause' stands in for an MFA / 2FA challenge: the run is alive and
          // waiting for a human, not failed and not resumable by resubmission.
          if (fault === 'pause') run.status = 'paused';
          // 'fail' stands in for an inference outage during the run.
          if (fault === 'fail') run.status = 'failed';
        }
        if (dropNextResponse && !dropUsed) {
          dropUsed = true;
          req.socket.destroy();
          return undefined;
        }
        return send(res, 200, { run_id: run.run_id, status: run.status });
      }

      const match = url.pathname.match(/^\/v1\/runs\/([^/]+)(\/cancel)?$/);
      if (match && runs.has(match[1])) {
        const run = runs.get(match[1]);
        if (req.method === 'POST' && match[2]) { run.status = 'canceled'; return send(res, 200, { run_id: run.run_id, status: run.status }); }
        if (req.method === 'GET') {
          if (run.status === 'queued') run.status = 'running';
          else if (run.status === 'running' && ++run.polls > 0 && run.status !== 'canceled') {
            run.status = 'completed';
            // Deliberately labelled: this is stand-in output, not a real read.
            run.output = { title: 'Example Domain (stand-in output)', stand_in: true };
          }
          const payload = { run_id: run.run_id, workflow_id: run.workflow_id, status: run.status };
          if (run.output) payload.output = run.output;
          return send(res, 200, payload);
        }
      }
      return send(res, 404, { error: 'not_found' });
    } catch {
      if (!res.headersSent) send(res, 400, { error: 'bad_request' });
      return undefined;
    }
  });

  await new Promise(resolve => server.listen(port, host, resolve));
  return {
    url: `http://${host}:${server.address().port}`,
    apiKey,
    /** The next submission commits, then the connection is destroyed. */
    loseNextResponse() { dropNextResponse = true; dropUsed = false; },
    get lostResponseWasUsed() { return dropUsed; },
    /** Arm a one-shot destination-side fault: 'pause' (needs a human) or 'fail'. */
    armFault(kind) {
      if (!['pause', 'fail'].includes(kind)) throw new Error('unknown_fault');
      nextFault = kind;
    },
    /** The owner cleared the challenge; the parked run may continue. */
    clearPause() {
      let cleared = 0;
      for (const run of runs.values()) if (run.status === 'paused') { run.status = 'running'; cleared += 1; }
      return cleared;
    },
    /** How many submissions reached this destination for an action. */
    submissionsFor(actionKey) { return submissions.get(actionKey) ?? 0; },
    get submissionCount() { return total; },
    runCountFor(actionKey) { let n = 0; for (const run of runs.values()) if (run.actionKey === actionKey) n += 1; return n; },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
