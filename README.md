# ChronoShield API

**DST-aware datetime validation, resolution, and conversion.**

ChronoShield API is a production-ready REST API that prevents timezone bugs by explicitly detecting DST gaps (spring-forward), DST overlaps (fall-back), and ambiguous local times — then resolving them deterministically using your chosen policy.

**Base URL:** `https://chronoshieldapi.com`
**Docs:** [chronoshieldapi.com/docs](https://chronoshieldapi.com/docs)

---

## Table of Contents

- [Why ChronoShield API](#why-chronoshield-api)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Reference](#api-reference)
  - [POST /v1/datetime/validate](#post-v1datetimevalidate)
  - [POST /v1/datetime/resolve](#post-v1datetimeresolve)
  - [POST /v1/datetime/convert](#post-v1datetimeconvert)
  - [POST /v1/datetime/batch](#post-v1datetimebatch)
  - [GET /health](#get-health)
- [Enums & Constants](#enums--constants)
- [Error Handling](#error-handling)
- [Rate Limits](#rate-limits)
- [SDKs](#sdks)
- [AI Agent / Tool Integration](#ai-agent--tool-integration)
- [Self-Hosting](#self-hosting)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Why ChronoShield API

Every timezone library can convert times. ChronoShield API is different — it **catches the edge cases that cause production bugs**:

| Problem | What happens | How ChronoShield API helps |
|---|---|---|
| **DST gap** | User schedules a meeting at 2:30 AM on spring-forward day — that time doesn't exist | Returns `status: "invalid"` with `reason_code: "DST_GAP"` and suggests the next valid time |
| **DST overlap** | User picks 1:30 AM on fall-back day — that time happens twice | Returns `status: "ambiguous"` with both possible UTC instants |
| **Silent misconversion** | Naive UTC conversion silently picks the wrong offset | Resolution policies (`earlier`, `later`, `reject`) give you explicit control |

**Use it when you're building:** scheduling systems, calendar integrations, workflow automation, booking platforms, cron job managers, or any system where "what time is it really?" matters.

---

## Quick Start

Get an API key at [chronoshieldapi.com](https://chronoshieldapi.com), then:

```bash
curl -X POST https://chronoshieldapi.com/v1/datetime/validate \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "local_datetime": "2026-03-08T02:30:00",
    "time_zone": "America/New_York"
  }'
```

Response:

```json
{
  "status": "invalid",
  "reason_code": "DST_GAP",
  "message": "This time does not exist due to DST transition.",
  "suggested_fixes": [
    { "strategy": "next_valid_time", "local_datetime": "2026-03-08T03:00:00" },
    { "strategy": "previous_valid_time", "local_datetime": "2026-03-08T01:59:59" }
  ]
}
```

---

## Authentication

All `/v1/*` endpoints require an API key passed via the `x-api-key` header.

```
x-api-key: YOUR_API_KEY
```

**Getting a key:**

1. Visit the [landing page](https://chronoshieldapi.com) and click "Get Free API Key"
2. Enter your email — a key is generated instantly
3. Keys are prefixed with `cg_live_` for easy identification

**Tiers:**

| Tier | Price | Requests/month |
|---|---|---|
| Free | $0 | 1,000 |
| Pro | $19/month | 100,000 |

Requests without a valid key receive a `401 Unauthorized` response:

```json
{ "error": "Unauthorized: invalid or missing API key" }
```

---

## API Reference

All endpoints accept and return `application/json`. All datetimes use ISO 8601 format. Timezones must be valid [IANA identifiers](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`).

---

### POST /v1/datetime/validate

Check whether a local datetime is valid, invalid (DST gap), or ambiguous (DST overlap) in the given timezone.

**When to use:** Before storing or acting on a user-provided local time. Call this first to detect problems, then decide how to handle them — or use `/resolve` to handle them automatically.

#### Request

```json
{
  "local_datetime": "2026-03-08T02:30:00",
  "time_zone": "America/New_York"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `local_datetime` | `string` | Yes | ISO 8601 local datetime without offset (e.g., `2026-03-08T02:30:00`) |
| `time_zone` | `string` | Yes | IANA timezone identifier (e.g., `America/New_York`) |

#### Response — Valid time

```json
{
  "status": "valid",
  "message": "The provided datetime is valid in the given timezone."
}
```

#### Response — DST gap (invalid)

```json
{
  "status": "invalid",
  "reason_code": "DST_GAP",
  "message": "This time does not exist due to DST transition.",
  "suggested_fixes": [
    { "strategy": "next_valid_time", "local_datetime": "2026-03-08T03:00:00" },
    { "strategy": "previous_valid_time", "local_datetime": "2026-03-08T01:59:59" }
  ]
}
```

#### Response — DST overlap (ambiguous)

```json
{
  "status": "ambiguous",
  "reason_code": "DST_OVERLAP",
  "message": "This time is ambiguous due to DST transition (fall-back).",
  "possible_instants": [
    { "offset": "-04:00", "instant_utc": "2026-11-01T05:30:00.000Z" },
    { "offset": "-05:00", "instant_utc": "2026-11-01T06:30:00.000Z" }
  ]
}
```

#### Response — Invalid timezone

```json
{
  "status": "invalid",
  "reason_code": "INVALID_TIMEZONE",
  "message": "Invalid IANA timezone: Fake/Zone"
}
```

---

### POST /v1/datetime/resolve

Resolve a local datetime to a single UTC instant, automatically handling DST gaps and overlaps using your specified policy.

**When to use:** When you need a definitive UTC timestamp from a local time and want deterministic behavior for edge cases.

#### Request

```json
{
  "local_datetime": "2026-11-01T01:30:00",
  "time_zone": "America/New_York",
  "resolution_policy": {
    "ambiguous": "earlier",
    "invalid": "next_valid_time"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `local_datetime` | `string` | Yes | ISO 8601 local datetime |
| `time_zone` | `string` | Yes | IANA timezone identifier |
| `resolution_policy` | `object` | No | How to handle edge cases (defaults shown below) |
| `resolution_policy.ambiguous` | `string` | No | `"earlier"` (default), `"later"`, or `"reject"` |
| `resolution_policy.invalid` | `string` | No | `"next_valid_time"` (default), `"previous_valid_time"`, or `"reject"` |

**Ambiguous policy** (DST overlap — time occurs twice):

| Value | Behavior |
|---|---|
| `earlier` | Choose the first occurrence (before clocks fall back) |
| `later` | Choose the second occurrence (after clocks fall back) |
| `reject` | Return `400` error instead of guessing |

**Invalid policy** (DST gap — time doesn't exist):

| Value | Behavior |
|---|---|
| `next_valid_time` | Jump forward to the first valid time after the gap |
| `previous_valid_time` | Jump back to the last valid time before the gap |
| `reject` | Return `400` error instead of adjusting |

#### Response — Success

```json
{
  "instant_utc": "2026-11-01T05:30:00.000Z",
  "offset": "-04:00"
}
```

| Field | Type | Description |
|---|---|---|
| `instant_utc` | `string` | The resolved UTC instant (ISO 8601 with `Z` suffix) |
| `offset` | `string` | The UTC offset that was applied (e.g., `-04:00`) |

#### Response — Rejected

When policy is set to `"reject"` and the time is ambiguous or invalid:

```json
{
  "error": "This time is ambiguous due to DST transition and policy is set to reject.",
  "code": "DST_OVERLAP"
}
```

---

### POST /v1/datetime/convert

Convert a UTC instant to a local datetime in the target timezone. This is a simple, unambiguous operation — a UTC instant maps to exactly one local time.

**When to use:** Displaying times to users in their local timezone, or converting stored UTC timestamps for a specific region.

#### Request

```json
{
  "instant_utc": "2026-06-15T15:00:00Z",
  "target_time_zone": "Europe/London"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `instant_utc` | `string` | Yes | ISO 8601 UTC datetime (must end with `Z`) |
| `target_time_zone` | `string` | Yes | IANA timezone identifier |

#### Response

```json
{
  "local_datetime": "2026-06-15T16:00:00",
  "offset": "+01:00",
  "time_zone": "Europe/London"
}
```

| Field | Type | Description |
|---|---|---|
| `local_datetime` | `string` | The local datetime in the target timezone |
| `offset` | `string` | The UTC offset at that moment (e.g., `+01:00` for BST) |
| `time_zone` | `string` | The timezone that was applied |

---

### POST /v1/datetime/batch

Process up to 100 validate, resolve, and convert operations in a single request. Partial failures are handled gracefully — each item gets its own success/error result.

**When to use:** Importing calendar events, migrating scheduling data, or any scenario where you need to process multiple datetimes at once.

#### Request

```json
{
  "items": [
    {
      "operation": "validate",
      "local_datetime": "2026-03-08T02:30:00",
      "time_zone": "America/New_York"
    },
    {
      "operation": "resolve",
      "local_datetime": "2026-11-01T01:30:00",
      "time_zone": "America/New_York",
      "resolution_policy": { "ambiguous": "earlier" }
    },
    {
      "operation": "convert",
      "instant_utc": "2026-06-15T15:00:00Z",
      "target_time_zone": "Europe/London"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | `array` | Yes | Array of operations (1–100 items) |
| `items[].operation` | `string` | Yes | `"validate"`, `"resolve"`, or `"convert"` |

Each item includes the fields for its respective operation (see individual endpoint docs above).

#### Response

```json
{
  "results": [
    { "index": 0, "operation": "validate", "success": true, "data": { "status": "invalid", "reason_code": "DST_GAP", ... } },
    { "index": 1, "operation": "resolve", "success": true, "data": { "instant_utc": "2026-11-01T05:30:00.000Z", "offset": "-04:00" } },
    { "index": 2, "operation": "convert", "success": true, "data": { "local_datetime": "2026-06-15T16:00:00", "offset": "+01:00", "time_zone": "Europe/London" } }
  ],
  "total": 3,
  "succeeded": 3,
  "failed": 0
}
```

Failed items return `success: false` with an `error` object instead of `data`, while the rest of the batch still succeeds.

---

### GET /health

Returns service health status. No authentication required.

```json
{ "status": "ok" }
```

---

## Enums & Constants

### `status`

| Value | Meaning |
|---|---|
| `valid` | The datetime exists exactly once in the given timezone |
| `invalid` | The datetime does not exist (DST gap — clocks skipped forward) |
| `ambiguous` | The datetime exists twice (DST overlap — clocks fell back) |

### `reason_code`

| Value | Meaning |
|---|---|
| `DST_GAP` | Time falls in a spring-forward gap |
| `DST_OVERLAP` | Time falls in a fall-back overlap |
| `INVALID_TIMEZONE` | The provided timezone is not a valid IANA identifier |

### `strategy` (suggested fixes)

| Value | Meaning |
|---|---|
| `next_valid_time` | The first valid local time after the gap |
| `previous_valid_time` | The last valid local time before the gap |

---

## Error Handling

All errors return a JSON body with an `error` field and appropriate HTTP status code.

| Status | Meaning | Example |
|---|---|---|
| `400` | Invalid request — bad datetime format, missing fields, or rejected by policy | `{ "error": "Validation failed", "details": [...] }` |
| `401` | Missing or invalid API key | `{ "error": "Unauthorized: invalid or missing API key" }` |
| `500` | Internal server error | `{ "error": "Internal server error" }` |

**Zod validation errors** (malformed requests) return structured details:

```json
{
  "error": "Validation failed",
  "details": [
    {
      "code": "invalid_string",
      "message": "Must be ISO 8601 local datetime (e.g. 2026-03-08T02:30:00)",
      "path": ["local_datetime"]
    }
  ]
}
```

---

## Rate Limits

| Tier | Requests per month | Rate |
|---|---|---|
| Free | 1,000 | ~33/day |
| Pro ($19/mo) | 100,000 | ~3,300/day |
| Enterprise | Custom | [Contact us](mailto:mikemaittech@gmail.com) |

When you exceed your limit, requests return `429 Too Many Requests`.

---

## SDKs

### TypeScript / JavaScript

```typescript
import { ChronoShield APIClient } from "chronoshield";

const client = new ChronoShield APIClient({
  baseUrl: "https://chronoshieldapi.com",
  apiKey: "YOUR_API_KEY",
});

// Validate
const validation = await client.validate({
  local_datetime: "2026-03-08T02:30:00",
  time_zone: "America/New_York",
});
console.log(validation.status); // "invalid"

// Resolve
const resolved = await client.resolve({
  local_datetime: "2026-11-01T01:30:00",
  time_zone: "America/New_York",
  resolution_policy: { ambiguous: "earlier" },
});
console.log(resolved.instant_utc); // "2026-11-01T05:30:00.000Z"

// Convert
const converted = await client.convert({
  instant_utc: "2026-06-15T15:00:00Z",
  target_time_zone: "Europe/London",
});
console.log(converted.local_datetime); // "2026-06-15T16:00:00"
```

### Python

```python
from chronoshield import ChronoShield APIClient

client = ChronoShield APIClient(
    base_url="https://chronoshieldapi.com",
    api_key="YOUR_API_KEY",
)

# Validate
result = client.validate("2026-03-08T02:30:00", "America/New_York")
print(result.status)  # "invalid"

# Resolve
resolved = client.resolve("2026-11-01T01:30:00", "America/New_York", ambiguous="earlier")
print(resolved.instant_utc)  # "2026-11-01T05:30:00.000Z"

# Convert
converted = client.convert("2026-06-15T15:00:00Z", "Europe/London")
print(converted.local_datetime)  # "2026-06-15T16:00:00"
```

---

## AI Agent / Tool Integration

ChronoShield API exposes tool schemas compatible with function-calling AI agents (OpenAI, Anthropic Claude, LangChain, etc.). The tool definitions are available in [`agent-tools.json`](./agent-tools.json).

### Tool: `validate_local_datetime`

```json
{
  "name": "validate_local_datetime",
  "description": "Check if a local datetime is valid, invalid (DST gap), or ambiguous (DST overlap) in the given timezone",
  "input_schema": {
    "type": "object",
    "properties": {
      "local_datetime": { "type": "string", "description": "ISO 8601 local datetime (e.g. 2026-03-08T02:30:00)" },
      "time_zone": { "type": "string", "description": "IANA timezone identifier (e.g. America/New_York)" }
    },
    "required": ["local_datetime", "time_zone"]
  }
}
```

### Tool: `resolve_datetime`

```json
{
  "name": "resolve_datetime",
  "description": "Resolve an ambiguous or invalid local datetime to a UTC instant using the specified policy",
  "input_schema": {
    "type": "object",
    "properties": {
      "local_datetime": { "type": "string" },
      "time_zone": { "type": "string" },
      "ambiguous_policy": { "type": "string", "enum": ["earlier", "later", "reject"] },
      "invalid_policy": { "type": "string", "enum": ["next_valid_time", "previous_valid_time", "reject"] }
    },
    "required": ["local_datetime", "time_zone"]
  }
}
```

### Tool: `convert_datetime`

```json
{
  "name": "convert_datetime",
  "description": "Convert a UTC instant to a local datetime in the target timezone",
  "input_schema": {
    "type": "object",
    "properties": {
      "instant_utc": { "type": "string", "description": "ISO 8601 UTC datetime (e.g. 2026-06-15T15:00:00Z)" },
      "target_time_zone": { "type": "string", "description": "IANA timezone identifier" }
    },
    "required": ["instant_utc", "target_time_zone"]
  }
}
```

### Example: Using with an AI Agent

An AI scheduling assistant can use ChronoShield API to safely book meetings:

1. User says: "Schedule a call at 2:30 AM ET on March 8, 2026"
2. Agent calls `validate_local_datetime` → gets `status: "invalid"`, `reason_code: "DST_GAP"`
3. Agent sees `suggested_fixes` → offers "That time doesn't exist due to daylight saving. The next available time is 3:00 AM. Should I use that?"
4. User confirms → agent calls `resolve_datetime` with `invalid: "next_valid_time"` → gets the correct UTC instant
5. Agent stores `2026-03-08T07:00:00.000Z` in the calendar — no bug, no silent misconversion

---

## Self-Hosting

### Docker Compose

```bash
git clone https://github.com/Mike-Mait/ChronoShield-API.git
cd ChronoShield-API
cp .env.example .env    # Edit with your values
docker compose up
```

This starts the API, Postgres, and Redis. The API will be available at `http://localhost:3000`.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `3000`) |
| `HOST` | No | Bind address (default: `0.0.0.0`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `API_KEY` | No | Master API key for authentication |
| `STRIPE_SECRET_KEY` | No | Stripe secret key for payments |
| `STRIPE_PRICE_ID` | No | Stripe Price ID for Pro tier |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret |

### Development

```bash
npm install
npm run dev        # Start with hot reload (tsx)
npm test           # Run test suite (vitest)
npm run build      # Compile TypeScript
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 20 |
| Framework | Fastify |
| Language | TypeScript |
| Time handling | Luxon (IANA tzdb) |
| Validation | Zod |
| Database | PostgreSQL (Prisma ORM) |
| Cache | Redis |
| Payments | Stripe Checkout |
| Deployment | Railway |
| API Spec | OpenAPI 3.1 |

---

## License

ISC
