"""
Command line runner for the Music Recommender Simulation.

This file helps you quickly run and test your recommender.

You will implement the functions in recommender.py:
- load_songs
- score_song
- recommend_songs
"""

from .quality_agent import RecommendationQualityAgent
from .recommender import load_songs


def main() -> None:
    songs = load_songs("data/songs.csv") 
    print(f"Loaded songs: {len(songs)}")

    # Starter example profile
    user_prefs = {
        "favorite_genre": "lofi",
        "favorite_mood": "focused",
        "target_energy": 0.45,
        "likes_acoustic": True,
    }

    agent = RecommendationQualityAgent(songs)
    result = agent.recommend(user_prefs, k=5)

    print(f"\nRecommendation Quality Agent confidence: {result.confidence.upper()}")
    print("\nTop recommendations:\n")
    for song, score, explanation in result.recommendations:
        print(f"{song['title']} - Score: {score:.2f}")
        print(f"Because: {explanation}")
        print()

    print("Agent log:")
    for log in result.logs:
        print(f"- {log}")


if __name__ == "__main__":
    main()
