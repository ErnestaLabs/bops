# Private browser web access

The optional egress service removes the need for Orgo-hosted browsers or a paid
browser provider. The existing Chromium computer remains on the customer's Docker
host. Only owner-approved websites become reachable. This does not change the fact
that the selected hosted inference provider receives prompts and observations.

## Enable deliberately

Keep the default `BOPS_WORKER_NETWORK=none` for offline work. For web tasks, use a
Linux Docker daemon supporting the bridge `gateway_mode_ipv4=isolated` option,
Docker Compose v2, and rebuild the worker image with the current source first.
The operator runs these commands on the customer server; the application never
creates a network, publishes a proxy port or changes host firewall rules itself.

Create `.env.egress` (ignored by Git) with mode 0600 and the following example:

```dotenv
BOPS_EGRESS_NETWORK=ernesta-customer-web
BOPS_EGRESS_ALLOW_HOSTS=example.com
```

The allowlist is **exact hostnames**, comma-separated. There are no wildcards or
implicit subdomains. Add required login, CDN and API hosts deliberately. Do not put
passwords, tokens, URLs, paths or model-provider credentials in this file. Use a
unique Compose project and worker network for each separate customer deployment.

```sh
chmod 600 .env.egress
docker build -f private-runtime/worker/Dockerfile -t ernesta-bops-worker:private .
docker compose --env-file .env.egress -p ernesta-customer-web \
  -f private-runtime/egress/compose.yaml up -d --build --wait
```

Set these in the application's `.env.private`, then restart the application:

```dotenv
BOPS_WORKER_NETWORK=ernesta-customer-web
BOPS_WORKER_PROXY=http://bops-egress:3128
```

```sh
export BOPS_PRIVATE_ENV_FILE="$PWD/.env.private"
npm run private:check -- --require-web
npm start
```

New computers receive only proxy configuration, never application or inference
secrets. Existing computers are **not** silently reconfigured, recreated or deleted.
Create a fresh computer to adopt this networking mode; retain existing work volumes.
Test an approved public-page task before using customer accounts. Preflight validates
topology and health, not the site's availability or a model's reliability.

To change allowed hosts, edit `.env.egress` and rerun the same Compose command.
No application rebuild is needed for an allowlist change. To stop outbound browsing,
stop only the named egress project. Its loss fails closed; there is no direct fallback.

```sh
docker compose --env-file .env.egress -p ernesta-customer-web \
  -f private-runtime/egress/compose.yaml stop
```

## Controls and limits

Workers join only an internal IPv4 Docker bridge with no host gateway address. The
proxy joins that bridge and a dedicated outbound network. No proxy port is published.
Before provisioning a proxied computer, the server requires the labelled isolated
network and exactly one healthy labelled proxy without published host ports.

The proxy permits HTTP on port 80 and CONNECT on port 443 to approved public IPv4
hostnames. Each request resolves DNS anew, rejects any private/special-use answer,
and connects to the checked numeric address without a second DNS resolution.
Loopback, cloud metadata, private ranges, IPv6, arbitrary ports, unapproved hosts
and the existing Orgo/OpenAI/xAI blocked destinations are rejected. Workers use a
non-forwarding DNS configuration; only Docker service discovery is required.

Chrome explicitly uses the proxy. Shell programs which honor HTTP(S)_PROXY use it
too. Programs that ignore proxy settings have no direct internet route. Hostname
redirects and third-party assets need their own allowlist entries. The proxy does not
rewrite page content, log URLs or credentials, or intercept HTTPS certificates.
Ordinary site credentials/cookies still go to the approved destination normally.

This is **not** a content filter, read-only web mode, VM isolation or a guarantee
against exfiltration to an approved site. A user may POST data to an allowed site;
an HTTPS tunnel carries opaque traffic to that host's port 443. Deploy each customer
separately. Workers on the same customer network can reach one another, and Docker
administrators can change networking. Approved services with their own proxy/relay
features may route data further. Audit permitted domains accordingly. TLS remains
end-to-end and is verified by the browser/client, not by this forward proxy.

Connections have idle/lifetime and concurrency limits; HTTP request and response
bodies are bounded. Very large uploads/downloads and long-lived connections may
need a different explicitly approved gateway. IPv6-only websites are unsupported.
Failure to resolve or reach a website never triggers another provider or route.

## Verification

Unit tests exercise hostname/port parsing, private IP and mixed-DNS rejection,
DNS rebinding, pinned HTTP connections, credential-header stripping, CONNECT,
worker arguments and fail-closed topology validation. `egress-smoke.mjs` provisions
a unique temporary Compose project, visits the real public `https://example.com`
from shell and visible Chromium, checks forbidden destinations/direct bypass/DNS
and proxy outage, and removes only its own test resources. No model is involved.
The CI artifact `egress-result.json` records the result; the existence of the test
alone is not a passing result. Customer deployments still require their own check.

Design references: Docker bridge internal/isolated gateway modes and Chromium
manual proxy configuration. Keep the original repository license and notices.
