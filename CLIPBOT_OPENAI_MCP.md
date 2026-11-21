# Clipbot OpenAI + MCP server on Render

This branch provides a new Node.js 22 server independent of OpenCode CLI.
The AI model is called via OpenAI's Responses API. It does **not** use
ChatGPT subscription access; API billing and a valid OpenAI project key
are required. No API key is committed to GitHub.

## Architecture

- `POST /chat`: Existing Clipbot Lucy OS interface; `X-Bridge-Token`,
  JSON `messages` array, JSON `reply` and `model`.
- `GET /health`: public liveness only; `providerConfigured` indicates
  whether a key is present, not whether credentials are valid.
- `GET /diagnostics`: requires `X-Bridge-Token`; shows sanitized provider
  status/error.
- `POST /mcp`: separate authenticated JSON-RPC endpoint supporting the
  2025-06-18 initialize, ping, tools/list and tools/call methods.
  Tools: `ask_openai` and `bridge_status`.

**Important:** Lucy is currently an HTTP `/chat` client and already
exposes its own *separate* read-only MCP server at `/mcp`.
The ESP32 is **not** an MCP client. No MCU firmware change is needed
to use the hosted AI chat service via its existing settings page.
The hosted MCP endpoint is for MCP-capable clients, not for changing
Lucy's internal MCP tools.

## Deploy to Render

1. In Render dashboard choose New > Blueprint.
2. Select `Sarjeraoss/opencode-with-lucky`, branch `clipbot/openai-mcp`.
3. Blueprint reads `render.yaml` and builds the Dockerfile.
4. In Render secret environment settings provide:
   - `BRIDGE_TOKEN`: unique random secret of at least 24 characters,
     used by Clipbot's `X-Bridge-Token` header
   - `MCP_TOKEN`: a **different** random secret of at least 24 characters,
     for MCP clients' `Authorization: Bearer` header
   - `OPENAI_API_KEY`: a project API key from
     https://platform.openai.com/api-keys
   - `OPENAI_MODEL`: defaults to `gpt-4.1-mini`; select a model your
     account is authorized to use
5. Deploy. Render gives an `https://...onrender.com` URL. Use that real
   URL below, without assuming this exact hostname.
6. Open `https://YOUR-RENDER-HOST/health`. The JSON should report `ok:true`
   and `providerConfigured:true`. This does not prove API billing or quota.

## Test with Windows PowerShell

```powershell
$base = "https://YOUR-RENDER-HOST"
$token = Read-Host "Bridge token"
$body = @{messages=@(@{role="user";content="What is the capital of India?"})} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "$base/chat" -Method Post -Headers @{"X-Bridge-Token"=$token} -ContentType "application/json" -Body $body -TimeoutSec 60
```

Expected success response:
```json
{"reply":"New Delhi.","model":"gpt-4.1-mini"}
```
Actual wording may vary. HTTP 401 means wrong bridge token;
HTTP 503 means no OpenAI key; HTTP 502 or 429 may indicate a bad
provider key, insufficient permissions, quota, rate limits, or outages.

## Test MCP endpoint

```powershell
$mcpToken = Read-Host "MCP token"
$body = @{jsonrpc="2.0";id=1;method="tools/list"} | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri "$base/mcp" -Method Post -Headers @{Authorization="Bearer $mcpToken"} -ContentType "application/json" -Body $body
```
MCP tool `ask_openai` makes a paid OpenAI request. Keep its token secret.

## Connect Clipbot

1. Join `Lucy-Setup` and open `http://192.168.4.1/settings`.
2. Turn on Online AI brain, set URL to `https://YOUR-RENDER-HOST`
   (do not append `/chat`), and enter `BRIDGE_TOKEN`.
3. Keep your existing read-only Lucy MCP settings unchanged.
4. Save and ask a question from Lucy's web console. The existing
   ESP32 OpenCode bridge client uses the same `/chat` JSON format.
5. If HTTPS fails while Windows succeeds, investigate the ESP32 trust
   bundle (Render's TLS chain), its clock, and heap diagnostics.

## Boundaries

- This service provides **text chat**, not text-to-speech audio. Keep a
  separate TTS endpoint for the ESP32-connected speaker.
- API charges accrue to your OpenAI project; configure spend limits and
  rotate keys when necessary. Never paste secrets into chat or GitHub.
- Render free instances may spin down; the first request may take longer.
- This small MCP subset responds with JSON rather than SSE and does not
  implement all modern optional streamable-HTTP capabilities.
- Do not expose Lucy's local OTA port to the public internet.
