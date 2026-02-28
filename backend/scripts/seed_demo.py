from __future__ import annotations

import os
import shutil
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

from backend.app.core.config import get_settings
from backend.app.services.pixel_metrics import PixelMetricsService
from backend.app.services.scoring import compute_drift_score, compute_verdict
from backend.app.storage.repository import Repository
from backend.app.storage.schemas import ComparisonReportRecord, utc_now_iso


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _encode_png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _save_image_atomic(repository: Repository, path: Path, payload: bytes) -> None:
    repository.store.atomic_write_bytes(path, payload)


def _create_demo_image(variant: int) -> Image.Image:
    img = Image.new("RGB", (512, 512), color=(28 + variant * 6, 32 + variant * 5, 40 + variant * 7))
    draw = ImageDraw.Draw(img)

    # Basic portrait silhouette with deterministic drift across variants.
    draw.ellipse((120, 80, 392, 352), fill=(205, 178 - variant * 8, 160 - variant * 5))
    draw.rectangle((175 + variant * 5, 335, 335 + variant * 6, 470), fill=(60 + variant * 8, 70, 88))
    draw.ellipse((200, 170, 240, 210), fill=(20, 20, 20))
    draw.ellipse((275, 170, 315, 210), fill=(20, 20, 20))
    draw.arc((215, 240, 300, 290), start=0, end=180, fill=(95, 25, 25), width=4)

    if variant >= 2:
        draw.polygon([(60, 500), (512, 380), (512, 512)], fill=(130, 96, 62))
    if variant >= 3:
        draw.rectangle((0, 0, 512, 95), fill=(72, 98, 142))

    return img


def main() -> None:
    settings = get_settings()
    reset_storage = _env_flag("SEED_DEMO_RESET", default=False)

    repository = Repository(settings)
    if not reset_storage and repository.list_projects():
        print("Seed skipped: existing project data found. Set SEED_DEMO_RESET=true to force reseed.")
        return

    if reset_storage:
        # Full reseed mode intentionally wipes previous records and artifacts.
        for directory in [settings.app_image_dir, settings.app_artifact_dir]:
            if directory.exists():
                shutil.rmtree(directory)
        repository.reset_storage()

    settings.ensure_directories()
    pixel_service = PixelMetricsService()

    project_id = "default"
    repository.ensure_project(project_id)

    commit_ids: list[str] = []
    for variant, commit_id in enumerate(["c0001", "c0002", "c0003"], start=1):
        parent_commit_id = commit_ids[-1] if commit_ids else None
        commit_ids.append(commit_id)

        image = _create_demo_image(variant)
        image_bytes = _encode_png_bytes(image)
        image_path = settings.app_image_dir / commit_id / "img_01.png"
        _save_image_atomic(repository, image_path, image_bytes)
        image_url = repository.upload_commit_image(
            commit_id=commit_id,
            filename="img_01.png",
            payload=image_bytes,
        )

        repository.create_commit(
            commit_id=commit_id,
            project_id=project_id,
            prompt=f"demo prompt variant {variant}",
            model=settings.openai_image_model,
            seed=str(1000 + variant),
            parent_commit_id=parent_commit_id,
            image_paths=[image_url],
            status="success",
            error=None,
        )

    repository.set_baseline(project_id=project_id, commit_id=commit_ids[0])

    threshold = repository.get_config().threshold
    baseline_image = settings.app_image_dir / commit_ids[0] / "img_01.png"

    compare_specs = [
        {
            "candidate_id": commit_ids[1],
            "semantic": 0.87,
            "vision": 0.31,
            "explanation": {
                "facial_structure_changed": False,
                "lighting_shift": "moderate",
                "style_drift": "low",
                "notes": "Lighting changed slightly while character identity remained stable.",
            },
        },
        {
            "candidate_id": commit_ids[2],
            "semantic": 0.64,
            "vision": 0.63,
            "explanation": {
                "facial_structure_changed": True,
                "lighting_shift": "high",
                "style_drift": "moderate",
                "notes": "Composition and facial proportions shifted in the candidate image.",
            },
        },
    ]

    for index, spec in enumerate(compare_specs, start=1):
        report_id = f"r{index:04d}"
        artifact_dir = settings.app_artifact_dir / report_id
        candidate_image = settings.app_image_dir / spec["candidate_id"] / "img_01.png"

        pixel = pixel_service.compare(
            baseline_image_path=baseline_image,
            candidate_image_path=candidate_image,
            artifact_dir=artifact_dir,
        )

        drift_score = compute_drift_score(
            pixel_diff_score=pixel.pixel_diff_score,
            semantic_similarity=spec["semantic"],
            vision_structural_score=spec["vision"],
        )

        verdict = compute_verdict(
            drift_score=drift_score,
            threshold=threshold,
            degraded=False,
            pixel_diff_score=pixel.pixel_diff_score,
            semantic_available=True,
            vision_available=True,
        )

        report = ComparisonReportRecord(
            report_id=report_id,
            project_id=project_id,
            baseline_commit_id=commit_ids[0],
            candidate_commit_id=spec["candidate_id"],
            pixel_diff_score=round(pixel.pixel_diff_score, 4),
            semantic_similarity=round(float(spec["semantic"]), 4),
            vision_structural_score=round(float(spec["vision"]), 4),
            drift_score=round(float(drift_score), 4),
            threshold=round(float(threshold), 4),
            verdict=verdict,
            degraded=False,
            explanation=spec["explanation"],
            artifacts={
                "diff_heatmap": pixel.diff_heatmap_path,
                "overlay": pixel.overlay_path,
            },
            created_at=utc_now_iso(),
        )
        repository.create_comparison_report(report)

    print("Seed complete")
    print(f"project_id={project_id}")
    print(f"baseline_commit_id={commit_ids[0]}")
    print(f"commits={', '.join(commit_ids)}")


if __name__ == "__main__":
    main()
