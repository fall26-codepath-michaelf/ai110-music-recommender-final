# FocusFlow web UI

A static frontend (plain HTML, CSS and JavaScript, no build step) for FocusFlow:
pick a listening profile, flip through quality-reviewed picks, read the agent's
log, search Spotify, tag new songs so FocusFlow can score them, and play music
from a bottom player bar.

## Run it

The page loads `data/songs.csv` in mock mode, so serve the repository root
(opening `index.html` straight from disk will not work):

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/web/>.

## Mock mode vs. live mode

`web/js/config.js` controls where data comes from:

| Setting | Meaning |
| --- | --- |
| `useMock: true` (default) | Everything runs in the browser. Scoring and the quality agent are ported from `src/recommender.py` and `src/quality_agent.py`, Spotify search returns a few fake tracks, and the player fakes playback with a timer (no audio). |
| `useMock: false` | Every call goes to the HTTP API below at `apiBase` (default `/api`). |

The UI only talks to `window.FocusFlowAPI` (defined in `web/js/api.js`), so
the backend can be built without touching `app.js`.

## Backend contract

All bodies are JSON. Errors should return a non-2xx status with a short text
message; the UI shows it in a toast.

### Shared shapes

```jsonc
// Profile
{ "favorite_genre": "lofi", "favorite_mood": "focused", "target_energy": 0.45, "likes_acoustic": true }

// Song (a row of data/songs.csv, plus Spotify info or null if not found on Spotify)
{
  "id": 9, "title": "Focus Flow", "artist": "LoRoom", "genre": "lofi", "mood": "focused",
  "energy": 0.40, "acousticness": 0.78,
  "spotify": { "spotify_id": "…", "uri": "spotify:track:…", "album_art_url": "https://…", "duration_ms": 180000 }
}

// Reason (one per score part that earned points; factor is genre | mood | energy | acoustic)
{ "factor": "energy", "points": 2.85, "text": "energy close to target (+2.85)" }
```

### Endpoints

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/spotify/status` | – | `{ "connected": true, "user": { "display_name": "Michael" } }` |
| `GET /api/options` | – | `{ "genres": [...], "moods": [...] }` from the catalog |
| `POST /api/recommendations` | Profile plus `"k": 5` | `{ "recommendations": [{ "song": Song, "score": 10.85, "reasons": [Reason], "explanation": "…" }], "confidence": "high", "adjusted": true, "logs": ["PLAN: …", "ACT: …", "CHECK: …", "REFLECT: …"] }`. This is `RecommendationQualityAgent.recommend()` plus `reasons` and Spotify info. |
| `POST /api/search` | `{ "query": "night drive", "profile": Profile }` | `{ "tracks": [{ "spotify_id", "uri", "title", "artist", "album_art_url", "duration_ms", "catalog_song": Song or null, "score": number or null }] }`. `catalog_song` and `score` are set when the track is already in the FocusFlow catalog. |
| `POST /api/score` | `{ "song": { "genre", "mood", "energy", "acousticness" }, "profile": Profile }` | `{ "score": 7.85, "reasons": [Reason] }`. Used for the live preview while tagging. |
| `POST /api/catalog/tag` | `{ "track": <search track>, "tags": { "genre", "mood", "energy", "acoustic": true }, "profile": Profile }` | `{ "song": Song, "score": 7.85, "reasons": [Reason] }`. Adds the song to the catalog. |
| `POST /api/spotify/like` | `{ "uri": "spotify:track:…" }` | `{ "ok": true }` (save to Liked Songs) |
| `POST /api/spotify/playlist` | `{ "name": "FocusFlow · lofi / focused", "uris": [...] }` | `{ "playlist": { "name", "url" } }` |
| `POST /api/feedback` | `{ "song_id": 9, "action": "skip" or "save" }` | `{ "ok": true }` (for future ranking changes) |

Spotify no longer gives newer apps a track's audio features (energy,
acousticness) or its own recommendations, which is why scoring stays on the
catalog's columns and new songs are tagged by the listener. Check Spotify's
current developer docs before relying on any endpoint.

### Player

In live mode, define `window.FocusFlowPlayer` before `api.js` loads (for
example in a new script that wraps the Spotify Web Playback SDK). It needs the
same shape as the mock player in `api.js`:

| Member | Behavior |
| --- | --- |
| `play(track?)` | Start `track` (`{ uri, title, artist, genre, artUrl, durationMs }`) or resume the current one. Returns a promise. |
| `pause()` | Pause. Returns a promise. |
| `onChange(fn)` | Call `fn({ track, playing, positionMs, durationMs })` whenever playback changes, and about twice a second while playing. |
| `onEnded(fn)` | Call `fn()` when a track finishes, so the UI can play the next one. |

Full-track playback in the browser through the Web Playback SDK needs a
Spotify Premium account.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Lavender, ink and tangerine theme |
| `js/config.js` | Mock or live mode and the API base URL |
| `js/api.js` | Mock data, the ported scoring and agent, HTTP client and mock player |
| `js/app.js` | Rendering and interaction |
