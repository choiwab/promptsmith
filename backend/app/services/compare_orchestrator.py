from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any

import httpx

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError, ErrorCode
from backend.app.services.pixel_metrics import PixelMetricsService
from backend.app.services.scoring import compute_drift_score, compute_verdict
from backend.app.services.semantic_metrics import SemanticMetricsService
from backend.app.services.vision_evaluator import VisionEvaluatorService
from backend.app.storage.repository import Repository
from backend.app.storage.schemas import ComparisonReportRecord, utc_now_iso


class CompareOrchestrator:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: Repository,
        pixel_service: PixelMetricsService,
        semantic_service: SemanticMetricsService,
        vision_service: VisionEvaluatorService,
    ):
        self.settings = settings
        self.repository = repository
        self.pixel_service = pixel_service
        self.semantic_service = semantic_service
        self.vision_service = vision_service

    async def compare(self, *, project_id: str, candidate_commit_id: str) -> ComparisonReportRecord:
        project = self.repository.get_project(project_id)
        baseline_commit_id = project.active_baseline_commit_id
        if not baseline_commit_id:
            raise ApiError(
                ErrorCode.BASELINE_NOT_SET,
                "Set a baseline before comparing commits.",
                status_code=400,
            )

        baseline_commit = self.repository.get_commit(baseline_commit_id, project_id=project_id)
        candidate_commit = self.repository.get_commit(candidate_commit_id, project_id=project_id)

        baseline_path = self._resolve_commit_image_path(baseline_commit.image_paths)
        candidate_path = self._resolve_commit_image_path(candidate_commit.image_paths)

        report_id = self.repository.reserve_report_id()
        artifact_dir = self.settings.app_artifact_dir / report_id
        threshold = self.repository.get_config().threshold

        pixel_task = asyncio.create_task(
            asyncio.to_thread(
                self.pixel_service.compare,
                baseline_image_path=baseline_path,
                candidate_image_path=candidate_path,
                artifact_dir=artifact_dir,
            )
        )
        semantic_task = asyncio.create_task(
            self.semantic_service.evaluate(
                baseline_image_path=baseline_path,
                candidate_image_path=candidate_path,
            )
        )
        vision_task = asyncio.create_task(
            self.vision_service.evaluate(
                baseline_image_path=baseline_path,
                candidate_image_path=candidate_path,
            )
        )

        pixel_result, semantic_result, vision_result = await asyncio.gather(
            pixel_task,
            semantic_task,
            vision_task,
            return_exceptions=True,
        )

        if isinstance(pixel_result, Exception):
            raise ApiError(
                ErrorCode.COMPARE_PIPELINE_FAILED,
                f"Pixel comparison failed: {pixel_result}",
                status_code=500,
            )

        semantic_available = not isinstance(semantic_result, Exception)
        vision_available = not isinstance(vision_result, Exception)
        degraded = not semantic_available or not vision_available

        semantic_similarity = float(semantic_result) if semantic_available else 0.5

        explanation: dict[str, Any] = {
            "facial_structure_changed": False,
            "lighting_shift": "moderate",
            "style_drift": "moderate",
            "notes": "Vision signal unavailable.",
        }
        vision_structural_score = 0.5

        if vision_available:
            assert isinstance(vision_result, dict)
            explanation = {
                "facial_structure_changed": bool(vision_result.get("facial_structure_changed", False)),
                "lighting_shift": str(vision_result.get("lighting_shift", "moderate")),
                "style_drift": str(vision_result.get("style_drift", "moderate")),
                "notes": str(vision_result.get("notes", "Model-evaluated structural comparison.")),
            }
            vision_structural_score = float(vision_result.get("vision_structural_score", 0.5))

        drift_score = compute_drift_score(
            pixel_diff_score=pixel_result.pixel_diff_score,
            semantic_similarity=semantic_similarity,
            vision_structural_score=vision_structural_score,
        )

        verdict = compute_verdict(
            drift_score=drift_score,
            threshold=threshold,
            degraded=degraded,
            pixel_diff_score=pixel_result.pixel_diff_score,
            semantic_available=semantic_available,
            vision_available=vision_available,
        )

        if degraded:
            missing_parts: list[str] = []
            if not semantic_available:
                missing_parts.append("semantic")
            if not vision_available:
                missing_parts.append("vision")
            missing = ", ".join(missing_parts)
            explanation["notes"] = f"Degraded compare: missing {missing} signal(s)."

        report = ComparisonReportRecord(
            report_id=report_id,
            project_id=project_id,
            baseline_commit_id=baseline_commit_id,
            candidate_commit_id=candidate_commit_id,
            pixel_diff_score=round(pixel_result.pixel_diff_score, 4),
            semantic_similarity=round(semantic_similarity, 4),
            vision_structural_score=round(vision_structural_score, 4),
            drift_score=round(drift_score, 4),
            threshold=round(float(threshold), 4),
            verdict=verdict,
            degraded=degraded,
            explanation=explanation,
            artifacts={
                "diff_heatmap": pixel_result.diff_heatmap_path,
                "overlay": pixel_result.overlay_path,
            },
            created_at=utc_now_iso(),
        )

        return self.repository.create_comparison_report(report)

    def _resolve_commit_image_path(self, image_paths: list[str]) -> Path:
        if not image_paths:
            raise ApiError(
                ErrorCode.COMMIT_NOT_FOUND,
                "Commit does not have any image artifacts.",
                status_code=404,
            )

        first = image_paths[0]
        if first.startswith("http://") or first.startswith("https://"):
            return self._download_remote_image(first)

        path = Path(first)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()

        if not path.exists():
            raise ApiError(
                ErrorCode.COMPARE_PIPELINE_FAILED,
                f"Image artifact is missing at {path}.",
                status_code=500,
            )

        return path

    def _download_remote_image(self, image_url: str) -> Path:
        digest = hashlib.sha1(image_url.encode("utf-8")).hexdigest()
        cache_path = self.settings.app_data_dir / "remote_image_cache" / f"{digest}.png"

        if cache_path.exists():
            return cache_path

        try:
            response = httpx.get(image_url, timeout=self.settings.openai_timeout_seconds)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ApiError(
                ErrorCode.COMPARE_PIPELINE_FAILED,
                f"Failed to fetch remote image artifact: {exc}",
                status_code=500,
            ) from exc

        self.repository.store.atomic_write_bytes(cache_path, response.content)
        return cache_path
