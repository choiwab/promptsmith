from __future__ import annotations

import base64

import httpx

from backend.app.core.config import Settings, to_relative_path
from backend.app.core.errors import ApiError, ErrorCode
from backend.app.storage.repository import Repository


class GenerationService:
    def __init__(self, *, settings: Settings, repository: Repository):
        self.settings = settings
        self.repository = repository

    async def generate(
        self,
        *,
        project_id: str,
        prompt: str,
        model: str,
        seed: str | None,
    ):
        self.repository.ensure_project(project_id)
        commit_id = self.repository.reserve_commit_id()

        try:
            image_bytes = await self._generate_image_bytes(
                prompt=prompt,
                model=model,
                seed=seed,
            )
            image_path = self.settings.app_image_dir / commit_id / "img_01.png"
            self.repository.store.atomic_write_bytes(image_path, image_bytes)

            image_rel_path = to_relative_path(image_path)
            commit = self.repository.create_commit(
                commit_id=commit_id,
                project_id=project_id,
                prompt=prompt,
                model=model,
                seed=seed,
                image_paths=[image_rel_path],
                status="success",
                error=None,
            )
            return commit
        except ApiError as api_error:
            self.repository.create_commit(
                commit_id=commit_id,
                project_id=project_id,
                prompt=prompt,
                model=model,
                seed=seed,
                image_paths=[],
                status="failed",
                error=f"{api_error.code.value}: {api_error.message}",
            )
            raise
        except Exception as exc:
            self.repository.create_commit(
                commit_id=commit_id,
                project_id=project_id,
                prompt=prompt,
                model=model,
                seed=seed,
                image_paths=[],
                status="failed",
                error=f"{ErrorCode.OPENAI_UPSTREAM_ERROR.value}: {exc}",
            )
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "Image generation failed due to unexpected upstream response.",
                status_code=502,
            ) from exc

    async def _generate_image_bytes(self, *, prompt: str, model: str, seed: str | None) -> bytes:
        if not self.settings.openai_api_key:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OPENAI_API_KEY is missing.",
                status_code=502,
            )

        selected_model = model or self.settings.openai_image_model
        model_name = selected_model.lower()
        is_gpt_image = model_name.startswith("gpt-image")

        payload: dict[str, str | int] = {
            "model": selected_model,
            "prompt": prompt,
            "size": "1024x1024",
            "n": 1,
        }
        # `response_format` is only documented for DALL-E image generations.
        # GPT Image responses include base64 image content by default.
        if not is_gpt_image:
            payload["response_format"] = "b64_json"

        # Preserve seed in commit metadata, but do not send it upstream:
        # current image-generation docs do not define a stable `seed` request field.
        _ = seed

        headers = {
            "Authorization": f"Bearer {self.settings.openai_api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                response = await client.post(
                    "https://api.openai.com/v1/images/generations",
                    json=payload,
                    headers=headers,
                )
        except httpx.TimeoutException as exc:
            raise ApiError(
                ErrorCode.OPENAI_TIMEOUT,
                "Image generation timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Image generation upstream HTTP error: {exc}",
                status_code=502,
            ) from exc

        if response.status_code >= 500:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "Image generation upstream server error.",
                status_code=502,
            )
        if response.status_code >= 400:
            upstream_message = None
            try:
                body = response.json()
                if isinstance(body, dict):
                    error_obj = body.get("error")
                    if isinstance(error_obj, dict):
                        message = error_obj.get("message")
                        if isinstance(message, str) and message:
                            upstream_message = message
            except Exception:
                upstream_message = None

            detail = f": {upstream_message}" if upstream_message else ""
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Image generation request failed ({response.status_code}){detail}",
                status_code=502,
            )

        payload_json = response.json()
        data = payload_json.get("data", [])
        if not isinstance(data, list) or not data:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "Image generation response did not include image data.",
                status_code=502,
            )

        first_item = data[0] if isinstance(data[0], dict) else {}
        b64_image = first_item.get("b64_json")
        if isinstance(b64_image, str) and b64_image:
            return base64.b64decode(b64_image)

        image_url = first_item.get("url")
        if isinstance(image_url, str) and image_url:
            return await self._download_image_bytes(image_url)

        raise ApiError(
            ErrorCode.OPENAI_UPSTREAM_ERROR,
            "Image generation returned neither b64_json nor URL.",
            status_code=502,
        )

    async def _download_image_bytes(self, image_url: str) -> bytes:
        try:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                return response.content
        except httpx.TimeoutException as exc:
            raise ApiError(
                ErrorCode.OPENAI_TIMEOUT,
                "Timed out downloading generated image.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Failed to download generated image: {exc}",
                status_code=502,
            ) from exc
