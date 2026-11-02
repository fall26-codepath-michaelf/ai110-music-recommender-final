from src.quality_agent import RecommendationQualityAgent


def make_song(title, artist, genre, mood, energy, acousticness):
    return {
        "id": title,
        "title": title,
        "artist": artist,
        "genre": genre,
        "mood": mood,
        "energy": energy,
        "tempo_bpm": 100.0,
        "valence": 0.5,
        "danceability": 0.5,
        "acousticness": acousticness,
    }


def test_agent_removes_duplicate_artists():
    songs = [
        make_song("Pop One", "Artist A", "pop", "happy", 0.8, 0.2),
        make_song("Pop Two", "Artist A", "pop", "happy", 0.79, 0.2),
        make_song("Pop Three", "Artist B", "pop", "happy", 0.78, 0.2),
        make_song("Pop Four", "Artist C", "pop", "happy", 0.77, 0.2),
    ]
    profile = {
        "favorite_genre": "pop",
        "favorite_mood": "happy",
        "target_energy": 0.8,
        "likes_acoustic": False,
    }

    result = RecommendationQualityAgent(songs).recommend(profile, k=3)
    artists = [song["artist"] for song, _, _ in result.recommendations]

    assert len(artists) == len(set(artists))
    assert result.adjusted is True
    assert any("Removed repeated artist" in log for log in result.logs)


def test_agent_marks_weak_results_as_low_confidence():
    songs = [make_song("Quiet Match", "Artist A", "ambient", "calm", 0.9, 0.9)]
    profile = {
        "favorite_genre": "rock",
        "favorite_mood": "intense",
        "target_energy": 0.0,
        "likes_acoustic": False,
    }

    result = RecommendationQualityAgent(songs).recommend(profile, k=1)

    assert result.confidence == "low"
    assert any("Low confidence" in log for log in result.logs)


def test_agent_keeps_varied_normal_results():
    songs = [
        make_song("Pop Match", "Artist A", "pop", "happy", 0.8, 0.2),
        make_song("Rock Match", "Artist B", "rock", "intense", 0.9, 0.1),
        make_song("Jazz Match", "Artist C", "jazz", "relaxed", 0.5, 0.8),
    ]
    profile = {
        "favorite_genre": "pop",
        "favorite_mood": "happy",
        "target_energy": 0.8,
        "likes_acoustic": False,
    }

    result = RecommendationQualityAgent(songs).recommend(profile, k=3)

    assert result.adjusted is False
    assert result.recommendations[0][0]["title"] == "Pop Match"


def test_agent_handles_an_empty_catalog_gracefully():
    profile = {
        "favorite_genre": "pop",
        "favorite_mood": "happy",
        "target_energy": 0.8,
        "likes_acoustic": False,
    }

    result = RecommendationQualityAgent([]).recommend(profile, k=3)

    assert result.recommendations == []
    assert result.confidence == "low"
    assert any("Not enough recommendations" in log for log in result.logs)
