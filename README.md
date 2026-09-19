# openclaw-nous-portal-free

Run [Nous Portal](https://portal.nousresearch.com)'s **free-tier models** inside [OpenClaw](https://openclaw.ai) — **no funded API key required**.

The Portal's free tier is normally only reachable from inside Hermes's own
subscription client. This plugin takes the same credential route the Portal's
first-party client uses (OAuth **device-code** login with the free-tier client
id) and exposes the result to OpenClaw as an ordinary keyless,
OpenAI-compatible local endpoint — the same shape OpenClaw already uses for
Ollama and other self-hosted backends.

```
┌────────────┐   OpenAI-compat   ┌───────────────────┐  Bearer invoke-JWT  ┌────────────────────────────┐
│  OpenClaw  │ ─────────────────▶│ loopback proxy    │ ───────────────────▶│ inference-api.nousresearch │
│ (provider) │  127.0.0.1:18791  │ (JWT refresh,     │                     │ .com/v1  (free $0 models)  │
└────────────┘                    │  token rotation) │                     └────────────────────────────┘
                                  └───────────────────┘
```

## Features

- **Zero-cost**: models priced at `$0` (both directions). The free pool
  rotates as Portal promotions come and go; membership is derived live, never
  hardcoded.
- **Keyless for OpenClaw**: OpenClaw configures `nous-portal-free` with a
  base URL only. The proxy owns the OAuth grant and mints/refreshes the
  short-lived invoke JWTs; the Portal rotates refresh tokens and revokes the
  session on reuse, which the proxy handles with atomic credential writes.
- **Live free-catalog discovery**: OpenClaw's model discovery refreshes from
  the proxy's `/models` endpoint (free-filtered), with a checked-in snapshot
  as fallback.
- **Loopback only**: the proxy binds `127.0.0.1` and is not a network
  service. Client credentials are never forwarded upstream.

## Prerequisites

- Node.js ≥ 22.12 (for the proxy and CLI)
- OpenClaw ≥ 2026.9.1
- A Nous account on the **Free** plan. No credit card or funded balance is
  needed; the device-code flow uses the Portal's first-party client id.

## Install

```sh
openclaw plugins install ./openclaw-nous-portal-free   # local path
# or: npm i -g openclaw-nous-portal-free (after publishing)
openclaw gateway restart
```

The provider `nous-portal-free` is registered automatically.

## Sign in (device code)

```sh
nous-portal-free login
```

Open the printed URL in a browser and approve (the free plan is enough).
The CLI stores the refresh grant at
`~/.openclaw/nous-portal-free/credentials.json` (mode 600).

## Run the proxy

```sh
nous-portal-free daemon          # foreground (or your service manager)
```

Systemd unit example:

```ini
[Unit]
Description=Nous Portal free-tier loopback proxy
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/openclaw-nous-portal-free/dist/proxy.js
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

Check status:

```sh
nous-portal-free status
curl -s http://127.0.0.1:18791/healthz
```

## Use in OpenClaw

The provider appears as `nous-portal-free` with a default alias
`Nous Portal Free` (currently resolves to `meituan/longcat-2.0:free`,
1M-context, tool-calling). Add models to your failover chain, e.g.:

```json5
{
  agents: {
    defaults: {
      model: {
        // ... your primary ...
        fallbacks: [
          "nous-portal-free/meituan/longcat-2.0:free",
          "nous-portal-free/upstage/solar-pro4:free",
        ],
      },
    },
  },
}
```

Browse / refresh the live free catalog:

```sh
openclaw models refresh
openclaw models list --all --provider nous-portal-free
nous-portal-free refresh-models   # print the free set as JSON
```

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOUS_PORTAL_FREE_PORT` | `18791` | proxy port (loopback) |
| `NOUS_PORTAL_FREE_PROXY_URL` | `http://127.0.0.1:18791/v1` | base URL OpenClaw should use |
| `NOUS_PORTAL_FREE_CRED_FILE` | `~/.openclaw/nous-portal-free/credentials.json` | grant store |
| `NOUS_PORTAL_FREE_CRED_DIR` | `~/.openclaw/nous-portal-free` | credential directory |

## Notes & caveats

- The free pool is promotional and rotates; models may appear or disappear
  at any time. Discovery keeps OpenClaw in sync; the checked-in snapshot in
  [`src/fallback-catalog.ts`](src/fallback-catalog.ts) is only for outages.
- The Portal rotates the refresh token on every refresh and revokes the whole
  session if a rotated token is replayed. Keep exactly **one** proxy process
  alive per credential file (the typical setup: one service, one host).
- `hermes-cli` client id is the Portal's first-party identifier; the free
  tier gates on it. If Nous changes that policy, sign-in will fail until the
  constant is updated.
- Signing in is interactive and requires a browser on any machine; the proxy
  itself only talks to the two Nous endpoints (portal token API + inference
  API). No telemetry, no other network endpoints.

## Upstream

Ported from [jiesou/dsh-nous-portal-free-provider](https://github.com/jiesou/dsh-nous-portal-free-provider)
(MIT) — OAuth transport and free-catalog discovery — with a
[openclaw-nous-portal](https://github.com/jason-allen-oneal/openclaw-nous-portal)-style
OpenClaw provider skeleton.

## License

MIT — see [LICENSE](LICENSE).
