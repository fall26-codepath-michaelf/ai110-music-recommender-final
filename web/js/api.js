// Data layer for the FocusFlow web UI.
// The UI only talks to window.FocusFlowAPI. In mock mode every call is answered
// in the browser (scoring and the quality agent are ported from src/); in live
// mode each call hits the HTTP endpoint documented in web/README.md.
(function () {
  "use strict";

  const config = window.FOCUSFLOW_CONFIG || { useMock: true, apiBase: "/api" };

  // ---------------------------------------------------------------------------
  // Mock implementation
  // ---------------------------------------------------------------------------

  const CONFIDENCE_THRESHOLD = 6.0;

  // Spotify-only tracks used by mock search. They are not in songs.csv, so
  // FocusFlow cannot score them until the listener tags them.
  const MOCK_SPOTIFY_ONLY = [
    { spotify_id: "mock-x1", title: "Night Drive (Slowed)", artist: "LoRoom", duration_ms: 222000 },
    { spotify_id: "mock-x2", title: "Night Drive Home", artist: "Cedar Lane", duration_ms: 178000 },
    { spotify_id: "mock-x3", title: "Drive at Night", artist: "Pulse District", duration_ms: 205000 },
    { spotify_id: "mock-x4", title: "Night Drive Tapes", artist: "Orbit Bloom", duration_ms: 241000 },
    { spotify_id: "mock-x5", title: "Rain on the Library Roof", artist: "Paper Lanterns", duration_ms: 195000 },
    { spotify_id: "mock-x6", title: "Focus Flow (Live)", artist: "LoRoom", duration_ms: 230000 },
    { spotify_id: "mock-x7", title: "Sunrise City (Acoustic)", artist: "Neon Echo", duration_ms: 201000 },
    { spotify_id: "mock-x8", title: "Quiet Orbit II", artist: "Aria Fields", duration_ms: 260000 },
  ];

  let catalogPromise = null;
  const taggedSongs = [];

  function delay(value, ms) {
    return new Promise((resolve) => setTimeout(() => resolve(value), ms === undefined ? 200 : ms));
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(",");
    const numeric = new Set(["id", "energy", "tempo_bpm", "valence", "danceability", "acousticness"]);
    return lines.slice(1).map((line) => {
      const cells = line.split(",");
      const row = {};
      headers.forEach((header, i) => {
        row[header] = numeric.has(header) ? Number(cells[i]) : cells[i];
      });
      return row;
    });
  }

  function mockSpotifyFor(song) {
    return {
      spotify_id: "mock-" + song.id,
      uri: "spotify:track:mock-" + song.id,
      album_art_url: null,
      duration_ms: 150000 + ((song.id * 37) % 90) * 1000,
    };
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(config.catalogCsvUrl)
        .then((response) => {
          if (!response.ok) throw new Error("Could not load " + config.catalogCsvUrl);
          return response.text();
        })
        .then((text) => parseCsv(text).map((song) => Object.assign(song, { spotify: mockSpotifyFor(song) })));
    }
    return catalogPromise.then((songs) => songs.concat(taggedSongs));
  }

  // Mirrors score_song() in src/recommender.py.
  function scoreSong(profile, song) {
    let score = 0;
    const reasons = [];
    if (song.genre === profile.favorite_genre) {
      score += 4;
      reasons.push({ factor: "genre", points: 4, text: "genre match (+4.0)" });
    }
    if (song.mood === profile.favorite_mood) {
      score += 3;
      reasons.push({ factor: "mood", points: 3, text: "mood match (+3.0)" });
    }
    if (profile.target_energy !== null && profile.target_energy !== undefined) {
      const energyPoints = Math.max(0, 3 * (1 - Math.abs(song.energy - Number(profile.target_energy))));
      score += energyPoints;
      reasons.push({ factor: "energy", points: energyPoints, text: "energy close to target (+" + energyPoints.toFixed(2) + ")" });
    }
    if (profile.likes_acoustic !== undefined) {
      const match = (profile.likes_acoustic && song.acousticness >= 0.6) || (!profile.likes_acoustic && song.acousticness <= 0.4);
      if (match) {
        score += 1;
        reasons.push({ factor: "acoustic", points: 1, text: "acoustic preference match (+1.0)" });
      }
    }
    return { score, reasons };
  }

  function toRecommendation(profile, song) {
    const { score, reasons } = scoreSong(profile, song);
    return {
      song,
      score,
      reasons,
      explanation: reasons.map((r) => r.text).join("; ") || "No strong preference match.",
    };
  }

  // Mirrors recommend_songs(): stable sort, highest score first.
  function rankSongs(profile, songs, k) {
    return songs
      .map((song) => toRecommendation(profile, song))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  // Mirrors RecommendationQualityAgent.recommend() in src/quality_agent.py.
  function runQualityAgent(profile, songs, k) {
    const logs = ["PLAN: Set score, artist-repeat, and variety checks."];
    const candidates = rankSongs(profile, songs, Math.max(k * 3, k));
    logs.push("ACT: Ranked " + candidates.length + " candidate songs.");

    const unique = [];
    const seen = new Set();
    const removed = [];
    candidates.forEach((rec) => {
      if (seen.has(rec.song.artist)) {
        removed.push(rec.song.artist);
        return;
      }
      seen.add(rec.song.artist);
      unique.push(rec);
    });
    if (removed.length) {
      logs.push("CHECK: Removed repeated artist recommendations: " + removed.join(", ") + ".");
    } else {
      logs.push("CHECK: No repeated artists found in the candidate list.");
    }

    const finalRecs = unique.slice(0, k);
    let adjustedForVariety = false;
    if (finalRecs.length < 3) {
      logs.push("CHECK: Not enough recommendations to run the variety check.");
    } else {
      const firstThreeGenres = new Set(finalRecs.slice(0, 3).map((rec) => rec.song.genre));
      if (firstThreeGenres.size > 1) {
        logs.push("CHECK: The first three recommendations already include genre variety.");
      } else {
        const repeatedGenre = finalRecs[0].song.genre;
        const thirdScore = finalRecs[2].score;
        const selectedTitles = new Set(finalRecs.map((rec) => rec.song.title));
        const alternative = unique.find(
          (rec) => rec.song.genre !== repeatedGenre && !selectedTitles.has(rec.song.title) && rec.score >= thirdScore - 2
        );
        if (!alternative) {
          logs.push("CHECK: No similar-score genre alternative was available.");
        } else {
          const replaced = finalRecs[2];
          finalRecs[2] = alternative;
          adjustedForVariety = true;
          logs.push("CHECK: Replaced " + replaced.song.title + " with " + alternative.song.title + " for genre variety.");
        }
      }
    }

    const topScore = finalRecs.length ? finalRecs[0].score : 0;
    const confidence = topScore >= CONFIDENCE_THRESHOLD ? "high" : "low";
    if (confidence === "low") {
      logs.push("REFLECT: Low confidence because the top score (" + topScore.toFixed(2) + ") is below " + CONFIDENCE_THRESHOLD.toFixed(1) + ".");
    } else {
      logs.push("REFLECT: High confidence because the top score (" + topScore.toFixed(2) + ") meets the " + CONFIDENCE_THRESHOLD.toFixed(1) + " threshold.");
    }

    return {
      recommendations: finalRecs,
      confidence,
      adjusted: removed.length > 0 || adjustedForVariety,
      logs,
    };
  }

  function matchesQuery(text, query) {
    const haystack = text.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
  }

  const mockApi = {
    getStatus() {
      return delay({ connected: true, user: { display_name: "Michael" } });
    },

    getOptions() {
      return loadCatalog().then((songs) => {
        const unique = (key) => songs.map((s) => s[key]).filter((v, i, all) => all.indexOf(v) === i).sort();
        return { genres: unique("genre"), moods: unique("mood") };
      });
    },

    getRecommendations(profile, k) {
      return loadCatalog().then((songs) => delay(runQualityAgent(profile, songs, k), 300));
    },

    search(query, profile) {
      return loadCatalog().then((songs) => {
        const catalogHits = songs
          .filter((song) => matchesQuery(song.title + " " + song.artist + " " + song.genre, query))
          .map((song) => {
            const { score } = scoreSong(profile, song);
            return Object.assign({}, song.spotify, {
              title: song.title,
              artist: song.artist,
              catalog_song: song,
              score,
            });
          });
        const taggedIds = new Set(songs.map((s) => s.spotify && s.spotify.spotify_id));
        const spotifyHits = MOCK_SPOTIFY_ONLY
          .filter((track) => !taggedIds.has(track.spotify_id) && matchesQuery(track.title + " " + track.artist, query))
          .map((track) => Object.assign({}, track, { uri: "spotify:track:" + track.spotify_id, album_art_url: null, catalog_song: null, score: null }));
        return delay({ tracks: catalogHits.concat(spotifyHits) }, 250);
      });
    },

    scoreSong(song, profile) {
      return delay(scoreSong(profile, song), 50);
    },

    tagSong(track, tags, profile) {
      return loadCatalog().then((songs) => {
        const song = {
          id: Math.max.apply(null, songs.map((s) => s.id)) + 1,
          title: track.title,
          artist: track.artist,
          genre: tags.genre,
          mood: tags.mood,
          energy: tags.energy,
          acousticness: tags.acoustic ? 0.8 : 0.2,
          spotify: {
            spotify_id: track.spotify_id,
            uri: track.uri,
            album_art_url: track.album_art_url,
            duration_ms: track.duration_ms,
          },
        };
        taggedSongs.push(song);
        const { score, reasons } = scoreSong(profile, song);
        return delay({ song, score, reasons });
      });
    },

    likeTrack(uri) {
      return delay({ ok: true, uri });
    },

    createPlaylist(name, uris) {
      return delay({ playlist: { name, track_count: uris.length, url: null } }, 400);
    },

    sendFeedback(songId, action) {
      return delay({ ok: true, song_id: songId, action }, 50);
    },
  };

  // Fake player: advances a timer instead of streaming audio.
  function createMockPlayer() {
    let track = null;
    let playing = false;
    let positionMs = 0;
    let timer = null;
    const listeners = [];
    const endedListeners = [];

    function emit() {
      const snapshot = { track, playing, positionMs, durationMs: track ? track.durationMs : 0 };
      listeners.forEach((fn) => fn(snapshot));
    }

    function tick() {
      positionMs += 500;
      if (track && positionMs >= track.durationMs) {
        positionMs = track.durationMs;
        stop();
        emit();
        endedListeners.forEach((fn) => fn());
        return;
      }
      emit();
    }

    function start() {
      if (timer) return;
      timer = setInterval(tick, 500);
    }

    function stop() {
      playing = false;
      clearInterval(timer);
      timer = null;
    }

    return {
      play(nextTrack) {
        if (nextTrack && (!track || nextTrack.uri !== track.uri)) {
          track = nextTrack;
          positionMs = 0;
        }
        if (!track) return Promise.resolve();
        playing = true;
        start();
        emit();
        return Promise.resolve();
      },
      pause() {
        stop();
        emit();
        return Promise.resolve();
      },
      onChange(fn) { listeners.push(fn); },
      onEnded(fn) { endedListeners.push(fn); },
    };
  }

  // ---------------------------------------------------------------------------
  // Live implementation (HTTP). Endpoints are documented in web/README.md.
  // ---------------------------------------------------------------------------

  function request(method, path, body) {
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch(config.apiBase + path, options).then((response) => {
      if (!response.ok) {
        return response.text().then((text) => {
          throw new Error(text || response.statusText);
        });
      }
      return response.json();
    });
  }

  const liveApi = {
    getStatus: () => request("GET", "/spotify/status"),
    getOptions: () => request("GET", "/options"),
    getRecommendations: (profile, k) => request("POST", "/recommendations", Object.assign({}, profile, { k })),
    search: (query, profile) => request("POST", "/search", { query, profile }),
    scoreSong: (song, profile) => request("POST", "/score", { song, profile }),
    tagSong: (track, tags, profile) => request("POST", "/catalog/tag", { track, tags, profile }),
    likeTrack: (uri) => request("POST", "/spotify/like", { uri }),
    createPlaylist: (name, uris) => request("POST", "/spotify/playlist", { name, uris }),
    sendFeedback: (songId, action) => request("POST", "/feedback", { song_id: songId, action }),
  };

  // In live mode the backend work should provide window.FocusFlowPlayer with the
  // same shape as createMockPlayer() (play, pause, onChange, onEnded), for example
  // a wrapper around the Spotify Web Playback SDK. Until then the mock player runs.
  const player = (!config.useMock && window.FocusFlowPlayer) || createMockPlayer();

  window.FocusFlowAPI = Object.assign({}, config.useMock ? mockApi : liveApi, {
    player,
    isMock: !!config.useMock,
  });
})();
