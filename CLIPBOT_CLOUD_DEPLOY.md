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
