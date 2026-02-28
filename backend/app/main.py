from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from backend.app.api.routes_baseline import router as baseline_router
from backend.app.api.routes_compare import router as compare_router
from backend.app.api.routes_generate import router as generate_router
from backend.app.api.routes_history import router as history_router
from backend.app.core.config import get_settings
from backend.app.core.errors import ApiError, ErrorCode, error_response, request_id_from_request
from backend.app.core.logging import configure_logging
from backend.app.services.compare_orchestrator import CompareOrchestrator
from backend.app.services.generation_service import GenerationService
from backend.app.services.pixel_metrics import PixelMetricsService
from backend.app.services.semantic_metrics import SemanticMetricsService
from backend.app.services.vision_evaluator import VisionEvaluatorService
from backend.app.storage.repository import Repository

configure_logging()
logger = logging.getLogger("promptsmith.backend")


def create_app() -> FastAPI:
    settings = get_settings()
    repository = Repository(settings)

    generation_service = GenerationService(settings=settings, repository=repository)
    compare_orchestrator = CompareOrchestrator(
        settings=settings,
        repository=repository,
        pixel_service=PixelMetricsService(),
        semantic_service=SemanticMetricsService(settings),
        vision_service=VisionEvaluatorService(settings),
    )

    app = FastAPI(title="Promptsmith Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    app.state.settings = settings
    app.state.repository = repository
    app.state.generation_service = generation_service
    app.state.compare_orchestrator = compare_orchestrator

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = f"req_{uuid.uuid4().hex[:8]}"
        request.state.request_id = request_id
        start = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.exception(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "extra_fields": {
                        "method": request.method,
                        "path": request.url.path,
                        "duration_ms": duration_ms,
                    },
                },
            )
            raise

        duration_ms = int((time.perf_counter() - start) * 1000)
        response.headers["x-request-id"] = request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "extra_fields": {
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            },
        )
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> Response:
        return error_response(
            code=exc.code,
            message=exc.message,
            request_id=request_id_from_request(request),
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> Response:
        details = "; ".join(err.get("msg", "invalid field") for err in exc.errors())
        message = f"Request validation failed: {details}" if details else "Invalid request payload."
        return error_response(
            code=ErrorCode.INVALID_REQUEST,
            message=message,
            request_id=request_id_from_request(request),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> Response:
        logger.exception(
            "unexpected_error",
            extra={"request_id": request_id_from_request(request)},
        )
        return error_response(
            code=ErrorCode.COMPARE_PIPELINE_FAILED,
            message="Unexpected backend error.",
            request_id=request_id_from_request(request),
            status_code=500,
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(generate_router)
    app.include_router(baseline_router)
    app.include_router(compare_router)
    app.include_router(history_router)

    return app


app = create_app()
