"""Local web server for the FocusFlow demo and Spotify catalog search."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory

from .quality_agent import RecommendationQualityAgent
from .recommender import load_songs, score_song


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = PROJECT_ROOT / "web"
DATA_ROOT = PROJECT_ROOT / "data"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search"


class SpotifyError(RuntimeError):
    """A safe, user-facing Spotify API error."""


class SpotifyClient:
    """Request public Spotify catalog data without exposing credentials to the browser."""

    def __init__(self, client_id: str | None, client_secret: str | None, market: str = "US"):
        self.client_id = client_id or ""
        self.client_secret = client_secret or ""
        self.market = market
        self._token: str | None = None
        self._token_expires_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _access_token(self) -> str:
        if not self.configured:
            raise SpotifyError("Spotify credentials are missing. Add them to .env and restart the server.")

        if self._token and time.time() < self._token_expires_at:
            return self._token

        response = requests.post(
            SPOTIFY_TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=(self.client_id, self.client_secret),
            timeout=10,
        )
        if not response.ok:
            raise SpotifyError("Spotify could not authorize this app. Check the local .env credentials.")

        payload = response.json()
        self._token = payload["access_token"]
        self._token_expires_at = time.time() + int(payload.get("expires_in", 3600)) - 60
        return self._token

    def search_tracks(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        token = self._access_token()
        response = requests.get(
            SPOTIFY_SEARCH_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={"q": query, "type": "track", "limit": limit, "market": self.market},
            timeout=10,
        )

        if response.status_code == 429:
            raise SpotifyError("Spotify is temporarily rate-limiting requests. Try again in a moment.")
        if not response.ok:
            raise SpotifyError("Spotify search is unavailable right now. Please try again.")

        return response.json().get("tracks", {}).get("items", [])


def _validate_profile(payload: dict[str, Any]) -> dict[str, Any]:
    required = ("favorite_genre", "favorite_mood", "target_energy", "likes_acoustic")
    if not all(key in payload for key in required):
        raise ValueError("Choose a genre, mood, energy level, and acoustic preference.")

    try:
        energy = float(payload["target_energy"])
    except (TypeError, ValueError) as error:
        raise ValueError("Energy must be a number between 0 and 1.") from error
    if not 0 <= energy <= 1:
        raise ValueError("Energy must be between 0 and 1.")

    return {
        "favorite_genre": str(payload["favorite_genre"]),
        "favorite_mood": str(payload["favorite_mood"]),
        "target_energy": energy,
        "likes_acoustic": bool(payload["likes_acoustic"]),
    }


def _song_key(title: str, artist: str) -> tuple[str, str]:
    return title.strip().casefold(), artist.strip().casefold()


def _structured_reasons(profile: dict[str, Any], song: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert the core scorer's readable strings into the UI's reason shape."""
    _, reason_texts = score_song(profile, song)
    reasons = []
    for text in reason_texts:
        factor = next(
            (
                name
                for name in ("genre", "mood", "energy", "acoustic")
                if text.startswith(name)
            ),
            "match",
        )
        points_match = re.search(r"\(([+-]?\d+(?:\.\d+)?)\)", text)
        points = float(points_match.group(1)) if points_match else 0.0
        reasons.append({"factor": factor, "points": points, "text": text})
    return reasons


def _spotify_track(track: dict[str, Any], catalog: dict[tuple[str, str], dict[str, Any]], profile: dict[str, Any]) -> dict[str, Any]:
    artists = track.get("artists", [])
    artist_name = ", ".join(artist.get("name", "") for artist in artists if artist.get("name"))
    album_images = track.get("album", {}).get("images", [])
    catalog_song = catalog.get(_song_key(track.get("name", ""), artist_name))
    score = score_song(profile, catalog_song)[0] if catalog_song else None

    return {
        "spotify_id": track.get("id"),
        "uri": track.get("uri"),
        "title": track.get("name"),
        "artist": artist_name,
        "album_art_url": album_images[0].get("url") if album_images else None,
        "duration_ms": track.get("duration_ms"),
        "external_url": track.get("external_urls", {}).get("spotify"),
        "catalog_song": catalog_song,
        "score": score,
    }


def create_app(spotify_client: SpotifyClient | None = None) -> Flask:
    """Create a FocusFlow server, allowing a fake Spotify client in tests."""
    load_dotenv(PROJECT_ROOT / ".env")
    app = Flask(__name__)
    songs = load_songs(str(DATA_ROOT / "songs.csv"))
    catalog = {_song_key(song["title"], song["artist"]): song for song in songs}
    client = spotify_client or SpotifyClient(
        os.getenv("SPOTIFY_CLIENT_ID"),
        os.getenv("SPOTIFY_CLIENT_SECRET"),
        os.getenv("SPOTIFY_MARKET", "US"),
    )

    @app.errorhandler(SpotifyError)
    def spotify_error(error: SpotifyError):
        return str(error), 503

    @app.errorhandler(ValueError)
    def input_error(error: ValueError):
        return str(error), 400

    @app.get("/")
    def index():
        return redirect("/web/")

    @app.get("/web/")
    def web_index():
        return send_from_directory(WEB_ROOT, "index.html")

    @app.get("/web/<path:filename>")
    def web_assets(filename: str):
        return send_from_directory(WEB_ROOT, filename)

    @app.get("/data/<path:filename>")
    def data_assets(filename: str):
        return send_from_directory(DATA_ROOT, filename)

    @app.get("/api/spotify/status")
    def spotify_status():
        return jsonify({"connected": client.configured, "mode": "catalog-search"})

    @app.get("/api/options")
    def options():
        return jsonify(
            {
                "genres": sorted({song["genre"] for song in songs}),
                "moods": sorted({song["mood"] for song in songs}),
            }
        )

    @app.post("/api/recommendations")
    def recommendations():
        payload = request.get_json(silent=True) or {}
        profile = _validate_profile(payload)
        try:
            count = int(payload.get("k", 5))
        except (TypeError, ValueError) as error:
            raise ValueError("Recommendation count must be a number.") from error
        if not 3 <= count <= 8:
            raise ValueError("Choose between 3 and 8 recommendations.")

        result = RecommendationQualityAgent(songs).recommend(profile, k=count)
        recommendations_payload = []
        for song, score, explanation in result.recommendations:
            recommendations_payload.append(
                {
                    "song": song,
                    "score": score,
                    "reasons": _structured_reasons(profile, song),
                    "explanation": explanation,
                }
            )
        return jsonify(
            {
                "recommendations": recommendations_payload,
                "confidence": result.confidence,
                "adjusted": result.adjusted,
                "logs": result.logs,
            }
        )

    @app.post("/api/search")
    def search():
        payload = request.get_json(silent=True) or {}
        query = str(payload.get("query", "")).strip()
        if not 1 <= len(query) <= 100:
            raise ValueError("Enter a search between 1 and 100 characters.")
        profile = _validate_profile(payload.get("profile") or {})
        tracks = client.search_tracks(query)
        return jsonify({"tracks": [_spotify_track(track, catalog, profile) for track in tracks]})

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8501, debug=True)
