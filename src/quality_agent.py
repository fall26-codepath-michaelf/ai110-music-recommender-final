"""Rule-based quality checks for the music recommender."""

from dataclasses import dataclass
from typing import Dict, List, Tuple

from .recommender import recommend_songs


Recommendation = Tuple[Dict, float, str]


@dataclass
class AgentResult:
    """The final recommendations and the decisions made by the agent."""

    recommendations: List[Recommendation]
    confidence: str
    adjusted: bool
    logs: List[str]


class RecommendationQualityAgent:
    """Rank songs, check the list, and make small quality adjustments."""

    def __init__(self, songs: List[Dict], confidence_threshold: float = 6.0):
        self.songs = songs
        self.confidence_threshold = confidence_threshold

    def recommend(self, user_prefs: Dict, k: int = 5) -> AgentResult:
        """Plan, rank, check, and return a quality-reviewed recommendation list."""
        logs = ["PLAN: Set score, artist-repeat, and variety checks."]
        candidates = recommend_songs(user_prefs, self.songs, k=max(k * 3, k))
        logs.append(f"ACT: Ranked {len(candidates)} candidate songs.")

        deduplicated, removed_duplicates = self._remove_duplicate_artists(candidates)
        if removed_duplicates:
            logs.append(
                "CHECK: Removed repeated artist recommendations: "
                + ", ".join(removed_duplicates)
                + "."
            )
        else:
            logs.append("CHECK: No repeated artists found in the candidate list.")

        final_recommendations = deduplicated[:k]
        adjusted_for_variety = self._apply_variety_rule(
            final_recommendations, deduplicated, logs
        )
        adjusted = bool(removed_duplicates) or adjusted_for_variety

        top_score = final_recommendations[0][1] if final_recommendations else 0.0
        confidence = "high" if top_score >= self.confidence_threshold else "low"
        if confidence == "low":
            logs.append(
                f"REFLECT: Low confidence because the top score ({top_score:.2f}) "
                f"is below {self.confidence_threshold:.1f}."
            )
        else:
            logs.append(
                f"REFLECT: High confidence because the top score ({top_score:.2f}) "
                f"meets the {self.confidence_threshold:.1f} threshold."
            )

        return AgentResult(final_recommendations, confidence, adjusted, logs)

    @staticmethod
    def _remove_duplicate_artists(
        candidates: List[Recommendation],
    ) -> Tuple[List[Recommendation], List[str]]:
        unique_recommendations = []
        seen_artists = set()
        removed_artists = []

        for recommendation in candidates:
            artist = recommendation[0]["artist"]
            if artist in seen_artists:
                removed_artists.append(artist)
                continue
            seen_artists.add(artist)
            unique_recommendations.append(recommendation)

        return unique_recommendations, removed_artists

    @staticmethod
    def _apply_variety_rule(
        recommendations: List[Recommendation],
        candidates: List[Recommendation],
        logs: List[str],
    ) -> bool:
        if len(recommendations) < 3:
            logs.append("CHECK: Not enough recommendations to run the variety check.")
            return False

        first_three_genres = {recommendation[0]["genre"] for recommendation in recommendations[:3]}
        if len(first_three_genres) > 1:
            logs.append("CHECK: The first three recommendations already include genre variety.")
            return False

        repeated_genre = recommendations[0][0]["genre"]
        third_score = recommendations[2][1]
        selected_titles = {recommendation[0]["title"] for recommendation in recommendations}
        alternative = next(
            (
                candidate
                for candidate in candidates
                if candidate[0]["genre"] != repeated_genre
                and candidate[0]["title"] not in selected_titles
                and candidate[1] >= third_score - 2.0
            ),
            None,
        )

        if alternative is None:
            logs.append("CHECK: No similar-score genre alternative was available.")
            return False

        replaced = recommendations[2]
        recommendations[2] = alternative
        logs.append(
            "CHECK: Replaced "
            f"{replaced[0]['title']} with {alternative[0]['title']} for genre variety."
        )
        return True
