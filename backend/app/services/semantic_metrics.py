from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import httpx

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError, ErrorCode


class SemanticMetricsService:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def evaluate(self, *, baseline_image_path: Path, candidate_image_path: Path) -> float:
        if not self.settings.openai_api_key:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OPENAI_API_KEY is missing; semantic signal unavailable.",
                status_code=502,
            )

        for attempt in range(2):
            raw_text = await self._call_openai(
                baseline_image_path=baseline_image_path,
                candidate_image_path=candidate_image_path,
            )
            try:
                payload = self._extract_json(raw_text)
                score = float(payload["semantic_similarity"])
                return self._clamp01(score)
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                if attempt == 1:
                    raise ApiError(
                        ErrorCode.OPENAI_UPSTREAM_ERROR,
                        "Semantic model returned invalid JSON.",
                        status_code=502,
                    )
        raise ApiError(
            ErrorCode.OPENAI_UPSTREAM_ERROR,
            "Semantic model failed.",
            status_code=502,
        )

    async def _call_openai(self, *, baseline_image_path: Path, candidate_image_path: Path) -> str:
        baseline_data = self._image_to_data_url(baseline_image_path)
        candidate_data = self._image_to_data_url(candidate_image_path)

        payload = {
            "model": self.settings.openai_vision_model,
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "You score semantic identity consistency between two images. "
                                "Return strict JSON only: {\"semantic_similarity\": <float 0..1>}."
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "Image A is baseline. Image B is candidate."},
                        {"type": "input_image", "image_url": baseline_data},
                        {"type": "input_image", "image_url": candidate_data},
                    ],
                },
            ],
        }

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                response = await client.post(
                    "https://api.openai.com/v1/responses",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise ApiError(
                ErrorCode.OPENAI_TIMEOUT,
                "Semantic evaluation timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Semantic evaluation upstream HTTP error: {exc}",
                status_code=502,
            ) from exc

        if response.status_code >= 500:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "Semantic evaluation upstream server error.",
                status_code=502,
            )

        if response.status_code >= 400:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Semantic evaluation request failed ({response.status_code}).",
                status_code=502,
            )

        payload_json = response.json()
        return self._extract_text(payload_json)

    def _extract_text(self, payload: dict) -> str:
        output_text = payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text

        output = payload.get("output", [])
        texts: list[str] = []
        if isinstance(output, list):
            for item in output:
                content = item.get("content", []) if isinstance(item, dict) else []
                if not isinstance(content, list):
                    continue
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") in {"output_text", "text"}:
                        text = part.get("text")
                        if isinstance(text, str):
                            texts.append(text)
        if texts:
            return "\n".join(texts)

        raise ApiError(
            ErrorCode.OPENAI_UPSTREAM_ERROR,
            "Semantic evaluation response did not contain text output.",
            status_code=502,
        )

    def _extract_json(self, raw_text: str) -> dict:
        raw_text = raw_text.strip()
        if raw_text.startswith("{") and raw_text.endswith("}"):
            return json.loads(raw_text)

        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if not match:
            raise json.JSONDecodeError("No JSON object found", raw_text, 0)
        return json.loads(match.group(0))

    def _image_to_data_url(self, path: Path) -> str:
        with path.open("rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
        return f"data:image/png;base64,{encoded}"

    def _clamp01(self, value: float) -> float:
        return max(0.0, min(1.0, value))
