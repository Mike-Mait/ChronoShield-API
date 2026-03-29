"""ChronoGuard Python SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import urllib.request
import urllib.error
import json


@dataclass
class ValidateResponse:
    status: str
    reason_code: Optional[str] = None
    message: Optional[str] = None
    suggested_fixes: Optional[list[dict[str, str]]] = None
    possible_instants: Optional[list[dict[str, str]]] = None


@dataclass
class ResolveResponse:
    instant_utc: str
    offset: str


@dataclass
class ConvertResponse:
    local_datetime: str
    offset: str
    time_zone: str


class ChronoGuardClient:
    """Client for the ChronoGuard API."""

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _request(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}{endpoint}",
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.api_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = json.loads(e.read().decode("utf-8"))
            raise RuntimeError(
                f"ChronoGuard API error ({e.code}): {error_body.get('error', 'Unknown error')}"
            ) from e

    def validate(
        self, local_datetime: str, time_zone: str
    ) -> ValidateResponse:
        result = self._request(
            "/v1/datetime/validate",
            {"local_datetime": local_datetime, "time_zone": time_zone},
        )
        return ValidateResponse(**result)

    def resolve(
        self,
        local_datetime: str,
        time_zone: str,
        ambiguous: str = "earlier",
        invalid: str = "next_valid_time",
    ) -> ResolveResponse:
        result = self._request(
            "/v1/datetime/resolve",
            {
                "local_datetime": local_datetime,
                "time_zone": time_zone,
                "resolution_policy": {
                    "ambiguous": ambiguous,
                    "invalid": invalid,
                },
            },
        )
        return ResolveResponse(**result)

    def convert(
        self, instant_utc: str, target_time_zone: str
    ) -> ConvertResponse:
        result = self._request(
            "/v1/datetime/convert",
            {
                "instant_utc": instant_utc,
                "target_time_zone": target_time_zone,
            },
        )
        return ConvertResponse(**result)
