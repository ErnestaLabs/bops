/** An ordinary client object: feature detection must not throw on property reads.
 * Unsupported provider services fail at invocation, never fall back to a vendor.
 */
import { privateClient, InferenceError } from './inference.mjs';
const unsupported = name => () => {
  throw new InferenceError(`${name} is not implemented by the private runtime. No request sent.`, 'unsupported_capability', 501);
};
export function applicationClient(options) {
  const transport = privateClient(options);
  const responses = transport.responses;
  return {
    get baseURL() { return transport.baseURL; },
    apiKey: transport.apiKey,
    responses: { ...responses, stream: unsupported('Responses SDK event-emitter streaming') },
    beta: { agents: { sessions: {
      create: unsupported('Legacy agent sessions'),
      retrieve: unsupported('Legacy agent session lookup'),
      events: { create: unsupported('Legacy agent events'), stream: unsupported('Legacy agent event streams') },
      turns: { create: unsupported('Legacy agent turns'), cancel: unsupported('Legacy agent cancellation') },
      items: { list: unsupported('Legacy agent items') },
      subagents: { list: unsupported('Legacy subagents'), items: { list: unsupported('Legacy subagent items') } },
    } } },
    live: { create: unsupported('Realtime voice'), sessions: { accept: unsupported('Voice calls'), reject: unsupported('Voice calls') } },
    audio: { transcriptions: { create: unsupported('Audio transcription') } },
    images: { generate: unsupported('Image generation'), edit: unsupported('Image editing') },
  };
}
