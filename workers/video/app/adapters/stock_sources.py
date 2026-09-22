from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import requests

REQUEST_TIMEOUT = 30


@dataclass
class StockResult:
    url: str
    width: int
    height: int
    duration: float
    provider: str
    author: str
    page_url: str
    identifier: str

    def to_meta(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "author": self.author,
            "sourceUrl": self.page_url,
            "sourceId": self.identifier,
            "width": self.width,
            "height": self.height,
        }


class StockUnavailable(RuntimeError):
    pass


def _score(width: int, height: int, target_w: int, target_h: int) -> float:
    if width <= 0 or height <= 0:
        return 1e9
    covers = width >= target_w and height >= target_h
    penalty = 0 if covers else 5000
    return penalty + abs(width - target_w) + abs(height - target_h)


class PexelsVideos:
    name = "pexels"
    env_key = "PEXELS_API_KEY"

    def configured(self) -> bool:
        return bool(os.environ.get(self.env_key, "").strip())

    def search(self, query: str, orientation: str, target_w: int, target_h: int) -> StockResult | None:
        key = os.environ.get(self.env_key, "").strip()
        if not key:
            return None

        response = requests.get(
            "https://api.pexels.com/videos/search",
            headers={"Authorization": key},
            params={"query": query, "orientation": orientation, "per_page": 15, "size": "medium"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 401:
            raise StockUnavailable("Der Pexels-API-Key wurde abgelehnt (401). Bitte PEXELS_API_KEY pruefen.")
        if response.status_code == 429:
            raise StockUnavailable("Pexels meldet zu viele Anfragen (429). Bitte spaeter erneut versuchen.")
        if response.status_code >= 400:
            raise StockUnavailable(f"Pexels antwortete mit {response.status_code}")

        payload = response.json()
        best: tuple[float, StockResult] | None = None

        for video in payload.get("videos", []):
            for entry in video.get("video_files", []):
                if entry.get("file_type") not in (None, "video/mp4"):
                    continue
                link = entry.get("link")
                if not link:
                    continue
                width = int(entry.get("width") or 0)
                height = int(entry.get("height") or 0)
                rating = _score(width, height, target_w, target_h)
                candidate = StockResult(
                    url=link,
                    width=width,
                    height=height,
                    duration=float(video.get("duration") or 0),
                    provider="Pexels",
                    author=str((video.get("user") or {}).get("name") or "unbekannt"),
                    page_url=str(video.get("url") or "https://www.pexels.com"),
                    identifier=str(video.get("id") or ""),
                )
                if best is None or rating < best[0]:
                    best = (rating, candidate)

        return best[1] if best else None


class PixabayVideos:
    name = "pixabay"
    env_key = "PIXABAY_API_KEY"

    def configured(self) -> bool:
        return bool(os.environ.get(self.env_key, "").strip())

    def search(self, query: str, orientation: str, target_w: int, target_h: int) -> StockResult | None:
        key = os.environ.get(self.env_key, "").strip()
        if not key:
            return None

        response = requests.get(
            "https://pixabay.com/api/videos/",
            params={"key": key, "q": query, "per_page": 20, "safesearch": "true"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code in (400, 401, 403):
            raise StockUnavailable("Der Pixabay-API-Key wurde abgelehnt. Bitte PIXABAY_API_KEY pruefen.")
        if response.status_code == 429:
            raise StockUnavailable("Pixabay meldet zu viele Anfragen (429). Bitte spaeter erneut versuchen.")
        if response.status_code >= 400:
            raise StockUnavailable(f"Pixabay antwortete mit {response.status_code}")

        payload = response.json()
        best: tuple[float, StockResult] | None = None

        for hit in payload.get("hits", []):
            for variant in (hit.get("videos") or {}).values():
                url = variant.get("url")
                if not url:
                    continue
                width = int(variant.get("width") or 0)
                height = int(variant.get("height") or 0)
                rating = _score(width, height, target_w, target_h)
                candidate = StockResult(
                    url=url,
                    width=width,
                    height=height,
                    duration=float(hit.get("duration") or 0),
                    provider="Pixabay",
                    author=str(hit.get("user") or "unbekannt"),
                    page_url=str(hit.get("pageURL") or "https://pixabay.com"),
                    identifier=str(hit.get("id") or ""),
                )
                if best is None or rating < best[0]:
                    best = (rating, candidate)

        return best[1] if best else None


class PexelsPhotos:
    name = "pexels-photos"
    env_key = "PEXELS_API_KEY"

    def configured(self) -> bool:
        return bool(os.environ.get(self.env_key, "").strip())

    def search(self, query: str, orientation: str, target_w: int, target_h: int) -> StockResult | None:
        key = os.environ.get(self.env_key, "").strip()
        if not key:
            return None

        response = requests.get(
            "https://api.pexels.com/v1/search",
            headers={"Authorization": key},
            params={"query": query, "orientation": orientation, "per_page": 15, "size": "large"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code >= 400:
            raise StockUnavailable(f"Pexels (Fotos) antwortete mit {response.status_code}")

        payload = response.json()
        for photo in payload.get("photos", []):
            sources = photo.get("src") or {}
            url = sources.get("original") or sources.get("large2x") or sources.get("large")
            if not url:
                continue
            return StockResult(
                url=url,
                width=int(photo.get("width") or 0),
                height=int(photo.get("height") or 0),
                duration=0.0,
                provider="Pexels",
                author=str(photo.get("photographer") or "unbekannt"),
                page_url=str(photo.get("url") or "https://www.pexels.com"),
                identifier=str(photo.get("id") or ""),
            )
        return None


class PixabayPhotos:
    name = "pixabay-photos"
    env_key = "PIXABAY_API_KEY"

    def configured(self) -> bool:
        return bool(os.environ.get(self.env_key, "").strip())

    def search(self, query: str, orientation: str, target_w: int, target_h: int) -> StockResult | None:
        key = os.environ.get(self.env_key, "").strip()
        if not key:
            return None

        pixabay_orientation = {"portrait": "vertical", "landscape": "horizontal"}.get(orientation, "all")
        response = requests.get(
            "https://pixabay.com/api/",
            params={
                "key": key,
                "q": query,
                "image_type": "photo",
                "orientation": pixabay_orientation,
                "per_page": 20,
                "safesearch": "true",
            },
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code >= 400:
            raise StockUnavailable(f"Pixabay (Fotos) antwortete mit {response.status_code}")

        payload = response.json()
        for hit in payload.get("hits", []):
            url = hit.get("largeImageURL") or hit.get("webformatURL")
            if not url:
                continue
            return StockResult(
                url=url,
                width=int(hit.get("imageWidth") or 0),
                height=int(hit.get("imageHeight") or 0),
                duration=0.0,
                provider="Pixabay",
                author=str(hit.get("user") or "unbekannt"),
                page_url=str(hit.get("pageURL") or "https://pixabay.com"),
                identifier=str(hit.get("id") or ""),
            )
        return None


def download(url: str, target: str) -> str:
    with requests.get(url, stream=True, timeout=180) as response:
        if response.status_code >= 400:
            raise StockUnavailable(f"Download fehlgeschlagen ({response.status_code}): {url[:120]}")
        with open(target, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    if os.path.getsize(target) == 0:
        raise StockUnavailable("Die heruntergeladene Datei ist leer")
    return target
