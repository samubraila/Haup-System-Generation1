from __future__ import annotations

import logging
import os
from typing import Any, Callable

from .base import AdapterUnavailable, GenerationRequest
from .media_tools import derive_keywords, ken_burns, orientation_for
from .stock_sources import PexelsPhotos, PixabayPhotos, StockUnavailable, download

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


class SlideshowAdapter:
    name = "slideshow"
    requires_gpu = False
    produces_ai_video = False

    def __init__(self) -> None:
        self.photo_sources = [PexelsPhotos(), PixabayPhotos()]
        self.last_attribution: dict[str, Any] | None = None

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        available = [source.name for source in self.photo_sources if source.configured()]
        return {
            "adapter": self.name,
            "producesAiVideo": False,
            "ready": True,
            "sourceKind": "slideshow",
            "photoProviders": available,
            "note": (
                "Nutzt eigene Bilder aus der Mediathek. Ohne eigenes Bild wird ein Stock-Foto gesucht"
                + (" (eingerichtet)." if available else ", dafuer fehlt aber noch ein API-Key.")
            ),
        }

    def _pick_local_image(self, request: GenerationRequest) -> str | None:
        candidates = [
            path
            for path in request.image_paths
            if path and path.lower().endswith(IMAGE_SUFFIXES) and os.path.isfile(path)
        ]
        if not candidates:
            return None
        return candidates[request.scene_index % len(candidates)]

    def _fetch_stock_photo(self, request: GenerationRequest, work_dir: str, logger: logging.Logger) -> str | None:
        keywords = derive_keywords(request.prompt, request.keywords)
        if not keywords:
            return None

        orientation = request.stock_orientation or orientation_for(request.width, request.height)
        queries = [" ".join(keywords)]
        if len(keywords) > 1:
            queries.append(keywords[0])

        for query in queries:
            for source in self.photo_sources:
                if not source.configured():
                    continue
                try:
                    found = source.search(query, orientation, request.width, request.height)
                except (StockUnavailable, Exception) as exc:  # noqa: BLE001
                    logger.warning(
                        "Fotosuche fehlgeschlagen",
                        extra={"extra": {"source": source.name, "error": str(exc)}},
                    )
                    continue
                if not found:
                    continue

                target = os.path.join(work_dir, f"photo-{request.scene_index:02d}.jpg")
                download(found.url, target)
                self.last_attribution = {**found.to_meta(), "mediaType": "photo", "query": query}
                return target
        return None

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str:
        work_dir = os.path.dirname(request.output_path)
        self.last_attribution = None

        report_progress(15.0, "Bild wird ausgewaehlt")
        image = self._pick_local_image(request)

        if image:
            self.last_attribution = {"provider": "eigene Mediathek", "mediaType": "photo"}
        else:
            report_progress(30.0, "Kein eigenes Bild, suche ein Stock-Foto")
            image = self._fetch_stock_photo(request, work_dir, logger)

        if not image:
            raise AdapterUnavailable(
                "Kein Bild fuer diese Szene vorhanden. Lade Bilder in die Mediathek hoch und ordne sie dem "
                "Projekt zu, oder hinterlege PEXELS_API_KEY bzw. PIXABAY_API_KEY fuer Stock-Fotos."
            )

        report_progress(65.0, "Kamerafahrt wird gerendert")
        ken_burns(
            image,
            request.output_path,
            request.width,
            request.height,
            request.fps,
            request.duration_sec,
            request.motion,
            request.motion_strength,
            request.scene_index,
        )

        if image.startswith(work_dir):
            os.unlink(image)

        report_progress(100.0, "Szene fertig")
        return request.output_path
