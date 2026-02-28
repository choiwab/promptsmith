from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None
    openai_image_model: str
    openai_text_model: str
    openai_vision_model: str
    app_data_dir: Path
    app_image_dir: Path
    app_artifact_dir: Path
    app_compare_threshold: float
    openai_timeout_seconds: float
    supabase_url: str | None
    supabase_service_role_key: str | None
    supabase_storage_bucket: str
    supabase_table_prefix: str
    supabase_schema: str

    def ensure_directories(self) -> None:
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        self.app_image_dir.mkdir(parents=True, exist_ok=True)
        self.app_artifact_dir.mkdir(parents=True, exist_ok=True)

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


def _parse_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    data_dir = Path(os.getenv("APP_DATA_DIR", "./data")).resolve()
    image_dir = Path(os.getenv("APP_IMAGE_DIR", "./images")).resolve()
    artifact_dir = Path(os.getenv("APP_ARTIFACT_DIR", "./artifacts")).resolve()

    return Settings(
        openai_api_key=os.getenv("OPENAI_API_KEY"),
        openai_image_model=os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1"),
        openai_text_model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4.1-mini"),
        openai_vision_model=os.getenv("OPENAI_VISION_MODEL", "gpt-4.1-mini"),
        app_data_dir=data_dir,
        app_image_dir=image_dir,
        app_artifact_dir=artifact_dir,
        app_compare_threshold=_parse_float("APP_COMPARE_THRESHOLD", 0.30),
        openai_timeout_seconds=_parse_float("OPENAI_TIMEOUT_SECONDS", 120.0),
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        supabase_storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "promptsmith-images"),
        supabase_table_prefix=os.getenv("SUPABASE_TABLE_PREFIX", "promptsmith_"),
        supabase_schema=os.getenv("SUPABASE_SCHEMA", "public"),
    )


def to_relative_path(path: Path) -> str:
    cwd = Path.cwd().resolve()
    resolved = path.resolve()
    try:
        return resolved.relative_to(cwd).as_posix()
    except ValueError:
        return resolved.as_posix()
