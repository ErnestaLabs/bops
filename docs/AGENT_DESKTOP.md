# Agent Desktop integration (experimental)

Bops can use [Vercel Labs Agent Desktop](https://github.com/vercel-labs/agent-desktop) as an **opt-in** native-app accessibility backend on the Mac that runs Bops. It does not replace the default Cua Driver path, Bops' own Chrome browser tools or its cloud computers.

## Installation and explicit setup

Install Agent Desktop on the Mac (for example, `brew install agent-desktop` or `npm install -g agent-desktop`) and follow its official permission guide (`agent-desktop permissions --guide`). Verify `agent-desktop status` before enabling it.

Configure the server environment (with an actual absolute executable path, not a guessed one):

```sh
BOPS_MAC_UI_BACKEND=agent-desktop
BOPS_AGENT_DESKTOP_BIN=/absolute/path/to/agent-desktop
BOPS_AGENT_DESKTOP_APPS=Safari,Notes
```

The owner must separately turn on **Full access** in Bops on their Mac. If the binary or allowlist is absent, Bops does not expose these tools. With no opt-in, the default Cua Driver functionality remains as before.

The Bops MCP proxy advertises only `desktop_snapshot`, `desktop_click`, `desktop_set_value` and `desktop_scroll_to`. Each snapshot requires an explicitly listed app. Actions require refs from an approved prior snapshot; arbitrary commands, keyboard shortcuts, clipboard access, shells, screenshots, logs, other app scopes, session flags and unknown argument keys are refused by the proxy. A new snapshot and read-back is required to confirm the result; no action's success is assumed from a click alone. The initial adapter is intentionally limited.

**Safety limit:** Bops Full access also gives the agent a shell as the signed-in user. The proxy is an additional tool-level guard, *not* an OS security boundary against an untrusted or malicious agent. Do not rely on it to protect sensitive applications from a task that can run arbitrary shell commands. The existing user approval requirements still apply to actions such as sending, purchasing, deleting and changing permissions, and the selected apps must be ones the owner intends to delegate.

## Verification and rollout

Run `node scripts/test-agent-desktop.mjs` to test app allowlists, blocked tool names, snapshot provenance and bounded ref actions without touching the desktop. Also run Bops' existing `node scripts/test-mac-ui.mjs` (macOS) and type checks, then perform real local device QA with a non-sensitive approved app, followed by app window changes and permission denial. This is an implementation proposal, not a tested or activated production integration.

Do not use this backend on a customer host until the deployed Agent Desktop binary is pinned, native permissions are granted, the service identity is confirmed and the existing approval/Full-access boundaries are independently verified. No remote deployment, new credentials or customer configuration is included.
