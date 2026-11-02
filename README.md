# FocusFlow: Music Recommendation Quality Agent

## Original Project

This final project builds on the AI110 Module 3 Music Recommender Simulation.
The original project loaded a small song catalog, compared songs with a user
profile, and ranked the best matches. It showed how genre, mood, energy, and
acousticness can become a simple recommendation score.

## Final Project Summary

FocusFlow adds a Recommendation Quality Agent to the original recommender. The
agent ranks songs, checks the list for repeated artists and limited variety,
then either keeps the results or makes a small adjustment. It also gives a
confidence label and a log so a user can see what the system checked.

## Architecture Overview

The system starts with a user profile and the song catalog. The scoring engine
assigns points to every song, then the ranking engine selects the strongest
matches. The Recommendation Quality Agent checks the ranked list before it is
shown to the user. Automated tests check the scoring and quality rules, while
people can read the log and decide whether the final list makes sense.

See the full Mermaid source in [diagrams/architecture.mmd](diagrams/architecture.mmd).

## Setup and Running the Project

1. Open a terminal in this project folder.
2. Create and activate a virtual environment:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Run the recommender:

   ```powershell
   python -m src.main
   ```

5. Run the tests:

   ```powershell
   python -m pytest -q
   ```

## Sample Interactions

### Default Focused Lofi Profile

```text
Recommendation Quality Agent confidence: HIGH

Focus Flow - Score: 10.85
Library Rain - Score: 7.70
Old Photograph - Score: 3.97

Agent log:
- PLAN: Set score, artist-repeat, and variety checks.
- ACT: Ranked 15 candidate songs.
- CHECK: Removed repeated artist recommendations: LoRoom, Neon Echo.
- REFLECT: High confidence because the top score (10.85) meets the 6.0 threshold.
```

### High-Energy Pop Profile

```text
High-Energy Pop | confidence: high
Sunrise City (10.82)
Gym Hero (7.85)
Rooftop Lights (6.64)
```

### Deep Intense Rock Profile

```text
Deep Intense Rock | confidence: high
Storm Runner (10.97)
Gym Hero (6.91)
Voltage Rush (3.94)
```

## Design Decisions and Tradeoffs

I kept the agent rule-based so its decisions are easy to test and explain. The
agent removes repeated artists when other songs are available, checks whether
the first three results have genre variety, and marks a result as low confidence
when the top score is below 6.0. A rule-based agent is easier to understand
than an LLM-based one, but it cannot understand a listener's full context or
make subtle music judgments.

The variety rule only replaces a top-three song when a different-genre option
has a score within 2 points. This keeps the agent from adding variety at the
cost of an obviously worse recommendation. The tradeoff is that the list may
still be narrow when no close alternative exists.

## Testing

The project has six automated tests. They cover the original ranking behavior,
explanation output, repeated-artist removal, low-confidence results, a normal
result that needs no adjustment, and an empty catalog. The agent also keeps a
plain-text log of its plan, checks, and confidence decision.

| Test input | Evaluation criteria | Result |
| --- | --- | --- |
| Focused lofi profile | Top score reaches the confidence threshold and the log explains the decision. | Pass: `Focus Flow` scored 10.85 with high confidence. |
| Repeated-artist catalog | Final recommendations do not repeat an artist when alternatives exist. | Pass: the agent removes duplicate artists. |
| Weak-match profile | A top score below 6.0 is marked low confidence. | Pass: the agent records a low-confidence message. |
| Already varied results | The agent does not adjust a list that already has genre variety. | Pass: the original ranking stays in place. |
| Empty catalog | The agent returns an empty list instead of crashing. | Pass: it returns low confidence and logs that there are not enough recommendations. |

## Reflection

The main thing I learned is that a ranked list is not automatically a good
recommendation. The quality agent made the system check its own output instead
of treating the first score order as the final answer. AI tools helped me think
through the scoring and testing steps, but I still had to inspect the logs and
compare the results with the user profile.

More detail about the base recommender, its data, and its limits is in the
[model card](model_card.md).
