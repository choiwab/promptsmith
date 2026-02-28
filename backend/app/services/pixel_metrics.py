from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from backend.app.core.config import to_relative_path


@dataclass
class PixelMetricsResult:
    pixel_diff_score: float
    diff_heatmap_path: str
    overlay_path: str


class PixelMetricsService:
    def compare(
        self,
        *,
        baseline_image_path: Path,
        candidate_image_path: Path,
        artifact_dir: Path,
    ) -> PixelMetricsResult:
        baseline = Image.open(baseline_image_path).convert("RGB")
        candidate = Image.open(candidate_image_path).convert("RGB")

        if candidate.size != baseline.size:
            candidate = candidate.resize(baseline.size, Image.Resampling.LANCZOS)

        baseline_np = np.asarray(baseline, dtype=np.float32) / 255.0
        candidate_np = np.asarray(candidate, dtype=np.float32) / 255.0

        diff_map = np.abs(baseline_np - candidate_np).mean(axis=2)

        ssim_score = self._global_ssim(
            baseline_np.mean(axis=2),
            candidate_np.mean(axis=2),
        )
        ssim_diff = self._clamp01(1.0 - ssim_score)

        hist_distance = self._histogram_distance(baseline_np, candidate_np)

        pixel_diff_score = self._clamp01(0.65 * ssim_diff + 0.35 * hist_distance)

        artifact_dir.mkdir(parents=True, exist_ok=True)
        heatmap_path = artifact_dir / "diff_heatmap.png"
        overlay_path = artifact_dir / "overlay.png"

        heatmap_image = self._create_heatmap(diff_map)
        heatmap_image.save(heatmap_path)

        overlay = Image.blend(baseline, heatmap_image, alpha=0.40)
        overlay.save(overlay_path)

        return PixelMetricsResult(
            pixel_diff_score=round(pixel_diff_score, 4),
            diff_heatmap_path=to_relative_path(heatmap_path),
            overlay_path=to_relative_path(overlay_path),
        )

    def _global_ssim(self, x: np.ndarray, y: np.ndarray) -> float:
        c1 = 0.01 * 0.01
        c2 = 0.03 * 0.03

        mu_x = float(x.mean())
        mu_y = float(y.mean())

        sigma_x = float(((x - mu_x) ** 2).mean())
        sigma_y = float(((y - mu_y) ** 2).mean())
        sigma_xy = float(((x - mu_x) * (y - mu_y)).mean())

        numerator = (2.0 * mu_x * mu_y + c1) * (2.0 * sigma_xy + c2)
        denominator = (mu_x * mu_x + mu_y * mu_y + c1) * (sigma_x + sigma_y + c2)

        if denominator == 0:
            return 1.0

        return self._clamp01(numerator / denominator)

    def _histogram_distance(self, x: np.ndarray, y: np.ndarray) -> float:
        channel_scores: list[float] = []
        for channel in range(3):
            hist_x, _ = np.histogram(x[:, :, channel], bins=64, range=(0.0, 1.0), density=True)
            hist_y, _ = np.histogram(y[:, :, channel], bins=64, range=(0.0, 1.0), density=True)
            distance = 0.5 * np.abs(hist_x - hist_y).sum() / 64.0
            channel_scores.append(float(distance))

        return self._clamp01(sum(channel_scores) / len(channel_scores))

    def _create_heatmap(self, diff_map: np.ndarray) -> Image.Image:
        normalized = np.clip(diff_map, 0.0, 1.0)
        red = (normalized * 255).astype(np.uint8)
        green = np.zeros_like(red)
        blue = ((1.0 - normalized) * 70).astype(np.uint8)
        rgb = np.stack([red, green, blue], axis=2)
        return Image.fromarray(rgb, mode="RGB")

    def _clamp01(self, value: float) -> float:
        return max(0.0, min(1.0, value))
