# ChronoShield SDK for TypeScript/JavaScript

Official TypeScript/JavaScript SDK for the [ChronoShield API](https://chronoshieldapi.com) — DST-aware datetime validation, resolution, and conversion.

## Installation

```bash
npm install chronoshield
```

## Quick Start

```typescript
import { ChronoShieldClient } from "chronoshield";

const client = new ChronoShieldClient({
  apiKey: "cg_live_your_api_key",
});

// Validate a datetime in a specific timezone
const result = await client.validate({
  local_datetime: "2026-03-08T02:30:00",
  time_zone: "America/New_York",
});

console.log(result.status); // "invalid" (falls in DST gap)
console.log(result.reason_code); // "DST_GAP"
console.log(result.suggested_fixes); // suggested corrections
```

## API Methods

### `validate(request)`

Check whether a local datetime is valid, invalid (DST gap), or ambiguous (DST overlap) in a given timezone.

```typescript
const result = await client.validate({
  local_datetime: "2026-11-01T01:30:00",
  time_zone: "America/New_York",
});
// result.status === "ambiguous"
// result.possible_instants includes both EDT and EST interpretations
```

### `resolve(request)`

Resolve a local datetime to a single UTC instant, with configurable policies for ambiguous and invalid times.

```typescript
const result = await client.resolve({
  local_datetime: "2026-11-01T01:30:00",
  time_zone: "America/New_York",
  resolution_policy: {
    ambiguous: "earlier", // or "later", "reject"
    invalid: "next_valid_time", // or "previous_valid_time", "reject"
  },
});
// result.instant_utc === "2026-11-01T05:30:00Z"
// result.offset === "-04:00"
```

### `convert(request)`

Convert a UTC instant to a local datetime in a target timezone.

```typescript
const result = await client.convert({
  instant_utc: "2026-07-15T18:00:00Z",
  target_time_zone: "Asia/Tokyo",
});
// result.local_datetime === "2026-07-16T03:00:00"
// result.offset === "+09:00"
```

### `batch(items)`

Process up to 100 validate/resolve/convert operations in a single request.

```typescript
const result = await client.batch([
  { operation: "validate", local_datetime: "2026-03-08T02:30:00", time_zone: "America/New_York" },
  { operation: "convert", instant_utc: "2026-07-15T18:00:00Z", target_time_zone: "Europe/London" },
]);
// result.total === 2
// result.results[0].success, result.results[0].data, etc.
```

## Configuration

```typescript
const client = new ChronoShieldClient({
  apiKey: "cg_live_your_api_key",
  baseUrl: "https://chronoshieldapi.com", // optional, this is the default
});
```

## Error Handling

The SDK throws an `Error` for non-200 API responses:

```typescript
try {
  await client.validate({ local_datetime: "bad", time_zone: "Invalid/Zone" });
} catch (err) {
  console.error(err.message);
  // "ChronoShield API error (400): Invalid IANA timezone"
}
```

## Get an API Key

1. Visit [chronoshieldapi.com](https://chronoshieldapi.com) and click **"Get Free API Key"**
2. Enter your email — a key is generated instantly
3. Free tier includes 1,000 requests/month

## Links

- [API Documentation](https://chronoshieldapi.com/docs)
- [GitHub Repository](https://github.com/Mike-Mait/ChronoShield-API)
- [Status Page](https://chronoshield-api.betteruptime.com)

## License

ISC
