from __future__ import annotations

from enum import Enum

from fastapi import Request
from fastapi.responses import JSONResponse


class ErrorCode(str, Enum):
    INVALID_REQUEST = "INVALID_REQUEST"
    PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
    COMMIT_NOT_FOUND = "COMMIT_NOT_FOUND"
    BASELINE_NOT_SET = "BASELINE_NOT_SET"
    OPENAI_TIMEOUT = "OPENAI_TIMEOUT"
    OPENAI_UPSTREAM_ERROR = "OPENAI_UPSTREAM_ERROR"
    STORAGE_WRITE_FAILED = "STORAGE_WRITE_FAILED"
    COMPARE_PIPELINE_FAILED = "COMPARE_PIPELINE_FAILED"


class ApiError(Exception):
    def __init__(self, code: ErrorCode, message: str, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def error_response(
    *,
    code: ErrorCode,
    message: str,
    request_id: str,
    status_code: int,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code.value,
                "message": message,
                "request_id": request_id,
            }
        },
    )


def request_id_from_request(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str) and request_id:
        return request_id
    return "req_unknown"
