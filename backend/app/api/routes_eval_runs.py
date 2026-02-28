from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.app.services.eval_pipeline_service import EvalPipelineService

router = APIRouter(tags=["eval-runs"])


class EvalConstraints(BaseModel):
    must_include: list[str] = Field(default_factory=list)
    must_avoid: list[str] = Field(default_factory=list)


class CreateEvalRunRequest(BaseModel):
    project_id: str = Field(min_length=1)
    base_prompt: str = Field(min_length=5)
    objective_preset: Literal["adherence", "aesthetic", "product"] = "adherence"
    image_model: str = Field(default="gpt-image-1-mini", min_length=1)
    n_variants: int = Field(default=6, ge=4, le=8)
    quality: Literal["low", "medium", "high"] = "medium"
    parent_commit_id: str | None = None
    constraints: EvalConstraints = Field(default_factory=EvalConstraints)


class EvalProgressResponse(BaseModel):
    total_variants: int
    generated_variants: int
    evaluated_variants: int
    failed_variants: int


class EvalSuggestionResponse(BaseModel):
    prompt_text: str
    rationale: str


class EvalVariantResponse(BaseModel):
    variant_id: str
    variant_prompt: str
    mutation_tags: list[str] = Field(default_factory=list)
    parent_commit_id: str | None = None
    status: str
    generation_latency_ms: int | None = None
    judge_latency_ms: int | None = None
    commit_id: str | None = None
    image_url: str | None = None
    rationale: str
    confidence: float
    prompt_adherence: float
    subject_fidelity: float
    composition_quality: float
    style_coherence: float
    technical_artifact_penalty: float
    strength_tags: list[str] = Field(default_factory=list)
    failure_tags: list[str] = Field(default_factory=list)
    composite_score: float
    rank: int | None = None
    error: str | None = None


class EvalRunResponse(BaseModel):
    run_id: str
    project_id: str
    base_prompt: str
    parent_commit_id: str | None = None
    anchor_commit_id: str | None = None
    objective_preset: str
    image_model: str
    n_variants: int
    quality: str
    constraints: EvalConstraints
    status: str
    stage: str
    degraded: bool
    error: str | None = None
    progress: EvalProgressResponse
    variants: list[EvalVariantResponse] = Field(default_factory=list)
    leaderboard: list[EvalVariantResponse] = Field(default_factory=list)
    top_k: list[str] = Field(default_factory=list)
    suggestions: dict[str, EvalSuggestionResponse]
    created_at: str
    updated_at: str
    completed_at: str | None = None


def _to_response(run: dict) -> EvalRunResponse:
    return EvalRunResponse.model_validate(run)


@router.post("/eval-runs", response_model=EvalRunResponse)
async def create_eval_run(payload: CreateEvalRunRequest, request: Request) -> EvalRunResponse:
    service: EvalPipelineService = request.app.state.eval_pipeline_service
    run = await service.create_run(
        project_id=payload.project_id,
        base_prompt=payload.base_prompt,
        objective_preset=payload.objective_preset,
        image_model=payload.image_model,
        n_variants=payload.n_variants,
        quality=payload.quality,
        constraints=payload.constraints.model_dump(),
        parent_commit_id=payload.parent_commit_id,
    )
    return _to_response(run)


@router.get("/eval-runs/{run_id}", response_model=EvalRunResponse)
async def get_eval_run(run_id: str, request: Request) -> EvalRunResponse:
    service: EvalPipelineService = request.app.state.eval_pipeline_service
    return _to_response(service.get_run(run_id))
