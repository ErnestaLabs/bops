# Optional Vercel Labs Agent Desktop (Mac)

Bops can now attach the **read-only** portion of [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) to an agent task running on the owner's Mac. It uses the operating system accessibility tree; it is **not** a replacement for the existing Cua Driver guard.

## Setup

1. On the Mac, install the external CLI: `npm install -g agent-desktop`.
2. Run `agent-desktop status` and `agent-desktop permissions --guide` to inspect/grant macOS Accessibility permission. The operating system grant is a user action.
3. Start Bops with `BOPS_MAC_UI_PROVIDER=agent-desktop`. If the packaged Electron app cannot find the CLI in its `PATH`, also supply `BOPS_AGENT_DESKTOP_PATH=/absolute/path/to/agent-desktop`.
4. Explicitly enable **Settings → This Mac → Full access** in Bops if you want a task to use the Mac's tools.
5. Start a **new** Mac task/session after changing the provider; an existing agent session retains the tools with which it was created.

With the provider unset, the existing Cua Driver path is unchanged.

## Exposed tools

Only `desktop_snapshot`, `desktop_find`, `desktop_get`, and `desktop_is` are exposed to the Bops agent through its MCP tool allowlist. This integration does **not** grant `desktop_click`, `desktop_type`, clipboard, screenshot, application launch, window management, or other desktop actions. It does not install or run anything on cloud machines.

**Privacy:** These observation tools can read sensitive window content. Bops exposes them only after the owner's Full access setting is enabled; the provider itself must be separately selected. Never include private snapshots in issue reports or public logs. Do not use it to read Bops, system settings, Keychain, password managers, terminals or other protected applications. Bops' task prompts prohibit these, but the upstream MCP server is **not** an app-level security boundary and the Full access executor already has a shell. Treat Full access as a highly privileged opt-in.

The existing Cua Driver integration continues to supply guarded background interactions when selected. Broad desktop input via Agent Desktop would require a Bops-owned policy enforcement proxy, app allowlisting and action approvals before enabling additional MCP tools.

## Verification

- With `BOPS_MAC_UI_PROVIDER` unset, confirm Cua Driver still appears for Full access tasks.
- With `BOPS_MAC_UI_PROVIDER=agent-desktop` and the CLI installed, confirm a newly created Full access task can snapshot a benign native app by name and only sees the four observation tools.
- Confirm no desktop tools are exposed without Full access, and a missing CLI does not expose a broken provider.
- Inspect the agent session's `ui` provider tag: changing providers must create a fresh session.
- Native macOS permissions and agent behavior require on-device verification; repository edits alone cannot verify them.

Upstream: Apache-2.0. No upstream code is copied or bundled in this change.
