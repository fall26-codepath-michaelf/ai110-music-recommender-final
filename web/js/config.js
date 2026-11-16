// Runtime settings for the FocusFlow web UI.
// useMock: true runs everything in the browser with fake Spotify data.
// Set it to false once the backend described in web/README.md is running.
window.FOCUSFLOW_CONFIG = {
  useMock: true,
  apiBase: "/api",
  catalogCsvUrl: "../data/songs.csv",
};
