from src.server import create_app


class FakeSpotifyClient:
    configured = True

    def search_tracks(self, query, limit=8):
        assert query == "focus music"
        assert limit == 8
        return [
            {
                "id": "spotify-track-1",
                "uri": "spotify:track:spotify-track-1",
                "name": "Focus Flow",
                "artists": [{"name": "LoRoom"}],
                "album": {"images": [{"url": "https://example.com/focus-flow.jpg"}]},
                "duration_ms": 180000,
                "external_urls": {"spotify": "https://open.spotify.com/track/spotify-track-1"},
            }
        ]


def profile():
    return {
        "favorite_genre": "lofi",
        "favorite_mood": "focused",
        "target_energy": 0.45,
        "likes_acoustic": True,
    }


def test_recommendations_endpoint_runs_the_quality_agent():
    client = create_app(FakeSpotifyClient()).test_client()

    response = client.post("/api/recommendations", json={**profile(), "k": 5})

    assert response.status_code == 200
    data = response.get_json()
    assert data["confidence"] == "high"
    assert data["recommendations"][0]["song"]["title"] == "Focus Flow"
    assert data["recommendations"][0]["reasons"][0]["factor"] == "genre"
    assert any(log.startswith("PLAN:") for log in data["logs"])


def test_search_endpoint_returns_spotify_data_and_catalog_score():
    client = create_app(FakeSpotifyClient()).test_client()

    response = client.post("/api/search", json={"query": "focus music", "profile": profile()})

    assert response.status_code == 200
    track = response.get_json()["tracks"][0]
    assert track["title"] == "Focus Flow"
    assert track["album_art_url"] == "https://example.com/focus-flow.jpg"
    assert track["external_url"].startswith("https://open.spotify.com/")
    assert track["catalog_song"]["title"] == "Focus Flow"
    assert track["score"] == 10.85


def test_search_requires_a_query():
    client = create_app(FakeSpotifyClient()).test_client()

    response = client.post("/api/search", json={"query": "", "profile": profile()})

    assert response.status_code == 400
    assert "Enter a search" in response.get_data(as_text=True)
