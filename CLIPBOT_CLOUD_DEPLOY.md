# Clipbot cloud bridge deployment

This branch adapts the original OpenCode bridge to use environment-based
configuration. The HTTP contract is unchanged for Clipbot:
`GET /health` is public, and `POST /chat` accepts a JSON `messages`
array, requiring `X-Bridge-Token`, and returns `reply` and `model`.

**A fork does not provide a running AI server.** Deploy this Node.js process
on a host with a persistent service, install the OpenCode CLI and configure
valid provider credentials or a supported API key. The upstream bridge
invokes `opencode api post /api/experimental/generate/text`; check that
your installed OpenCode CLI actually supports this API before deployment.
The source's original primary model may be unavailable or rate limited.
An online answer is not guaranteed without a working provider.

## Required host settings

- Node.js 18 or newer
- OpenCode CLI executable on PATH (or set `OPENCODE_EXE`)
- `BRIDGE_TOKEN`: unique random string, at least 24 characters; **never**
  commit it or expose it in screenshots
- `PORT`: provided by host or `8787`
- `OPENCODE_PROVIDER_ID`: defaults to `opencode`
- `OPENCODE_MODEL_ID`: defaults to `deepseek-v4.1-flash-free`
- `DISABLE_LOCAL_FALLBACK=1` on cloud hosts without Ollama

Set these in your hosting provider's secret environment settings.
The bridge now runs even if `bridge/config.json` is absent; if supplied,
that file remains a local optional configuration. Never deploy a public
endpoint with the example token.

### Startup command

```sh
node bridge/server.js
```

The host must provide HTTPS at its public domain (reverse proxy, TLS
termination or equivalent). The app itself listens via plain HTTP on
`0.0.0.0:$PORT`. Configure health checks at `/health`.

### Tests

```sh
curl https://YOUR_HOST/health
curl -H "X-Bridge-Token: YOUR_SECRET" https://YOUR_HOST/diagnostics
curl -X POST https://YOUR_HOST/chat \
  -H "X-Bridge-Token: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"messages":[{"role":"user","content":"Reply with exactly READY"}]}'
```

If `/health` works but `/chat` returns 502, inspect the private
`/diagnostics` endpoint for `lastModelError` and check host logs.
Do not assume the original server's OpenCode provider configuration or
credentials transfer with a GitHub fork. The disabled Ollama fallback does
not run on a cloud host by itself.

### Point Clipbot at your own server

Lucy Settings > Online AI brain:
- Enable AI
- URL: `https://YOUR_HOST` (no `/chat` suffix)
- Token: same `BRIDGE_TOKEN`
- Model: ignored by the Clipbot bridge client; selected server-side

No new ESP32 firmware is required if the currently installed firmware
already supports the OpenCode `POST /chat` protocol.

### Security and limitations

- The bridge still offers `/where` and device registration for the
  original ESP32 project, which are not required for Clipbot AI chat.
  Treat those routes as potentially sensitive and restrict the service
  at the reverse proxy if appropriate.
- A publicly accessible `/chat` still consumes model credits; apply
  provider-specific quotas and hosting-side rate limits.
- Do not expose your ESP32's local `/ota` or `/mcp` endpoints to the public.
- This change does **not** implement spoken answers or TTS.
- Continuous cloud operation requires an always-on hosted runtime,
  internet connectivity, and a working model provider.

## Deploy on Render (Blueprint)

A `render.yaml` and `Dockerfile` are included in this branch. Open
https://dashboard.render.com/blueprints and create a Blueprint from
`Sarjeraoss/opencode-with-lucky` branch `clipbot/cloud-bridge`.

The Blueprint specifies a Docker web service in Singapore, with
`/health` as its health check. The free instance is for experimentation:
it can spin down when inactive and may not be suitable for reliable,
low-latency Clipbot voice interaction. Check Render's current plan
availability/pricing before selecting an instance.

Set the secret `BRIDGE_TOKEN` when prompted by Render. Generate an
unpredictable value of **at least 24 characters** with a password manager.
Never reuse the public example token. This secret must match Lucy's
stored OpenCode bridge token, and must not be put into GitHub.

### AI provider state

The deployment intentionally starts with `PROVIDER_CONFIGURED=false`.
`/health` can return `ok:true` while `/chat` returns HTTP 503 with an
explicit "provider not configured" error. This is intentional; it avoids
hiding the distinction between a healthy bridge and functioning AI.

The Docker image installs the current `@opencode/cli`. The *original*
bridge calls `opencode api post /api/experimental/generate/text`.
OpenCode has changed over time and that experimental API has **not been
validated against the installed CLI**. If a chat returns 502 after
configuration, inspect `/diagnostics` and Render logs. A code update may
be needed to migrate to the current supported OpenCode API.

To enable AI, you need a model/provider account with permitted cloud
access. Configure its credentials as secret environment variables on
Render, using the exact variable names required by that provider and
your installed OpenCode version. Test model access in that environment,
then set `PROVIDER_CONFIGURED=true`. The example model name
`deepseek-v4.1-flash-free` is **not** proof of current free access;
verify its availability on your account. No API key or subscription
is assumed or provided here.

For a hosted deployment without Ollama, keep
`DISABLE_LOCAL_FALLBACK=1`. A local Windows Ollama process is not
available inside a Render container. Select a single hosted model you
are authorized to use.

### Test via Windows PowerShell

After Render gives you a public address, open
`https://YOUR-SERVICE.onrender.com/health`.
Then send a request from PowerShell, entering the token privately:

```powershell
$token = Read-Host "Bridge token"
$body = @{messages=@(@{role="user";content="Reply with exactly READY"})} |
  ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://YOUR-SERVICE.onrender.com/chat" `
  -Method Post -Headers @{"X-Bridge-Token"=$token} `
  -ContentType "application/json" -Body $body -TimeoutSec 120
```

With `PROVIDER_CONFIGURED=false`, expect HTTP 503. After a working
model is configured, expect a JSON response with `reply` and `model`.
Do not point Clipbot at the new bridge until the PowerShell test succeeds.

On Lucy's existing settings page, set its Online AI base URL to the
Render HTTPS address without `/chat`, then enter the same bridge
token. Lucy already implements `POST /chat`; you do not need another
ESP32 upload solely to change the server address.

### Important boundaries

- The Render service and its OpenCode runtime are separate from the
  ESP32 and from the original `chat.blueflutex.in` host.
- This deployment does not implement audio/TTS; Clipbot's speech
  service remains separately configured.
- Only source and deployment files are prepared. You must authorize
  Render access and create the web service yourself.
- The current OpenCode CLI experimental API compatibility and actual
  model responses are not yet end-to-end verified.
