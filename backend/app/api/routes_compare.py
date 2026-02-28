from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.app.services.compare_orchestrator import CompareOrchestrator

router = APIRouter(tags=["compare"])


class CompareRequest(BaseModel):
    project_id: str = Field(min_length=1)
    candidate_commit_id: str = Field(min_length=1)


class CompareScores(BaseModel):
    pixel_diff_score: float
    semantic_similarity: float
    vision_structural_score: float
    drift_score: float
    threshold: float


class CompareExplanation(BaseModel):
    facial_structure_changed: bool
    lighting_shift: str
    style_drift: str
    notes: str


class CompareArtifacts(BaseModel):
    diff_heatmap: str
    overlay: str


class CompareResponse(BaseModel):
    report_id: str
    baseline_commit_id: str
    candidate_commit_id: str
    scores: CompareScores
    verdict: Literal["pass", "fail", "inconclusive"]
    degraded: bool
    explanation: CompareExplanation
    artifacts: CompareArtifacts


@router.post("/compare", response_model=CompareResponse)
async def compare(payload: CompareRequest, request: Request) -> CompareResponse:
    service: CompareOrchestrator = request.app.state.compare_orchestrator

    report = await service.compare(
        project_id=payload.project_id,
        candidate_commit_id=payload.candidate_commit_id,
    )

    return CompareResponse(
        report_id=report.report_id,
        baseline_commit_id=report.baseline_commit_id,
        candidate_commit_id=report.candidate_commit_id,
        scores=CompareScores(
            pixel_diff_score=report.pixel_diff_score,
            semantic_similarity=report.semantic_similarity,
            vision_structural_score=report.vision_structural_score,
            drift_score=report.drift_score,
            threshold=report.threshold,
        ),
        verdict=report.verdict,
        degraded=report.degraded,
        explanation=CompareExplanation(
            facial_structure_changed=bool(report.explanation.get("facial_structure_changed", False)),
            lighting_shift=str(report.explanation.get("lighting_shift", "moderate")),
            style_drift=str(report.explanation.get("style_drift", "moderate")),
            notes=str(report.explanation.get("notes", "")),
        ),
        artifacts=CompareArtifacts(
            diff_heatmap=report.artifacts.get("diff_heatmap", ""),
            overlay=report.artifacts.get("overlay", ""),
        ),
    )
