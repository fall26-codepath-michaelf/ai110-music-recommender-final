# 🎧 Model Card: FocusFlow

## 1. Model Name

FocusFlow is a small music recommender simulation.

## 2. Goal / Task

The system suggests songs from a small catalog based on a user's favorite
genre, mood, target energy, and acoustic preference.

## 3. Data Used

The catalog has 17 songs. Each song includes genre, mood, energy, tempo,
valence, danceability, and acousticness. I added seven songs to make the
starter catalog more varied. The data does not include lyrics, listening
history, skips, saves, or feedback from real people.

## 4. Algorithm Summary

FocusFlow scores one song at a time. A genre match adds 4 points, a mood match
adds 3 points, energy closeness adds up to 3 points, and a matching acoustic
preference adds 1 point. The Recommendation Quality Agent then checks for
repeated artists, limited genre variety, and weak top scores before it returns
the final list with reasons and a confidence label.

## 5. Observed Behavior / Biases

The system works well when a profile has clear genre and mood preferences. For
a lofi, focused profile, `Focus Flow` ranked first. For a pop, happy profile,
`Sunrise City` ranked first. Genre has the largest weight, so the system can
over-favor familiar music and miss songs from other genres that fit the same
mood or energy.

## 6. Evaluation Process

I tested High-Energy Pop, Chill Lofi, and Deep Intense Rock profiles. The top
results fit the main genre, mood, and energy preferences: `Sunrise City`,
`Library Rain`, and `Storm Runner` each ranked first for their matching
profiles. I also tested a weight shift by cutting the genre score from 4 to 2
and doubling the maximum energy score from 3 to 6. That made the results more
energy-focused, but not clearly more accurate, so I restored the original
weights. Six automated tests cover scoring, explanations, repeated artists,
low confidence, varied results, and an empty catalog.

## 7. Intended Use and Non-Intended Use

This is for classroom exploration of basic recommendation logic. It can help
show how a few preferences become a ranked list. It should not be used to make
real music recommendations or assumptions about a person's taste because the
catalog and profile are too small.

## 8. Ideas for Improvement

- Make the diversity rule consider mood and energy, not only genre.
- Let users mark songs as saved or skipped, then use that feedback later.
- Add more songs and more than one mood or genre preference per profile.

## 9. Personal Reflection

The biggest learning moment for me was seeing how a small weight change could
reorder the recommendations. When I made energy more important and genre less
important, songs with closer energy values moved ahead of some genre matches.
That made the system feel less like a neutral list and more like a set of
choices I had built into the rules.

AI tools helped me brainstorm features, compare profile results, and check the
scoring idea. I still needed to read the score reasons and test the output
myself because a suggested rule can be mathematically valid without matching
what I want the recommender to do. If I extended this project, I would add more
user feedback and improve the diversity rule before adding more complex features.

## 10. Reflection and Ethics

### Limitations and Bias

The system treats hand-written labels like genre and mood as if they describe a
song completely, but they do not. Genre receives the most points, so a user can
be kept inside a familiar genre even when another song has a similar energy or
mood. The small catalog also leaves out many artists, cultures, and musical
styles, which means the results cannot represent broad musical taste fairly.

### Misuse and Prevention

Someone could misuse the scores as if they were an objective statement about
what a person should enjoy. I would prevent that by keeping the reasons and
confidence label visible, avoiding sensitive personal data, and making it clear
that this is a classroom simulation rather than a real music service. A person
should be able to review or ignore the suggestions instead of treating them as
the final answer.

### Reliability What Surprised Me

Testing showed that a high raw score is not enough by itself. The agent could
find several strong songs from the same artist, so the repeated-artist check
changed the final list even though the original ranking was mathematically
correct. The empty-catalog test also showed why the system needs a low-confidence
path instead of assuming it will always have a good recommendation.

### Collaboration with AI

I used AI to help brainstorm the quality-agent workflow and test cases. I
accepted the suggestion to add a repeated-artist check and clear agent logs
because both make the output easier to inspect. I revised the suggestion to
double the energy weight and cut the genre weight in half after testing it,
because it changed the rankings without making them clearly better. I kept the
original weights and documented that choice instead.
