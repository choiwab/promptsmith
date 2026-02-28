from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from backend.app.services.generation_service import GenerationService

router = APIRouter(tags=["generate"])


class GenerateRequest(BaseModel):
    project_id: str = Field(min_length=1)
    prompt: str = Field(min_length=5)
    model: str = Field(min_length=1)
    seed: str | None = None


class GenerateResponse(BaseModel):
    commit_id: str
    status: str
    image_paths: list[str]
    created_at: str


@router.post("/generate", response_model=GenerateResponse)
async def generate(payload: GenerateRequest, request: Request) -> GenerateResponse:
    service: GenerationService = request.app.state.generation_service
    commit = await service.generate(
        project_id=payload.project_id,
        prompt=payload.prompt,
        model=payload.model,
        seed=payload.seed,
    )
    return GenerateResponse(
        commit_id=commit.commit_id,
        status=commit.status,
        image_paths=commit.image_paths,
        created_at=commit.created_at,
    )
