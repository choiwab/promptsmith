from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from backend.app.core.errors import ApiError, ErrorCode


class FileStore:
    def read_json(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def atomic_write_json(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
                json.dump(payload, temp_file, indent=2, ensure_ascii=True)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_path, path)
        except OSError as exc:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise ApiError(
                ErrorCode.STORAGE_WRITE_FAILED,
                f"Failed to persist file {path.name}: {exc}",
                status_code=500,
            ) from exc

    def atomic_write_bytes(self, path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as temp_file:
                temp_file.write(payload)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_path, path)
        except OSError as exc:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise ApiError(
                ErrorCode.STORAGE_WRITE_FAILED,
                f"Failed to persist binary {path.name}: {exc}",
                status_code=500,
            ) from exc
