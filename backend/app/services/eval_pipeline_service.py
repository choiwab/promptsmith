from __future__ import annotations

import asyncio
import base64
import copy
import json
from pathlib import Path
import re
import threading
import time
import uuid
from typing import Any

import httpx

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError, ErrorCode
from backend.app.storage.repository import Repository
from backend.app.storage.schemas import utc_now_iso


class EvalPipelineService:
    def __init__(self, *, settings: Settings, repository: Repository):
        self.settings = settings
        self.repository = repository
        self._runs: dict[str, dict[str, Any]] = {}
        self._run_lock = threading.Lock()

    async def create_run(
        self,
        *,
        project_id: str,
        base_prompt: str,
        objective_preset: str,
        image_model: str,
        n_variants: int,
        quality: str,
        constraints: dict[str, list[str]],
        parent_commit_id: str | None,
    ) -> dict[str, Any]:
        self.repository.ensure_project(project_id)
        if parent_commit_id:
            parent_commit = self.repository.get_commit(parent_commit_id, project_id=project_id)
            if parent_commit.status != "success" or not parent_commit.image_paths:
                raise ApiError(
                    ErrorCode.COMMIT_NOT_FOUND,
                    f"Commit '{parent_commit_id}' is not a successful generation with image artifacts.",
                    status_code=404,
                )

        run_id = f"eval_{uuid.uuid4().hex[:12]}"
        now = utc_now_iso()

        run: dict[str, Any] = {
            "run_id": run_id,
            "project_id": project_id,
            "base_prompt": base_prompt,
            "objective_preset": objective_preset,
            "image_model": image_model,
            "n_variants": n_variants,
            "quality": quality,
            "parent_commit_id": parent_commit_id,
            "anchor_commit_id": None,
            "constraints": {
                "must_include": constraints.get("must_include", []),
                "must_avoid": constraints.get("must_avoid", []),
            },
            "status": "queued",
            "stage": "queued",
            "degraded": False,
            "error": None,
            "progress": {
                "total_variants": n_variants,
                "generated_variants": 0,
                "evaluated_variants": 0,
                "failed_variants": 0,
            },
            "variants": [],
            "leaderboard": [],
            "top_k": [],
            "suggestions": {
                "conservative": {"prompt_text": "", "rationale": ""},
                "balanced": {"prompt_text": "", "rationale": ""},
                "aggressive": {"prompt_text": "", "rationale": ""},
            },
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }
        self._set_run(run)

        task = asyncio.create_task(self._execute_run(run_id))
        task.add_done_callback(self._ignore_task_exception)
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self._run_lock:
            run = self._runs.get(run_id)
            if run is None:
                raise ApiError(
                    ErrorCode.EVAL_RUN_NOT_FOUND,
                    f"Eval run '{run_id}' was not found.",
                    status_code=404,
                )
            return copy.deepcopy(run)

    def _set_run(self, run: dict[str, Any]) -> None:
        with self._run_lock:
            self._runs[str(run["run_id"])] = run

    def _update_run(self, run_id: str, patch: dict[str, Any]) -> None:
        with self._run_lock:
            run = self._runs.get(run_id)
            if run is None:
                raise ApiError(
                    ErrorCode.EVAL_RUN_NOT_FOUND,
                    f"Eval run '{run_id}' was not found.",
                    status_code=404,
                )
            run.update(patch)
            run["updated_at"] = utc_now_iso()

    def _set_stage(self, run_id: str, stage: str) -> None:
        self._update_run(run_id, {"stage": stage, "status": stage})

    def _mark_degraded(self, run_id: str) -> None:
        self._update_run(run_id, {"degraded": True})

    def _update_progress(
        self,
        run_id: str,
        *,
        generated_increment: int = 0,
        evaluated_increment: int = 0,
        failed_increment: int = 0,
    ) -> None:
        with self._run_lock:
            run = self._runs.get(run_id)
            if run is None:
                raise ApiError(
                    ErrorCode.EVAL_RUN_NOT_FOUND,
                    f"Eval run '{run_id}' was not found.",
                    status_code=404,
                )

            progress = dict(run.get("progress", {}))
            progress["generated_variants"] = int(progress.get("generated_variants", 0)) + generated_increment
            progress["evaluated_variants"] = int(progress.get("evaluated_variants", 0)) + evaluated_increment
            progress["failed_variants"] = int(progress.get("failed_variants", 0)) + failed_increment
            run["progress"] = progress
            run["updated_at"] = utc_now_iso()

    def _replace_variants(self, run_id: str, variants: list[dict[str, Any]]) -> None:
        self._update_run(run_id, {"variants": variants})

    def _update_variant(self, run_id: str, variant_id: str, patch: dict[str, Any]) -> None:
        with self._run_lock:
            run = self._runs.get(run_id)
            if run is None:
                raise ApiError(
                    ErrorCode.EVAL_RUN_NOT_FOUND,
                    f"Eval run '{run_id}' was not found.",
                    status_code=404,
                )

            variants = run.get("variants", [])
            for variant in variants:
                if variant.get("variant_id") == variant_id:
                    variant.update(patch)
                    run["updated_at"] = utc_now_iso()
                    return
            raise ApiError(
                ErrorCode.INVALID_REQUEST,
                f"Variant '{variant_id}' was not found in run '{run_id}'.",
                status_code=400,
            )

    async def _execute_run(self, run_id: str) -> None:
        run = self.get_run(run_id)
        try:
            self._set_stage(run_id, "planning")
            planned_variants = await self._plan_variants(
                base_prompt=run["base_prompt"],
                objective_preset=run["objective_preset"],
                constraints=run["constraints"],
                n_variants=int(run["n_variants"]),
            )
            if not planned_variants:
                raise ApiError(
                    ErrorCode.OPENAI_UPSTREAM_ERROR,
                    "Unable to produce prompt variants for this run.",
                    status_code=502,
                )

            variants: list[dict[str, Any]] = []
            for index, planned in enumerate(planned_variants):
                variant_id = f"v{index + 1:02d}"
                variants.append(
                    {
                        "variant_id": variant_id,
                        "variant_prompt": str(planned.get("variant_prompt", "")).strip(),
                        "mutation_tags": [str(item) for item in planned.get("mutation_tags", []) if str(item).strip()],
                        "parent_commit_id": None,
                        "status": "planned",
                        "generation_latency_ms": None,
                        "judge_latency_ms": None,
                        "commit_id": None,
                        "image_url": None,
                        "rationale": "",
                        "confidence": 0.0,
                        "prompt_adherence": 0.0,
                        "subject_fidelity": 0.0,
                        "composition_quality": 0.0,
                        "style_coherence": 0.0,
                        "technical_artifact_penalty": 1.0,
                        "strength_tags": [],
                        "failure_tags": [],
                        "composite_score": 0.0,
                        "rank": None,
                        "error": None,
                    }
                )
            self._replace_variants(run_id, variants)

            self._set_stage(run_id, "generating")
            anchor_commit_id, anchor_image_bytes = await self._resolve_anchor_image(
                project_id=run["project_id"],
                base_prompt=run["base_prompt"],
                image_model=run["image_model"],
                quality=run["quality"],
                parent_commit_id=run.get("parent_commit_id"),
            )
            self._update_run(run_id, {"anchor_commit_id": anchor_commit_id})
            images_by_variant = await self._generate_images(
                run_id=run_id,
                project_id=run["project_id"],
                variants=variants,
                image_model=run["image_model"],
                quality=run["quality"],
                parent_commit_id=anchor_commit_id,
                parent_image_bytes=anchor_image_bytes,
            )
            if not images_by_variant:
                raise ApiError(
                    ErrorCode.OPENAI_UPSTREAM_ERROR,
                    "All variant image generations failed.",
                    status_code=502,
                )

            self._set_stage(run_id, "evaluating")
            await self._evaluate_images(
                run_id=run_id,
                variants=variants,
                images_by_variant=images_by_variant,
                base_prompt=run["base_prompt"],
                objective_preset=run["objective_preset"],
                constraints=run["constraints"],
            )

            leaderboard, top_k = self._rank_variants(self.get_run(run_id)["variants"])
            self._update_run(run_id, {"leaderboard": leaderboard, "top_k": top_k})

            self._set_stage(run_id, "refining")
            suggestions = await self._generate_suggestions(
                base_prompt=run["base_prompt"],
                objective_preset=run["objective_preset"],
                leaderboard=leaderboard,
            )
            self._update_run(run_id, {"suggestions": suggestions})

            finalized = self.get_run(run_id)
            now = utc_now_iso()
            if finalized.get("degraded"):
                self._update_run(
                    run_id,
                    {
                        "status": "completed_degraded",
                        "stage": "completed_degraded",
                        "completed_at": now,
                    },
                )
                return

            self._update_run(
                run_id,
                {
                    "status": "completed",
                    "stage": "completed",
                    "completed_at": now,
                },
            )
        except ApiError as exc:
            self._update_run(
                run_id,
                {
                    "status": "failed",
                    "stage": "failed",
                    "error": f"{exc.code.value}: {exc.message}",
                    "completed_at": utc_now_iso(),
                },
            )
        except Exception as exc:
            self._update_run(
                run_id,
                {
                    "status": "failed",
                    "stage": "failed",
                    "error": f"{ErrorCode.OPENAI_UPSTREAM_ERROR.value}: {exc}",
                    "completed_at": utc_now_iso(),
                },
            )

    async def _plan_variants(
        self,
        *,
        base_prompt: str,
        objective_preset: str,
        constraints: dict[str, list[str]],
        n_variants: int,
    ) -> list[dict[str, Any]]:
        try:
            planned = await self._plan_variants_with_openai(
                base_prompt=base_prompt,
                objective_preset=objective_preset,
                constraints=constraints,
                n_variants=n_variants,
            )
            if planned:
                return planned[:n_variants]
        except Exception:
            # Fall back to deterministic mutation templates for hackathon reliability.
            pass
        return self._fallback_variants(
            base_prompt=base_prompt,
            constraints=constraints,
            n_variants=n_variants,
        )

    async def _plan_variants_with_openai(
        self,
        *,
        base_prompt: str,
        objective_preset: str,
        constraints: dict[str, list[str]],
        n_variants: int,
    ) -> list[dict[str, Any]]:
        must_include = constraints.get("must_include", [])
        must_avoid = constraints.get("must_avoid", [])
        system_text = (
            "You are an expert image prompt-variation planner. "
            "Return strict JSON only in this shape: "
            "{\"variants\":[{\"variant_prompt\":\"...\",\"mutation_tags\":[\"...\"]}]} "
            "Do not include markdown fences."
        )
        user_text = (
            f"Base prompt: {base_prompt}\n"
            f"Objective preset: {objective_preset}\n"
            f"Must include: {must_include}\n"
            f"Must avoid: {must_avoid}\n"
            f"Generate exactly {n_variants} semantically distinct prompt variants. "
            "Mutation tags should include details like composition, lighting, lens, style, and negatives."
        )
        raw_text = await self._call_responses_text(
            model=self.settings.openai_text_model,
            input_messages=[
                {"role": "system", "content": [{"type": "input_text", "text": system_text}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_text}]},
            ],
        )

        payload = self._extract_json(raw_text)
        variants_raw = payload.get("variants", [])
        if not isinstance(variants_raw, list):
            return []

        variants: list[dict[str, Any]] = []
        for item in variants_raw:
            if not isinstance(item, dict):
                continue
            prompt = str(item.get("variant_prompt", "")).strip()
            if not prompt:
                continue
            tags_raw = item.get("mutation_tags", [])
            tags = [str(tag).strip() for tag in tags_raw if str(tag).strip()] if isinstance(tags_raw, list) else []
            variants.append({"variant_prompt": prompt, "mutation_tags": tags[:6]})
        return variants

    def _fallback_variants(
        self,
        *,
        base_prompt: str,
        constraints: dict[str, list[str]],
        n_variants: int,
    ) -> list[dict[str, Any]]:
        mutation_specs = [
            ("composition", "wide cinematic framing with strong foreground-background depth"),
            ("lighting", "dramatic rim lighting with soft key light and controlled shadows"),
            ("lens", "35mm lens perspective with shallow depth of field"),
            ("style", "editorial color grading with subtle film grain"),
            ("detail", "high texture fidelity on key subject materials and surfaces"),
            ("mood", "high-contrast mood with focused subject isolation"),
            ("camera", "low-angle camera placement emphasizing subject presence"),
            ("negative", "avoid visual clutter and accidental background text"),
        ]

        must_include = [item.strip() for item in constraints.get("must_include", []) if item.strip()]
        must_avoid = [item.strip() for item in constraints.get("must_avoid", []) if item.strip()]

        variants: list[dict[str, Any]] = []
        for index in range(n_variants):
            primary_tag, mutation_line = mutation_specs[index % len(mutation_specs)]
            lines = [base_prompt.strip(), mutation_line]
            if must_include:
                lines.append(f"Must include: {', '.join(must_include)}.")
            if must_avoid:
                lines.append(f"Must avoid: {', '.join(must_avoid)}.")

            variants.append(
                {
                    "variant_prompt": " ".join(line for line in lines if line),
                    "mutation_tags": [primary_tag],
                }
            )
        return variants

    async def _resolve_anchor_image(
        self,
        *,
        project_id: str,
        base_prompt: str,
        image_model: str,
        quality: str,
        parent_commit_id: str | None,
    ) -> tuple[str, bytes]:
        if parent_commit_id:
            parent_commit = self.repository.get_commit(parent_commit_id, project_id=project_id)
            image_ref = self._first_image_ref(parent_commit.image_paths)
            if not image_ref:
                raise ApiError(
                    ErrorCode.COMMIT_NOT_FOUND,
                    f"Commit '{parent_commit_id}' is missing image artifacts.",
                    status_code=404,
                )
            return parent_commit_id, await self._resolve_image_ref_bytes(image_ref)

        # No parent provided: create a new anchor/original commit for this run.
        anchor_bytes = await self._generate_image_bytes(
            prompt=base_prompt,
            image_model=image_model,
            quality=quality,
            parent_image_bytes=None,
        )
        anchor_commit_id = self.repository.reserve_commit_id()
        anchor_url = self.repository.upload_commit_image(
            commit_id=anchor_commit_id,
            filename="img_01.png",
            payload=anchor_bytes,
        )
        self.repository.create_commit(
            commit_id=anchor_commit_id,
            project_id=project_id,
            prompt=base_prompt,
            model=image_model,
            seed=None,
            parent_commit_id=None,
            image_paths=[anchor_url],
            status="success",
            error=None,
        )
        return anchor_commit_id, anchor_bytes

    async def _generate_images(
        self,
        *,
        run_id: str,
        project_id: str,
        variants: list[dict[str, Any]],
        image_model: str,
        quality: str,
        parent_commit_id: str,
        parent_image_bytes: bytes,
    ) -> dict[str, bytes]:
        semaphore = asyncio.Semaphore(4)
        image_bytes_by_variant: dict[str, bytes] = {}

        async def worker(variant: dict[str, Any]) -> None:
            variant_id = str(variant["variant_id"])
            prompt = str(variant["variant_prompt"])
            start = time.perf_counter()
            async with semaphore:
                try:
                    image_bytes = await self._generate_image_bytes(
                        prompt=prompt,
                        image_model=image_model,
                        quality=quality,
                        parent_image_bytes=parent_image_bytes,
                    )
                    commit_id = self.repository.reserve_commit_id()
                    image_url = self.repository.upload_commit_image(
                        commit_id=commit_id,
                        filename="img_01.png",
                        payload=image_bytes,
                    )
                    self.repository.create_commit(
                        commit_id=commit_id,
                        project_id=project_id,
                        prompt=prompt,
                        model=image_model,
                        seed=None,
                        parent_commit_id=parent_commit_id,
                        image_paths=[image_url],
                        status="success",
                        error=None,
                    )
                    image_bytes_by_variant[variant_id] = image_bytes
                    self._update_variant(
                        run_id,
                        variant_id,
                        {
                            "status": "generated",
                            "commit_id": commit_id,
                            "parent_commit_id": parent_commit_id,
                            "image_url": image_url,
                            "generation_latency_ms": int((time.perf_counter() - start) * 1000),
                        },
                    )
                    self._update_progress(run_id, generated_increment=1)
                except Exception as exc:
                    self._mark_degraded(run_id)
                    commit_id = self.repository.reserve_commit_id()
                    self.repository.create_commit(
                        commit_id=commit_id,
                        project_id=project_id,
                        prompt=prompt,
                        model=image_model,
                        seed=None,
                        parent_commit_id=parent_commit_id,
                        image_paths=[],
                        status="failed",
                        error=f"{ErrorCode.OPENAI_UPSTREAM_ERROR.value}: {exc}",
                    )
                    self._update_variant(
                        run_id,
                        variant_id,
                        {
                            "status": "generation_failed",
                            "commit_id": commit_id,
                            "parent_commit_id": parent_commit_id,
                            "generation_latency_ms": int((time.perf_counter() - start) * 1000),
                            "error": str(exc),
                        },
                    )
                    self._update_progress(run_id, generated_increment=1, failed_increment=1)

        await asyncio.gather(*(worker(item) for item in variants))
        return image_bytes_by_variant

    async def _generate_image_bytes(
        self,
        *,
        prompt: str,
        image_model: str,
        quality: str,
        parent_image_bytes: bytes | None,
    ) -> bytes:
        if not self.settings.openai_api_key:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OPENAI_API_KEY is missing.",
                status_code=502,
            )

        model_name = image_model.strip() or self.settings.openai_image_model
        is_gpt_image = model_name.lower().startswith("gpt-image")
        payload: dict[str, Any] = {"model": model_name, "prompt": prompt, "size": "1024x1024", "n": 1}
        if is_gpt_image:
            payload["quality"] = quality
        if not is_gpt_image:
            payload["response_format"] = "b64_json"

        try:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                if parent_image_bytes is None:
                    response = await client.post(
                        "https://api.openai.com/v1/images/generations",
                        json=payload,
                        headers={
                            "Authorization": f"Bearer {self.settings.openai_api_key}",
                            "Content-Type": "application/json",
                        },
                    )
                else:
                    edit_data: dict[str, str] = {
                        "model": model_name,
                        "prompt": prompt,
                        "size": "1024x1024",
                        "n": "1",
                    }
                    if is_gpt_image:
                        edit_data["quality"] = quality
                    response = await client.post(
                        "https://api.openai.com/v1/images/edits",
                        data=edit_data,
                        files={"image": ("parent.png", parent_image_bytes, "image/png")},
                        headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
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
            detail = ""
            try:
                payload_json = response.json()
                if isinstance(payload_json, dict):
                    detail = f" - {payload_json.get('error', {}).get('message', '')}".rstrip()
            except Exception:
                detail = ""
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

        item = data[0] if isinstance(data[0], dict) else {}
        b64_json = item.get("b64_json")
        if isinstance(b64_json, str) and b64_json:
            return base64.b64decode(b64_json)

        image_url = item.get("url")
        if isinstance(image_url, str) and image_url:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                downloaded = await client.get(
                    image_url,
                    headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                )
                downloaded.raise_for_status()
                return downloaded.content

        raise ApiError(
            ErrorCode.OPENAI_UPSTREAM_ERROR,
            "Image generation returned neither b64_json nor URL.",
            status_code=502,
        )

    def _first_image_ref(self, image_paths: list[str]) -> str | None:
        for image_ref in image_paths:
            if isinstance(image_ref, str) and image_ref.strip():
                return image_ref.strip()
        return None

    async def _resolve_image_ref_bytes(self, image_ref: str) -> bytes:
        if image_ref.startswith("http://") or image_ref.startswith("https://"):
            return await self._download_image_bytes(image_ref)

        local_path = self._resolve_local_image_path(image_ref)
        if local_path is not None:
            try:
                return local_path.read_bytes()
            except OSError as exc:
                raise ApiError(
                    ErrorCode.OPENAI_UPSTREAM_ERROR,
                    f"Failed to read parent image artifact: {exc}",
                    status_code=502,
                ) from exc

        remote_url = self._resolve_remote_image_url(image_ref)
        if remote_url is not None:
            return await self._download_image_bytes(remote_url)

        raise ApiError(
            ErrorCode.OPENAI_UPSTREAM_ERROR,
            f"Unable to resolve image reference '{image_ref}'.",
            status_code=502,
        )

    def _resolve_local_image_path(self, image_ref: str) -> Path | None:
        cleaned = image_ref.strip()
        if not cleaned:
            return None

        candidates: list[Path] = []
        raw_path = Path(cleaned)
        if raw_path.is_absolute():
            candidates.append(raw_path)
        else:
            candidates.append((Path.cwd() / raw_path).resolve())
            candidates.append((self.settings.app_image_dir / raw_path).resolve())

        normalized = cleaned.lstrip("/")
        if normalized.startswith("images/"):
            nested = normalized.split("/", 1)[1]
            candidates.append((self.settings.app_image_dir / nested).resolve())

        seen: set[Path] = set()
        for path in candidates:
            if path in seen:
                continue
            seen.add(path)
            if path.exists() and path.is_file():
                return path
        return None

    def _resolve_remote_image_url(self, image_ref: str) -> str | None:
        cleaned = image_ref.strip()
        if not cleaned:
            return None
        if cleaned.startswith("/storage/v1/") or cleaned.startswith("storage/v1/"):
            if self.settings.supabase_url:
                return f"{self.settings.supabase_url.rstrip('/')}/{cleaned.lstrip('/')}"
        return None

    async def _download_image_bytes(self, image_url: str) -> bytes:
        try:
            async with httpx.AsyncClient(timeout=self.settings.openai_timeout_seconds) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                return response.content
        except httpx.TimeoutException as exc:
            raise ApiError(
                ErrorCode.OPENAI_TIMEOUT,
                "Timed out downloading image artifact.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"Failed to download image artifact: {exc}",
                status_code=502,
            ) from exc

    async def _evaluate_images(
        self,
        *,
        run_id: str,
        variants: list[dict[str, Any]],
        images_by_variant: dict[str, bytes],
        base_prompt: str,
        objective_preset: str,
        constraints: dict[str, list[str]],
    ) -> None:
        semaphore = asyncio.Semaphore(4)

        async def worker(variant: dict[str, Any]) -> None:
            variant_id = str(variant["variant_id"])
            image_bytes = images_by_variant.get(variant_id)
            if image_bytes is None:
                self._update_variant(
                    run_id,
                    variant_id,
                    {
                        "status": "evaluation_skipped",
                        "failure_tags": ["generation_failed"],
                        "rationale": "Evaluation skipped because image generation failed.",
                    },
                )
                return

            start = time.perf_counter()
            async with semaphore:
                try:
                    rubric = await self._evaluate_with_openai(
                        base_prompt=base_prompt,
                        variant_prompt=str(variant["variant_prompt"]),
                        objective_preset=objective_preset,
                        constraints=constraints,
                        image_bytes=image_bytes,
                    )
                    score = self._composite_score(rubric)
                    self._update_variant(
                        run_id,
                        variant_id,
                        {
                            "status": "evaluated",
                            "judge_latency_ms": int((time.perf_counter() - start) * 1000),
                            "prompt_adherence": rubric["prompt_adherence"],
                            "subject_fidelity": rubric["subject_fidelity"],
                            "composition_quality": rubric["composition_quality"],
                            "style_coherence": rubric["style_coherence"],
                            "technical_artifact_penalty": rubric["technical_artifact_penalty"],
                            "confidence": rubric["confidence"],
                            "failure_tags": rubric["failure_tags"],
                            "strength_tags": rubric["strength_tags"],
                            "rationale": rubric["rationale"],
                            "composite_score": score,
                        },
                    )
                    self._update_progress(run_id, evaluated_increment=1)
                except Exception as exc:
                    self._mark_degraded(run_id)
                    fallback = {
                        "prompt_adherence": 0.5,
                        "subject_fidelity": 0.5,
                        "composition_quality": 0.5,
                        "style_coherence": 0.5,
                        "technical_artifact_penalty": 0.5,
                        "confidence": 0.25,
                        "failure_tags": ["evaluation_failed"],
                        "strength_tags": [],
                        "rationale": "Evaluation failed, assigned neutral fallback rubric.",
                    }
                    score = self._composite_score(fallback)
                    self._update_variant(
                        run_id,
                        variant_id,
                        {
                            "status": "evaluated_degraded",
                            "judge_latency_ms": int((time.perf_counter() - start) * 1000),
                            "prompt_adherence": fallback["prompt_adherence"],
                            "subject_fidelity": fallback["subject_fidelity"],
                            "composition_quality": fallback["composition_quality"],
                            "style_coherence": fallback["style_coherence"],
                            "technical_artifact_penalty": fallback["technical_artifact_penalty"],
                            "confidence": fallback["confidence"],
                            "failure_tags": fallback["failure_tags"],
                            "strength_tags": fallback["strength_tags"],
                            "rationale": f"{fallback['rationale']} ({exc})",
                            "composite_score": score,
                            "error": str(exc),
                        },
                    )
                    self._update_progress(run_id, evaluated_increment=1, failed_increment=1)

        await asyncio.gather(*(worker(item) for item in variants))

    async def _evaluate_with_openai(
        self,
        *,
        base_prompt: str,
        variant_prompt: str,
        objective_preset: str,
        constraints: dict[str, list[str]],
        image_bytes: bytes,
    ) -> dict[str, Any]:
        if not self.settings.openai_api_key:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OPENAI_API_KEY is missing.",
                status_code=502,
            )

        image_data_url = f"data:image/png;base64,{base64.b64encode(image_bytes).decode('ascii')}"
        must_include = constraints.get("must_include", [])
        must_avoid = constraints.get("must_avoid", [])

        system_text = (
            "You are a strict image quality evaluator. Return strict JSON only with keys: "
            "prompt_adherence, subject_fidelity, composition_quality, style_coherence, "
            "technical_artifact_penalty, confidence, failure_tags, strength_tags, rationale. "
            "All score fields must be float 0..1. failure_tags and strength_tags must be arrays of short strings."
        )
        user_text = (
            f"Base prompt: {base_prompt}\n"
            f"Variant prompt: {variant_prompt}\n"
            f"Objective preset: {objective_preset}\n"
            f"Must include: {must_include}\n"
            f"Must avoid: {must_avoid}\n"
            "Evaluate the image against this prompt intent."
        )

        raw_text = await self._call_responses_text(
            model=self.settings.openai_vision_model,
            input_messages=[
                {"role": "system", "content": [{"type": "input_text", "text": system_text}]},
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": user_text},
                        {"type": "input_image", "image_url": image_data_url},
                    ],
                },
            ],
        )
        payload = self._extract_json(raw_text)
        failure_tags_raw = payload.get("failure_tags", [])
        strength_tags_raw = payload.get("strength_tags", [])

        failure_tags = (
            [str(item).strip() for item in failure_tags_raw if str(item).strip()] if isinstance(failure_tags_raw, list) else []
        )
        strength_tags = (
            [str(item).strip() for item in strength_tags_raw if str(item).strip()] if isinstance(strength_tags_raw, list) else []
        )

        return {
            "prompt_adherence": self._clamp01(payload.get("prompt_adherence", 0.0)),
            "subject_fidelity": self._clamp01(payload.get("subject_fidelity", 0.0)),
            "composition_quality": self._clamp01(payload.get("composition_quality", 0.0)),
            "style_coherence": self._clamp01(payload.get("style_coherence", 0.0)),
            "technical_artifact_penalty": self._clamp01(payload.get("technical_artifact_penalty", 1.0)),
            "confidence": self._clamp01(payload.get("confidence", 0.0)),
            "failure_tags": failure_tags[:8],
            "strength_tags": strength_tags[:8],
            "rationale": str(payload.get("rationale", "No rationale returned.")).strip(),
        }

    def _composite_score(self, rubric: dict[str, Any]) -> float:
        score = (
            0.35 * float(rubric.get("prompt_adherence", 0.0))
            + 0.20 * float(rubric.get("subject_fidelity", 0.0))
            + 0.20 * float(rubric.get("composition_quality", 0.0))
            + 0.15 * float(rubric.get("style_coherence", 0.0))
            - 0.10 * float(rubric.get("technical_artifact_penalty", 1.0))
        )
        return round(score, 4)

    def _rank_variants(self, variants: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
        ranked = [copy.deepcopy(item) for item in variants if item.get("status") in {"evaluated", "evaluated_degraded"}]

        def hard_rule_violations(item: dict[str, Any]) -> int:
            tags = [str(tag).lower() for tag in item.get("failure_tags", [])]
            return sum(1 for tag in tags if "artifact" in tag or "watermark" in tag or "limb" in tag)

        ranked.sort(
            key=lambda item: (
                float(item.get("composite_score", 0.0)),
                float(item.get("confidence", 0.0)),
                -float(item.get("technical_artifact_penalty", 1.0)),
                -hard_rule_violations(item),
            ),
            reverse=True,
        )

        for index, item in enumerate(ranked):
            item["rank"] = index + 1

        top_k = [str(item.get("variant_id")) for item in ranked[:3]]
        return ranked, top_k

    async def _generate_suggestions(
        self,
        *,
        base_prompt: str,
        objective_preset: str,
        leaderboard: list[dict[str, Any]],
    ) -> dict[str, dict[str, str]]:
        if not leaderboard:
            return self._fallback_suggestions(base_prompt, objective_preset, [])

        try:
            suggestion_payload = await self._generate_suggestions_with_openai(
                base_prompt=base_prompt,
                objective_preset=objective_preset,
                leaderboard=leaderboard,
            )
            if suggestion_payload:
                return suggestion_payload
        except Exception:
            pass
        return self._fallback_suggestions(base_prompt, objective_preset, leaderboard)

    async def _generate_suggestions_with_openai(
        self,
        *,
        base_prompt: str,
        objective_preset: str,
        leaderboard: list[dict[str, Any]],
    ) -> dict[str, dict[str, str]]:
        top = leaderboard[:3]
        bottom = leaderboard[-2:] if len(leaderboard) > 2 else leaderboard
        system_text = (
            "You rewrite image prompts using run outcomes. Return strict JSON only: "
            "{\"conservative\":{\"prompt_text\":\"...\",\"rationale\":\"...\"},"
            "\"balanced\":{\"prompt_text\":\"...\",\"rationale\":\"...\"},"
            "\"aggressive\":{\"prompt_text\":\"...\",\"rationale\":\"...\"}}"
        )
        user_text = (
            f"Base prompt: {base_prompt}\n"
            f"Objective preset: {objective_preset}\n"
            f"Top variants summary: {json.dumps(top)}\n"
            f"Bottom variants summary: {json.dumps(bottom)}\n"
            "Each suggestion must mention concrete strengths/failures from the summaries."
        )
        raw_text = await self._call_responses_text(
            model=self.settings.openai_text_model,
            input_messages=[
                {"role": "system", "content": [{"type": "input_text", "text": system_text}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_text}]},
            ],
        )
        parsed = self._extract_json(raw_text)

        def extract(kind: str) -> dict[str, str]:
            payload = parsed.get(kind, {})
            if not isinstance(payload, dict):
                return {"prompt_text": "", "rationale": ""}
            return {
                "prompt_text": str(payload.get("prompt_text", "")).strip(),
                "rationale": str(payload.get("rationale", "")).strip(),
            }

        suggestions = {
            "conservative": extract("conservative"),
            "balanced": extract("balanced"),
            "aggressive": extract("aggressive"),
        }
        if not all(suggestions[key]["prompt_text"] for key in suggestions):
            raise ValueError("Missing prompt_text in suggestion payload")
        return suggestions

    def _fallback_suggestions(
        self,
        base_prompt: str,
        objective_preset: str,
        leaderboard: list[dict[str, Any]],
    ) -> dict[str, dict[str, str]]:
        top_prompt = str(leaderboard[0].get("variant_prompt")) if leaderboard else base_prompt
        top_strength = ""
        top_failure = ""
        if leaderboard:
            strengths = leaderboard[0].get("strength_tags", [])
            failures = leaderboard[-1].get("failure_tags", [])
            if strengths:
                top_strength = str(strengths[0])
            if failures:
                top_failure = str(failures[0])

        conservative_prompt = top_prompt or base_prompt
        balanced_prompt = (
            f"{top_prompt}. Improve composition clarity and subject fidelity while preserving intent."
            if top_prompt
            else f"{base_prompt}. Improve composition clarity and subject fidelity."
        )
        aggressive_prompt = (
            f"{base_prompt}. Dramatically rework camera angle, lighting direction, and style treatment "
            "for higher visual impact while preserving the core subject."
        )

        return {
            "conservative": {
                "prompt_text": conservative_prompt,
                "rationale": (
                    f"Keep best-performing structure from the top variant"
                    + (f" and preserve strength: {top_strength}." if top_strength else ".")
                ),
            },
            "balanced": {
                "prompt_text": balanced_prompt,
                "rationale": (
                    f"Blend top strengths with targeted fixes"
                    + (f" for failure tag: {top_failure}." if top_failure else ".")
                ),
            },
            "aggressive": {
                "prompt_text": aggressive_prompt,
                "rationale": (
                    f"Explore a higher-variance rewrite tuned for objective '{objective_preset}' while keeping core intent."
                ),
            },
        }

    async def _call_responses_text(self, *, model: str, input_messages: list[dict[str, Any]]) -> str:
        if not self.settings.openai_api_key:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OPENAI_API_KEY is missing.",
                status_code=502,
            )

        payload = {
            "model": model,
            "input": input_messages,
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
                "OpenAI responses request timed out.",
                status_code=504,
            ) from exc
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"OpenAI responses upstream HTTP error: {exc}",
                status_code=502,
            ) from exc

        if response.status_code >= 500:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                "OpenAI responses upstream server error.",
                status_code=502,
            )
        if response.status_code >= 400:
            raise ApiError(
                ErrorCode.OPENAI_UPSTREAM_ERROR,
                f"OpenAI responses request failed ({response.status_code}).",
                status_code=502,
            )

        payload_json = response.json()
        output_text = payload_json.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text

        output = payload_json.get("output", [])
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
            "OpenAI responses output did not contain text.",
            status_code=502,
        )

    def _extract_json(self, raw_text: str) -> dict[str, Any]:
        text = raw_text.strip()
        if text.startswith("{") and text.endswith("}"):
            return json.loads(text)
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found in model output.")
        return json.loads(match.group(0))

    def _clamp01(self, value: Any) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = 0.0
        return max(0.0, min(1.0, numeric))

    def _ignore_task_exception(self, task: asyncio.Task[Any]) -> None:
        try:
            task.result()
        except Exception:
            # Errors are recorded in run state for client retrieval.
            pass
