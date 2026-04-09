# ChronoShield SDK for Python

Official Python SDK for the [ChronoShield API](https://chronoshieldapi.com) — DST-aware datetime validation, resolution, and conversion.

## Installation

```bash
pip install chronoshield
```

## Quick Start

```python
from chronoshield import ChronoShieldClient

client = ChronoShieldClient(api_key="cg_live_your_api_key")

# Validate a datetime in a specific timezone
result = client.validate("2026-03-08T02:30:00", "America/New_York")

print(result.status)          # "invalid" (falls in DST gap)
print(result.reason_code)     # "DST_GAP"
print(result.suggested_fixes) # suggested corrections
```

## API Methods

### `validate(local_datetime, time_zone)`

Check whether a local datetime is valid, invalid (DST gap), or ambiguous (DST overlap) in a given timezone.

```python
result = client.validate("2026-11-01T01:30:00", "America/New_York")
# result.status == "ambiguous"
# result.possible_instants includes both EDT and EST interpretations
```

Returns a `ValidateResponse` dataclass with fields: `status`, `reason_code`, `message`, `suggested_fixes`, `possible_instants`.

### `resolve(local_datetime, time_zone, ambiguous, invalid)`

Resolve a local datetime to a single UTC instant, with configurable policies for ambiguous and invalid times.

```python
result = client.resolve(
    "2026-11-01T01:30:00",
    "America/New_York",
    ambiguous="earlier",           # or "later", "reject"
    invalid="next_valid_time",     # or "previous_valid_time", "reject"
)
# result.instant_utc == "2026-11-01T05:30:00Z"
# result.offset == "-04:00"
```

Returns a `ResolveResponse` dataclass with fields: `instant_utc`, `offset`.

### `convert(instant_utc, target_time_zone)`

Convert a UTC instant to a local datetime in a target timezone.

```python
result = client.convert("2026-07-15T18:00:00Z", "Asia/Tokyo")
# result.local_datetime == "2026-07-16T03:00:00"
# result.offset == "+09:00"
```

Returns a `ConvertResponse` dataclass with fields: `local_datetime`, `offset`, `time_zone`.

### `batch(items)`

Process up to 100 validate/resolve/convert operations in a single request.

```python
result = client.batch([
    {"operation": "validate", "local_datetime": "2026-03-08T02:30:00", "time_zone": "America/New_York"},
    {"operation": "convert", "instant_utc": "2026-07-15T18:00:00Z", "target_time_zone": "Europe/London"},
])
# result["total"] == 2
# result["results"][0]["success"], result["results"][0]["data"], etc.
```

Returns a dict with keys: `results`, `total`, `succeeded`, `failed`.

## Configuration

```python
client = ChronoShieldClient(
    api_key="cg_live_your_api_key",
    base_url="https://chronoshieldapi.com",  # optional, this is the default
)
```

## Error Handling

The SDK raises `RuntimeError` for non-200 API responses:

```python
try:
    client.validate("bad", "Invalid/Zone")
except RuntimeError as e:
    print(e)
    # "ChronoShield API error (400): Invalid IANA timezone"
```

## Zero Dependencies

This SDK uses only the Python standard library (`urllib`, `json`, `dataclasses`) — no external packages required.

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
