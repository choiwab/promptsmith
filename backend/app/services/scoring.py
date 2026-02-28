from __future__ import annotations


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def compute_drift_score(
    *,
    pixel_diff_score: float,
    semantic_similarity: float,
    vision_structural_score: float,
    semantic_weight: float = 0.40,
    pixel_weight: float = 0.30,
    vision_weight: float = 0.30,
) -> float:
    drift = (
        semantic_weight * (1.0 - semantic_similarity)
        + pixel_weight * pixel_diff_score
        + vision_weight * vision_structural_score
    )
    return clamp01(drift)


def compute_verdict(
    *,
    drift_score: float,
    threshold: float,
    degraded: bool,
    pixel_diff_score: float,
    semantic_available: bool,
    vision_available: bool,
) -> str:
    if degraded and (not semantic_available or not vision_available):
        if pixel_diff_score <= 0.70:
            return "inconclusive"
        return "fail"

    if drift_score <= threshold:
        return "pass"
    return "fail"
