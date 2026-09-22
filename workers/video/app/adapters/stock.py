from __future__ import annotations

import logging
import os
from typing import Any, Callable

from .base import AdapterUnavailable, GenerationRequest
from .media_tools import derive_keywords, fit_clip, ken_burns, orientation_for
from .stock_sources import (
    PexelsPhotos,
    PexelsVideos,
    PixabayPhotos,
    PixabayVideos,
    StockResult,
    StockUnavailable,
    download,
)


class StockAdapter:
    name = "stock"
    requires_gpu = False
    produces_ai_video = False

    def __init__(self) -> None:
        self.video_sources = [PexelsVideos(), PixabayVideos()]
        self.photo_sources = [PexelsPhotos(), PixabayPhotos()]
        self.last_attribution: dict[str, Any] | None = None

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        available = [source.name for source in self.video_sources if source.configured()]
        photos = [source.name for source in self.photo_sources if source.configured()]
        note = None
        if not available and not photos:
            note = (
                "Kein Stock-Anbieter eingerichtet. Trage PEXELS_API_KEY oder PIXABAY_API_KEY in die .env ein "
                "(beide kostenlos, Anleitung in docs/STOCK_FOOTAGE.md)."
            )
        return {
            "adapter": self.name,
            "producesAiVideo": False,
            "ready": bool(available or photos),
            "sourceKind": "stock",
            "providers": available,
            "photoFallback": photos,
            "note": note,
        }

    def _search(self, sources, queries: list[str], orientation: str, width: int, height: int, logger):
        errors: list[str] = []
        for query in queries:
            for source in sources:
                if not source.configured():
                    continue
                try:
                    found = source.search(query, orientation, width, height)
                except StockUnavailable as exc:
                    errors.append(f"{source.name}: {exc}")
                    continue
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{source.name}: {exc}")
                    continue
                if found:
                    logger.info(
                        "Stock-Treffer",
                        extra={"extra": {"query": query, "provider": found.provider, "author": found.author}},
                    )
                    return found, errors
        return None, errors

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str:
        configured = [s.name for s in self.video_sources + self.photo_sources if s.configured()]
        if not configured:
            raise AdapterUnavailable(
                "Kein Stock-Anbieter eingerichtet. Lege einen kostenlosen Schluessel unter PEXELS_API_KEY "
                "oder PIXABAY_API_KEY in der .env ab. Anleitung: docs/STOCK_FOOTAGE.md"
            )

        self.last_attribution = None
        keywords = derive_keywords(request.prompt, request.keywords)
        if not keywords:
            raise AdapterUnavailable("Aus dem Prompt liessen sich keine Suchbegriffe ableiten")

        orientation = request.stock_orientation or orientation_for(request.width, request.height)
        queries = [" ".join(keywords)]
        if len(keywords) > 1:
            queries.append(" ".join(keywords[:2]))
            queries.append(keywords[0])

        work_dir = os.path.dirname(request.output_path)
        report_progress(15.0, f"Suche Filmmaterial: {queries[0]}")

        found: StockResult | None
        found, errors = self._search(self.video_sources, queries, orientation, request.width, request.height, logger)

        used_photo = False
        if found is None:
            report_progress(30.0, "Kein Video gefunden, suche ein Foto")
            found, photo_errors = self._search(
                self.photo_sources, queries, orientation, request.width, request.height, logger
            )
            errors += photo_errors
            used_photo = found is not None

        if found is None:
            detail = f" Meldungen: {'; '.join(errors[:3])}" if errors else ""
            raise AdapterUnavailable(
                f"Kein passendes Stock-Material fuer '{queries[0]}' gefunden.{detail} "
                "Tipp: Stichwoerter im Skript konkreter fassen."
            )

        suffix = ".jpg" if used_photo else ".mp4"
        raw_path = os.path.join(work_dir, f"stock-{request.scene_index:02d}{suffix}")

        report_progress(50.0, f"Lade Material von {found.provider}")
        download(found.url, raw_path)

        report_progress(75.0, "Material wird auf das Zielformat gebracht")
        if used_photo:
            ken_burns(
                raw_path,
                request.output_path,
                request.width,
                request.height,
                request.fps,
                request.duration_sec,
                request.motion,
                request.motion_strength,
                request.scene_index,
            )
        else:
            fit_clip(
                raw_path,
                request.output_path,
                request.width,
                request.height,
                request.fps,
                request.duration_sec,
            )

        os.unlink(raw_path)

        self.last_attribution = {
            **found.to_meta(),
            "mediaType": "photo" if used_photo else "video",
            "query": queries[0],
        }

        report_progress(100.0, f"Szene fertig ({found.provider})")
        return request.output_path
