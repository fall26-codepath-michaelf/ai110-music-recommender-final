// FocusFlow web UI: profile, flashcard picks, agent log, Spotify search and player.
// All data comes from window.FocusFlowAPI (see api.js).
(function () {
  "use strict";

  const api = window.FocusFlowAPI;

  const GENRE_COLORS = {
    "pop": "#FF9BB0", "lofi": "#B7C4FF", "rock": "#FF8A6E", "ambient": "#9FE3D0",
    "jazz": "#E8C27A", "synthwave": "#C59BFF", "indie pop": "#FFB86B", "folk": "#C9D98A",
    "country": "#E0A890", "hip hop": "#F2E35B", "classical": "#DCDCD2", "electronic": "#7FE0FF",
    "reggae": "#8FE08A", "r&b": "#F59AD6",
  };
  const CHIP_LIMIT = 3;

  const ICONS = {
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
    pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    skip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>',
  };

  const state = {
    options: { genres: [], moods: [] },
    profile: { favorite_genre: "lofi", favorite_mood: "focused", target_energy: 0.45, likes_acoustic: true },
    count: 5,
    expanded: { genre: false, mood: false, tagGenre: false, tagMood: false },
    result: null,
    cardIndex: 0,
    liked: new Set(),
    view: "picks",
    search: { query: "", results: [], selectedUri: null, tags: null, previewToken: 0 },
    player: { queue: [], index: -1, snapshot: { track: null, playing: false, positionMs: 0, durationMs: 0 } },
    refs: { cardProgress: null, tagPreview: null },
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === false || value === null || value === undefined) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (children || []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function fmtTime(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function fmtPoints(points) {
    return Number.isInteger(points) ? String(points) : points.toFixed(2);
  }

  function art(item, sizeClass) {
    const node = el("span", { class: "art " + sizeClass, "aria-hidden": "true" });
    if (item && item.artUrl) {
      node.appendChild(el("img", { src: item.artUrl, alt: "" }));
    } else {
      node.style.background = (item && GENRE_COLORS[item.genre]) || "#DDD6FE";
    }
    return node;
  }

  function trackFromSong(song) {
    if (!song || !song.spotify) return null;
    return {
      uri: song.spotify.uri,
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      artUrl: song.spotify.album_art_url,
      durationMs: song.spotify.duration_ms,
    };
  }

  function trackFromResult(result) {
    return {
      uri: result.uri,
      title: result.title,
      artist: result.artist,
      genre: result.catalog_song ? result.catalog_song.genre : null,
      artUrl: result.album_art_url,
      durationMs: result.duration_ms,
    };
  }

  function isPlaying(track) {
    const snap = state.player.snapshot;
    return !!(track && snap.track && snap.track.uri === track.uri && snap.playing);
  }

  function isCurrent(track) {
    const snap = state.player.snapshot;
    return !!(track && snap.track && snap.track.uri === track.uri);
  }

  // Re-rendering replaces buttons, so put focus back on the matching one.
  function preserveFocus(render) {
    const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
    render();
    if (key) {
      const target = document.querySelector('[data-focus-key="' + CSS.escape(key) + '"]');
      if (target) target.focus();
    }
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("toast--show"), 2600);
  }

  function showError(error) {
    console.error(error);
    showToast("Something went wrong: " + (error && error.message ? error.message : error));
  }

  // ---------------------------------------------------------------------------
  // Profile panel
  // ---------------------------------------------------------------------------

  function renderChipGroup(container, options, selected, expandedKey, onPick, focusPrefix) {
    container.replaceChildren();
    const expanded = state.expanded[expandedKey];
    const visible = expanded ? options : options.filter((opt, i) => i < CHIP_LIMIT || opt === selected);
    visible.forEach((opt) => {
      container.appendChild(el("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(opt === selected),
        "data-focus-key": focusPrefix + ":" + opt,
        text: opt,
        onClick: () => onPick(opt),
      }));
    });
    const hidden = options.length - visible.length;
    if (expanded || hidden > 0) {
      container.appendChild(el("button", {
        type: "button",
        class: "chip chip--more",
        "aria-expanded": String(expanded),
        "data-focus-key": focusPrefix + ":more",
        text: expanded ? "Show less" : "+" + hidden,
        "aria-label": expanded ? "Show fewer options" : "Show " + hidden + " more options",
        onClick: () => {
          state.expanded[expandedKey] = !expanded;
          preserveFocus(() => renderChipGroup(container, options, selected, expandedKey, onPick, focusPrefix));
        },
      }));
    }
  }

  function renderEnergy(blocksNode, valueNode, input, energy) {
    blocksNode.replaceChildren();
    const on = Math.round(energy * 10);
    for (let i = 0; i < 10; i++) {
      blocksNode.appendChild(el("span", { class: "energy__block" + (i < on ? " energy__block--on" : "") }));
    }
    valueNode.textContent = energy.toFixed(2);
    input.value = String(energy);
    input.setAttribute("aria-valuetext", energy.toFixed(2));
  }

  function renderProfile() {
    const profile = state.profile;
    renderChipGroup($("genre-chips"), state.options.genres, profile.favorite_genre, "genre", (genre) => {
      profile.favorite_genre = genre;
      preserveFocus(renderProfile);
    }, "genre");
    renderChipGroup($("mood-chips"), state.options.moods, profile.favorite_mood, "mood", (mood) => {
      profile.favorite_mood = mood;
      preserveFocus(renderProfile);
    }, "mood");
    renderEnergy($("energy-blocks"), $("energy-value"), $("energy-input"), profile.target_energy);
    $("acoustic-btn").setAttribute("aria-pressed", String(profile.likes_acoustic));
    $("produced-btn").setAttribute("aria-pressed", String(!profile.likes_acoustic));
  }

  async function findPicks() {
    const button = $("find-btn");
    button.disabled = true;
    button.textContent = "Finding…";
    try {
      state.result = await api.getRecommendations(Object.assign({}, state.profile), state.count);
      state.cardIndex = 0;
      renderPicks();
      renderAgent();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
      button.textContent = "Find my picks";
    }
  }

  // ---------------------------------------------------------------------------
  // Picks: flashcard deck and the rest of the list
  // ---------------------------------------------------------------------------

  function renderPicks() {
    const deck = $("deck");
    const upNext = $("up-next");
    deck.replaceChildren();
    upNext.replaceChildren();
    state.refs.cardProgress = null;

    const recs = state.result ? state.result.recommendations : [];
    const remaining = recs.length - state.cardIndex;
    deck.className = "deck" + (remaining <= 1 ? " deck--one" : remaining === 2 ? " deck--two" : "");

    if (!recs.length) {
      deck.appendChild(el("article", { class: "card card--empty" }, [
        el("h2", { text: "No picks yet" }),
        el("p", { text: "Set your profile and press “Find my picks”." }),
      ]));
      $("up-next-heading").hidden = true;
      return;
    }

    if (state.cardIndex >= recs.length) {
      deck.appendChild(el("article", { class: "card card--empty" }, [
        el("h2", { text: "That’s all " + recs.length + " picks" }),
        el("p", { text: "Start over, or change your profile for a new set." }),
        el("button", {
          type: "button", class: "btn btn--ink", "data-focus-key": "start-over", text: "Start over",
          onClick: () => { state.cardIndex = 0; preserveFocus(renderPicks); },
        }),
      ]));
    } else {
      deck.appendChild(buildCard(recs[state.cardIndex], state.cardIndex, recs.length));
    }

    $("up-next-heading").hidden = recs.length < 2;
    recs.forEach((rec, i) => {
      if (i === state.cardIndex) return;
      upNext.appendChild(buildRow(rec, i));
    });
  }

  function buildCard(rec, index, total) {
    const song = rec.song;
    const track = trackFromSong(song);
    const confidence = state.result.confidence;
    const current = isCurrent(track);
    const snap = state.player.snapshot;

    const fill = el("div", { class: "progress__fill" });
    const time = el("span", { text: current ? fmtTime(snap.positionMs) : track ? fmtTime(track.durationMs) : "--:--" });
    if (current && snap.durationMs) fill.style.width = (snap.positionMs / snap.durationMs) * 100 + "%";
    state.refs.cardProgress = current ? { fill, time } : null;

    const reasons = rec.reasons.length
      ? rec.reasons.map((r) => el("span", { class: "reason", text: r.factor + " +" + fmtPoints(r.points) }))
      : [el("span", { class: "reason", text: "no strong match" })];

    const liked = track && state.liked.has(track.uri);

    return el("article", { class: "card", "aria-label": "Pick " + (index + 1) + " of " + total + ": " + song.title }, [
      el("div", { class: "card__media" }, [
        art(Object.assign({ genre: song.genre }, track || {}), "art--lg"),
        el("div", { class: "mini-progress" }, [el("div", { class: "progress" }, [fill]), time]),
      ]),
      el("div", { class: "card__body" }, [
        el("div", { class: "card__top" }, [
          el("span", {
            class: "pill" + (confidence === "low" ? " pill--warn" : ""),
            text: (index + 1) + " of " + total + " · " + confidence + " confidence",
          }),
          el("div", { class: "score", "aria-label": "Score " + rec.score.toFixed(2) + " out of 11" }, [
            el("span", { class: "score__value", text: rec.score.toFixed(2), "aria-hidden": "true" }),
            el("span", { class: "score__max", text: "of 11", "aria-hidden": "true" }),
          ]),
        ]),
        el("div", {}, [
          el("h2", { class: "card__title", text: song.title }),
          el("div", { class: "card__sub", text: song.artist + " · " + song.genre + " · " + song.mood }),
          el("div", { class: "reasons" }, reasons),
        ]),
        el("div", { class: "card__actions" }, [
          el("button", {
            type: "button", class: "icon-btn icon-btn--lg icon-btn--outline",
            "aria-label": "Skip " + song.title, "data-focus-key": "card-skip", html: ICONS.skip,
            onClick: () => skipCard(song),
          }),
          el("button", {
            type: "button", class: "btn btn--ink", "data-focus-key": "card-play",
            disabled: !track,
            html: track ? (isPlaying(track) ? ICONS.pause + " Pause" : ICONS.play + " Play") : "Not on Spotify",
            onClick: () => togglePickPlayback(index),
          }),
          el("button", {
            type: "button", class: "icon-btn icon-btn--lg icon-btn--accent",
            "aria-label": "Save " + song.title + " to Spotify Liked Songs", "aria-pressed": String(!!liked),
            "data-focus-key": "card-like", disabled: !track, html: ICONS.heart,
            onClick: () => likeSong(song, track),
          }),
        ]),
      ]),
    ]);
  }

  function buildRow(rec, index) {
    const song = rec.song;
    const track = trackFromSong(song);
    return el("li", { class: "row" + (isCurrent(track) ? " row--active" : "") }, [
      art(Object.assign({ genre: song.genre }, track || {}), "art--xs"),
      el("button", {
        type: "button", class: "row__main", "data-focus-key": "row:" + song.id,
        "aria-label": "Show " + song.title + " on the card",
        onClick: () => { state.cardIndex = index; renderPicks(); },
      }, [
        el("div", { class: "row__title", text: song.title }),
        el("div", { class: "row__sub", text: song.artist + " · " + rec.score.toFixed(2) }),
      ]),
      el("button", {
        type: "button", class: "icon-btn", disabled: !track,
        "aria-label": (isPlaying(track) ? "Pause " : "Play ") + song.title,
        "data-focus-key": "row-play:" + song.id,
        html: isPlaying(track) ? ICONS.pause : ICONS.play,
        onClick: () => togglePickPlayback(index),
      }),
    ]);
  }

  function skipCard(song) {
    api.sendFeedback(song.id, "skip").catch(showError);
    state.cardIndex += 1;
    preserveFocus(renderPicks);
  }

  async function likeSong(song, track) {
    if (!track || state.liked.has(track.uri)) return;
    try {
      await api.likeTrack(track.uri);
      api.sendFeedback(song.id, "save").catch(showError);
      state.liked.add(track.uri);
      preserveFocus(renderPicks);
      showToast("Saved “" + song.title + "” to your Liked Songs");
    } catch (error) {
      showError(error);
    }
  }

  function togglePickPlayback(index) {
    const recs = state.result.recommendations;
    const track = trackFromSong(recs[index].song);
    if (!track) return;
    if (isPlaying(track)) {
      api.player.pause();
      return;
    }
    state.player.queue = recs.map((rec) => trackFromSong(rec.song));
    state.player.index = index;
    api.player.play(track).catch(showError);
  }

  // ---------------------------------------------------------------------------
  // Quality agent panel
  // ---------------------------------------------------------------------------

  function renderAgent() {
    const log = $("agent-log");
    log.replaceChildren();
    const result = state.result;
    if (!result) return;

    result.logs.forEach((line) => {
      const match = /^(PLAN|ACT|CHECK|REFLECT):\s*(.*)$/.exec(line);
      const step = match ? match[1] : "";
      const text = match ? match[2] : line;
      let cls = "bubble";
      if (step === "REFLECT") cls += result.confidence === "high" ? " bubble--accent" : " bubble--warn";
      log.appendChild(el("div", { class: cls }, [
        step ? el("span", { class: "bubble__step", text: step.toLowerCase() }) : null,
        text,
      ]));
    });

    const recs = result.recommendations;
    const found = recs.filter((rec) => rec.song.spotify).length;
    if (recs.length) {
      log.appendChild(el("div", { class: "bubble" }, [
        el("span", { class: "bubble__step", text: "spotify" }),
        found + " of " + recs.length + " found on Spotify." + (found ? " Want them as a playlist?" : ""),
      ]));
    }
    $("playlist-btn").hidden = found === 0;
  }

  async function savePlaylist() {
    const recs = state.result ? state.result.recommendations : [];
    const uris = recs.filter((rec) => rec.song.spotify).map((rec) => rec.song.spotify.uri);
    if (!uris.length) return;
    const name = "FocusFlow · " + state.profile.favorite_genre + " / " + state.profile.favorite_mood;
    const button = $("playlist-btn");
    button.disabled = true;
    try {
      await api.createPlaylist(name, uris);
      showToast("Saved “" + name + "” to Spotify");
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Search view
  // ---------------------------------------------------------------------------

  function setView(view) {
    state.view = view;
    const searching = view === "search";
    $("layout").classList.toggle("layout--search", searching);
    $("profile-panel").hidden = searching;
    $("agent-panel").hidden = searching;
    $("picks-view").hidden = searching;
    $("search-view").hidden = !searching;
    $("tag-panel").hidden = !searching;
  }

  async function runSearch(query) {
    state.search.query = query;
    setView("search");
    $("search-heading").textContent = "Searching for “" + query + "”…";
    $("results").replaceChildren();
    $("tag-panel").replaceChildren();
    try {
      const response = await api.search(query, Object.assign({}, state.profile));
      state.search.results = response.tracks;
      selectResult(response.tracks.length ? response.tracks[0].uri : null);
    } catch (error) {
      showError(error);
    }
  }

  function selectedResult() {
    return state.search.results.find((r) => r.uri === state.search.selectedUri) || null;
  }

  function selectResult(uri) {
    state.search.selectedUri = uri;
    state.search.tags = {
      genre: state.profile.favorite_genre,
      mood: state.profile.favorite_mood,
      energy: 0.5,
      acoustic: state.profile.likes_acoustic,
    };
    state.expanded.tagGenre = false;
    state.expanded.tagMood = false;
    preserveFocus(() => {
      renderResults();
      renderTagPanel();
    });
  }

  function renderResults() {
    const list = $("results");
    list.replaceChildren();
    const query = state.search.query;
    $("search-heading").textContent = "Results for “" + query + "”";

    if (!state.search.results.length) {
      list.appendChild(el("li", { class: "empty", text: "No songs found for “" + query + "”." }));
      return;
    }

    state.search.results.forEach((result, i) => {
      const track = trackFromResult(result);
      const selected = result.uri === state.search.selectedUri;
      const badge = result.catalog_song
        ? el("span", { class: "badge", text: "In FocusFlow · " + result.score.toFixed(2) })
        : el("span", { class: "badge badge--todo", text: "Not scored yet" });
      list.appendChild(el("li", { class: "result" + (selected ? " result--selected" : "") }, [
        art(track, "art--sm"),
        el("button", {
          type: "button", class: "row__main", "aria-pressed": String(selected),
          "data-focus-key": "result:" + result.uri,
          onClick: () => selectResult(result.uri),
        }, [
          el("div", { class: "row__title", text: result.title }),
          el("div", { class: "row__sub", text: result.artist }),
        ]),
        badge,
        el("span", { class: "result__time", text: fmtTime(result.duration_ms) }),
        el("button", {
          type: "button", class: "icon-btn" + (isPlaying(track) ? " icon-btn--accent" : ""),
          "aria-label": (isPlaying(track) ? "Pause " : "Play ") + result.title,
          "data-focus-key": "result-play:" + result.uri,
          html: isPlaying(track) ? ICONS.pause : ICONS.play,
          onClick: () => toggleResultPlayback(i),
        }),
      ]));
    });
  }

  function toggleResultPlayback(index) {
    const tracks = state.search.results.map(trackFromResult);
    const track = tracks[index];
    if (isPlaying(track)) {
      api.player.pause();
      return;
    }
    state.player.queue = tracks;
    state.player.index = index;
    api.player.play(track).catch(showError);
  }

  function renderTagPanel() {
    const panel = $("tag-panel");
    panel.replaceChildren();
    state.refs.tagPreview = null;
    const result = selectedResult();
    if (!result) return;

    const track = trackFromResult(result);
    panel.appendChild(el("div", { class: "tag-panel__head" }, [
      art(track, "art--md"),
      el("div", {}, [
        el("h2", { class: "tag-panel__title", text: result.title }),
        el("div", { class: "row__sub", text: result.artist + " · " + fmtTime(result.duration_ms) }),
      ]),
    ]));

    if (result.catalog_song) {
      const song = result.catalog_song;
      panel.appendChild(el("p", { text: "Already in your FocusFlow catalog." }));
      panel.appendChild(el("div", { class: "chips" }, [
        el("span", { class: "pill", text: song.genre }),
        el("span", { class: "pill", text: song.mood }),
        el("span", { class: "pill", text: "energy " + Number(song.energy).toFixed(2) }),
      ]));
      panel.appendChild(el("div", { class: "preview" }, [
        el("span", { text: "Scores for your profile" }),
        el("span", { class: "preview__value", text: result.score.toFixed(2) }),
      ]));
      return;
    }

    const tags = state.search.tags;
    panel.appendChild(el("p", { text: "FocusFlow needs a few tags before it can score a new song. Tag it once and it joins your catalog." }));

    const genreChips = el("div", { class: "chips", role: "group", "aria-labelledby": "tag-genre-label" });
    const moodChips = el("div", { class: "chips", role: "group", "aria-labelledby": "tag-mood-label" });
    const rerenderTagChips = () => {
      renderChipGroup(genreChips, state.options.genres, tags.genre, "tagGenre", (genre) => {
        tags.genre = genre;
        preserveFocus(rerenderTagChips);
        updatePreview();
      }, "tag-genre");
      renderChipGroup(moodChips, state.options.moods, tags.mood, "tagMood", (mood) => {
        tags.mood = mood;
        preserveFocus(rerenderTagChips);
        updatePreview();
      }, "tag-mood");
    };
    rerenderTagChips();

    const energyBlocks = el("div", { class: "energy__blocks", "aria-hidden": "true" });
    const energyValue = el("span");
    const energyInput = el("input", {
      id: "tag-energy", class: "energy__input", type: "range", min: "0", max: "1", step: "0.05",
      onInput: (event) => {
        tags.energy = Number(event.target.value);
        renderEnergy(energyBlocks, energyValue, energyInput, tags.energy);
        updatePreview();
      },
    });
    renderEnergy(energyBlocks, energyValue, energyInput, tags.energy);

    const acousticBtn = el("button", { type: "button", "aria-pressed": String(tags.acoustic), text: "Acoustic" });
    const producedBtn = el("button", { type: "button", "aria-pressed": String(!tags.acoustic), text: "Produced" });
    const setAcoustic = (value) => {
      tags.acoustic = value;
      acousticBtn.setAttribute("aria-pressed", String(value));
      producedBtn.setAttribute("aria-pressed", String(!value));
      updatePreview();
    };
    acousticBtn.addEventListener("click", () => setAcoustic(true));
    producedBtn.addEventListener("click", () => setAcoustic(false));

    const previewValue = el("span", { class: "preview__value", text: "–" });
    state.refs.tagPreview = previewValue;

    const saveBtn = el("button", {
      type: "button", class: "btn btn--accent btn--block", "data-focus-key": "tag-save",
      text: "Save tags & add to catalog",
      onClick: () => saveTags(result, saveBtn),
    });

    panel.append(
      el("div", { class: "field" }, [el("div", { class: "field__label", id: "tag-genre-label", text: "genre" }), genreChips]),
      el("div", { class: "field" }, [el("div", { class: "field__label", id: "tag-mood-label", text: "mood" }), moodChips]),
      el("div", { class: "field" }, [
        el("div", { class: "field__label field__label--row" }, [el("label", { for: "tag-energy", text: "energy" }), energyValue]),
        el("div", { class: "energy" }, [energyBlocks, energyInput]),
      ]),
      el("div", { class: "segmented", role: "group", "aria-label": "Sound" }, [acousticBtn, producedBtn]),
      el("div", { class: "preview" }, [el("span", { text: "Would score for you" }), previewValue]),
      saveBtn
    );
    updatePreview();
  }

  async function updatePreview() {
    const tags = state.search.tags;
    const token = ++state.search.previewToken;
    try {
      const song = { genre: tags.genre, mood: tags.mood, energy: tags.energy, acousticness: tags.acoustic ? 0.8 : 0.2 };
      const { score } = await api.scoreSong(song, Object.assign({}, state.profile));
      if (token === state.search.previewToken && state.refs.tagPreview) {
        state.refs.tagPreview.textContent = score.toFixed(2);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function saveTags(result, button) {
    button.disabled = true;
    try {
      const response = await api.tagSong(result, Object.assign({}, state.search.tags), Object.assign({}, state.profile));
      result.catalog_song = response.song;
      result.score = response.score;
      preserveFocus(() => {
        renderResults();
        renderTagPanel();
      });
      showToast("Added “" + result.title + "” to your catalog");
    } catch (error) {
      showError(error);
      button.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------------

  function renderPlayerBar() {
    const snap = state.player.snapshot;
    const track = snap.track;
    $("player-title").textContent = track ? track.title : "Nothing playing";
    $("player-artist").textContent = track ? track.artist : "Pick a song to start";
    const artNode = $("player-art");
    artNode.replaceChildren();
    artNode.style.background = "";
    if (track && track.artUrl) artNode.appendChild(el("img", { src: track.artUrl, alt: "" }));
    else artNode.style.background = (track && GENRE_COLORS[track.genre]) || "#4C2A8C";

    const toggle = $("player-toggle");
    toggle.innerHTML = snap.playing ? ICONS.pause : ICONS.play;
    toggle.setAttribute("aria-label", snap.playing ? "Pause" : "Play");
    $("player-prev").disabled = state.player.index <= 0;
    $("player-next").disabled = state.player.index < 0 || state.player.index >= state.player.queue.length - 1;
    renderPlayerProgress();
  }

  function renderPlayerProgress() {
    const snap = state.player.snapshot;
    const pct = snap.durationMs ? (snap.positionMs / snap.durationMs) * 100 : 0;
    $("player-elapsed").textContent = fmtTime(snap.positionMs);
    $("player-duration").textContent = fmtTime(snap.durationMs);
    $("player-fill").style.width = pct + "%";
    $("player-bar").setAttribute("aria-valuenow", String(Math.round(pct)));
    const card = state.refs.cardProgress;
    if (card) {
      card.fill.style.width = pct + "%";
      card.time.textContent = fmtTime(snap.positionMs);
    }
  }

  function onPlayerChange(snap) {
    const prev = state.player.snapshot;
    state.player.snapshot = snap;
    const trackChanged = (prev.track && prev.track.uri) !== (snap.track && snap.track.uri);
    if (trackChanged || prev.playing !== snap.playing) {
      renderPlayerBar();
      preserveFocus(() => {
        if (state.view === "search") renderResults();
        else renderPicks();
      });
    } else {
      renderPlayerProgress();
    }
  }

  function playAt(index) {
    const queue = state.player.queue;
    for (let i = index; i >= 0 && i < queue.length; i += index >= state.player.index ? 1 : -1) {
      if (queue[i]) {
        state.player.index = i;
        api.player.play(queue[i]).catch(showError);
        return;
      }
    }
  }

  function togglePlayerBar() {
    const snap = state.player.snapshot;
    if (snap.playing) {
      api.player.pause();
    } else if (snap.track) {
      api.player.play().catch(showError);
    } else if (state.result && state.result.recommendations.length) {
      togglePickPlayback(Math.min(state.cardIndex, state.result.recommendations.length - 1));
    }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  function renderStatus(status) {
    const connected = !!(status && status.connected);
    $("spotify-dot").classList.toggle("status-dot--on", connected);
    $("spotify-status").textContent = connected ? "Spotify connected" : "Spotify not connected";
    const name = connected && status.user ? status.user.display_name || "" : "";
    $("avatar").textContent = name ? name[0].toUpperCase() : "?";
    $("player-device").textContent = api.isMock ? "Demo mode · no audio" : "Playing on this browser";
  }

  function bindEvents() {
    $("energy-input").addEventListener("input", (event) => {
      state.profile.target_energy = Number(event.target.value);
      renderEnergy($("energy-blocks"), $("energy-value"), $("energy-input"), state.profile.target_energy);
    });
    $("acoustic-btn").addEventListener("click", () => { state.profile.likes_acoustic = true; renderProfile(); });
    $("produced-btn").addEventListener("click", () => { state.profile.likes_acoustic = false; renderProfile(); });
    $("count-select").addEventListener("change", (event) => { state.count = Number(event.target.value); });
    $("find-btn").addEventListener("click", findPicks);
    $("playlist-btn").addEventListener("click", savePlaylist);

    $("search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const query = $("search-input").value.trim();
      if (query) runSearch(query);
    });
    $("search-input").addEventListener("input", (event) => {
      $("search-clear").hidden = !event.target.value;
    });
    $("search-clear").addEventListener("click", () => {
      $("search-input").value = "";
      $("search-clear").hidden = true;
      $("search-input").focus();
      setView("picks");
      renderPicks();
    });
    $("back-btn").addEventListener("click", () => { setView("picks"); renderPicks(); });
    $("brand").addEventListener("click", (event) => {
      event.preventDefault();
      setView("picks");
      renderPicks();
    });

    $("player-toggle").addEventListener("click", togglePlayerBar);
    $("player-next").addEventListener("click", () => playAt(state.player.index + 1));
    $("player-prev").addEventListener("click", () => playAt(state.player.index - 1));
    api.player.onChange(onPlayerChange);
    api.player.onEnded(() => playAt(state.player.index + 1));
  }

  async function init() {
    const countSelect = $("count-select");
    for (let n = 3; n <= 8; n++) {
      countSelect.appendChild(el("option", { value: String(n), text: String(n), selected: n === state.count }));
    }
    bindEvents();
    renderPlayerBar();
    renderPicks();

    api.getStatus().then(renderStatus).catch(() => renderStatus({ connected: false }));
    try {
      state.options = await api.getOptions();
      renderProfile();
      await findPicks();
    } catch (error) {
      showError(error);
    }
  }

  init();
})();
