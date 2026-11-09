# Lara Top.gg Webhook Receiver

A small standalone HTTP service that receives Top.gg Webhooks v1 events for the Lara music bot. It verifies each delivery's HMAC-SHA256 signature, filters events to Lara's configured bot ID, and records minimal vote receipts as JSONL.

This service does not vote, automate browsers, handle Discord user tokens, send Discord messages, or grant rewards. It only verifies and records votes. Reward or channel integration requires separate requirements and implementation.

## Requirements

- Node.js 20.6.0 or newer (required for `--env-file`)
- No runtime dependencies

## Configuration

Copy `.env.example` to your own environment (do not commit `.env`):

```bash
cp .env.example .env
```

Required variables:

- `LARA_TOPGG_BOT_ID`: Lara's Top.gg/Discord bot ID, as a 15-20 digit snowflake.
- `TOPGG_WEBHOOK_SECRET`: The secret configured in Top.gg for this webhook.

Optional variables:

- `PORT`: HTTP port. Defaults to `3000`.
- `DATA_DIR`: Directory for `received-votes.jsonl`. Defaults to `./data`.

## Running

```bash
npm start
```

`npm start` loads `.env` with Node's native `--env-file` support. The process exits immediately if required configuration is missing or malformed.

## Testing

```bash
npm test
```

Tests use Node's built-in test runner, ephemeral localhost ports, temporary directories, and synthetic secrets. No live credentials or network calls are required.

Syntax check:

```bash
node --check index.js && node --check src/config.js && node --check src/signature.js && node --check src/ledger.js && node --check src/server.js
```

## Endpoints

- `GET /healthz`: Returns `{ "status": "ok" }`.
- `POST /webhooks/topgg`: Top.gg Webhooks v1 delivery endpoint.

## Top.gg Setup

1. Deploy or run this service behind an HTTPS URL that Top.gg can reach.
2. In Top.gg, configure a Webhooks v1 endpoint pointing to `https://your-host/webhooks/topgg`.
3. Subscribe to the `vote.create` event. `webhook.test` deliveries are accepted and do not create vote records.
4. Use the same value for `TOPGG_WEBHOOK_SECRET` in both Top.gg and this service.
5. Set `LARA_TOPGG_BOT_ID` to Lara's bot ID.

Top.gg retries non-2xx deliveries, so the service acknowledges valid deliveries quickly. Duplicate deliveries are idempotent.

## Lara-Only Filtering

A `vote.create` event is recorded only when `data.project.type` is `"bot"`, `data.project.platform` is `"discord"`, and `data.project.platform_id` exactly equals `LARA_TOPGG_BOT_ID`. Events for other projects are acknowledged with `200` and ignored. Vote event IDs and Discord user IDs are validated as 15-20 digit snowflakes, and `weight` is validated as a positive integer, before recording.

## Stored Data

Vote receipts are appended to `data/received-votes.jsonl`, one JSON object per line:

```json
{"event_id":"...","bot_id":"...","user_id":"...","weight":1,"created_at":"...","received_at":"..."}
```

Raw payloads, signatures, and secrets are never stored. The `data/` directory is ignored by Git.

## Security Notes

- The raw request body is preserved and verified before JSON parsing.
- Request bodies are capped at 64 KiB.
- `x-topgg-signature` must use `t=<unix-seconds>,v1=<hex>`.
- HMAC-SHA256 is computed over `${timestamp}.${rawRequestBody}`.
- Signatures use constant-time comparison.
- Timestamps older or newer than five minutes are rejected.
- Errors and logs do not include signatures, bodies, or secrets.

## Current Scope

This service currently verifies and records votes only. It does not integrate with Discord channels, rewards, premium roles, or any downstream system.
