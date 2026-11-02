/** Opt-in CI diagnostics. No inspector port, locals, arguments, or exception values.
 * Capture only TypeError stack locations for the deterministic application fixture.
 */
import { Session } from 'node:inspector';
const debuggerSession = new Session();
debuggerSession.connect();
const scripts = new Map();
debuggerSession.on('Debugger.scriptParsed', ({ params }) => scripts.set(params.scriptId, params.url));
debuggerSession.on('Debugger.paused', ({ params }) => {
  try {
    if (params.reason === 'exception' && params.data?.className === 'TypeError') {
      const stack = params.callFrames.slice(0, 8).map(frame => ({
        function: frame.functionName,
        url: scripts.get(frame.location.scriptId) || frame.url,
        line: frame.location.lineNumber + 1,
        column: frame.location.columnNumber + 1,
      }));
      console.error('[private-task-typeerror]', JSON.stringify(stack));
    }
  } finally { debuggerSession.post('Debugger.resume'); }
});
debuggerSession.post('Debugger.enable');
debuggerSession.post('Debugger.setPauseOnExceptions', { state: 'all' });
