"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Real renderer script, deliberately exercised with a tiny in-memory DOM.
// No Electron, capture, network, or renderer application initialization.
const source = fs.readFileSync(path.join(__dirname, "..", "war-room.js"), "utf8");

class Element {
  constructor(tagName = "div", id = "", attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.attrs = { ...attrs };
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.descendants = [];
    this.style = { setProperty(key, value) { this[key] = value; } };
    this.hidden = Boolean(attrs.hidden !== undefined);
    this.disabled = false;
    this.value = attrs.value || "";
    this.textContent = "";
    this.srcObject = null;
    this.parentNode = null;
    this.nextSibling = null;
    this.clicks = 0;
    this.options = [];
    this.tabIndex = 0;
    this.className = attrs.class || "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const all = new Set(this.className.split(/\s+/).filter(Boolean));
        if (enabled) all.add(name); else all.delete(name);
        this.className = Array.from(all).join(" ");
      }
    };
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
        this.dataset[key] = value;
      }
    }
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] || null; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name, event) { this.listeners.get(name)?.(event); }
  dispatchEvent(event) { this.dispatch(event.type, event); return true; }
  closest(selector) {
    if (selector === "button") return this.tagName === "BUTTON" ? this : null;
    const dataName = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
    const key = dataName?.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    return key && this.dataset[key] !== undefined ? this : null;
  }
  focus() { this.document.activeElement = this; }
  click() {
    this.clicks += 1;
    this.dispatch("click", { target: this });
  }
  appendChild(child) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((x) => x !== child);
    child.parentNode = null;
    return child;
  }
  insertBefore(child, before) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of nodes) this.appendChild(child);
    if (this.tagName === "SELECT") this.options = this.children;
  }
  set innerHTML(markup) {
    this.markup = markup;
    this.descendants = [];
    // Only the attributes consumed by War Room need to be represented.
    const tags = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
    for (const match of markup.matchAll(tags)) {
      const attrs = {};
      for (const attr of match[2].matchAll(/([a-z][a-z0-9-]*)=(?:"([^"]*)"|'([^']*)')/gi)) {
        attrs[attr[1]] = attr[2] ?? attr[3];
      }
      if (/\shidden(?:\s|$)/.test(match[2])) attrs.hidden = "";
      if (!attrs.id && attrs.class !== "wr-nav" && !Object.keys(attrs).some(x => x.startsWith("data-wr-"))) continue;
      const node = new Element(match[1], attrs.id || "", attrs);
      // Mirror literal initial text such as <strong id="wr-session-streams">0</strong>.
      node.textContent = markup.slice(match.index + match[0].length).split("<", 1)[0].trim();
      node.document = this.document;
      node.parentNode = this;
      this.descendants.push(node);
      if (attrs.id) this.document.byId.set(attrs.id, node);
    }
  }
  querySelectorAll(selector) {
    const data = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
    if (!data) return [];
    const key = data.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    return this.descendants.filter(node => node.dataset[key] !== undefined);
  }
  querySelector(selector) {
    if (selector === ".wr-nav") return this.descendants.find(node => node.className === "wr-nav") || null;
    const data = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
    if (!data) return null;
    const key = data[1].replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    return this.descendants.find(node => node.dataset[key] === data[2]) || null;
  }
  scrollIntoView() {}
  play() { this.plays = (this.plays || 0) + 1; return Promise.resolve(); }
}
class Observer {
  constructor(callback) { this.callback = callback; }
  observe(target) {
    if (!target.__observers) target.__observers = [];
    target.__observers.push(this.callback);
  }
}

function launch({ alreadyLive = false } = {}) {
  const byId = new Map();
  const document = {
    byId,
    activeElement: null,
    getElementById(id) { return byId.get(id) || null; },
    createElement(tag) {
      const node = new Element(tag);
      node.document = document;
      return node;
    },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    createDocumentFragment() { return document.createElement("fragment"); },
    querySelector(selector) { return selector === ".app-shell" ? root : null; }
  };
  const attach = (id, tag = "div") => {
    const node = document.createElement(tag);
    node.id = id;
    byId.set(id, node);
    return node;
  };

  const root = attach("appRoot");
  const classic = attach("oldBlueShell", "main");
  const host = attach("warRoomHost");
  host.hidden = true;
  root.appendChild(classic);
  root.appendChild(host);
  const previewHome = document.createElement("div");
  const preview = attach("streamPreview", "video");
  preview.hidden = true;
  previewHome.appendChild(preview);
  const classicEmpty = attach("streamPreviewEmpty");
  previewHome.appendChild(classicEmpty);
  const originalControlIds = [
    "startWatchingBtn", "stopWatchingBtn", "scanImportBtn", "refreshStreamSourcesBtn",
    "startNativeStreamBtn", "stopNativeStreamBtn", "copySupportBtn"
  ];
  for (const id of originalControlIds) attach(id, "button");
  const originalSelect = attach("streamSourceSelect", "select");
  originalSelect.options = [];
  const modeButtons = ["stable", "screen", "sharp"].map(key => {
    const node = document.createElement("button");
    node.dataset.streamMode = key;
    node.document = document;
    return node;
  });
  classic.descendants.push(...modeButtons);
  for (const id of [
    "watcherStateText", "watcherStateDetailText", "folderReadyText",
    "streamStatePill", "streamReadoutSummary", "streamReadoutDetail"
  ]) attach(id);
  byId.get("watcherStateText").textContent = "Watching for new replays";
  byId.get("folderReadyText").textContent = "Folder ready";
  byId.get("streamStatePill").textContent = alreadyLive ? "Live" : "Idle";
  const callbacks = new Map();
  const watcherApi = {};
  for (const name of [
    "onState", "onConfig", "onAppInfo", "onResourceProfile", "onImportState", "onRuntimeEvent", "onPlayerSummary"
  ]) watcherApi[name] = callback => callbacks.set(name, callback);
  const preferences = new Map();
  const timers = new Map();
  let nextTimerId = 0;
  const setTimeoutFake = (fn, delay) => {
    const id = ++nextTimerId;
    timers.set(id, { fn, delay });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  const window = {
    watcherApi,
    WarRoomPlayer: require("../war-room-player"),
    localStorage: {
      getItem: key => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value)
    }
  };
  for (const node of byId.values()) node.document = document;
  vm.runInNewContext(source, {
    window, document, MutationObserver: Observer, Event: class { constructor(type) { this.type = type; } },
    Date, String, Number, Boolean, Array, Object, Math, Promise,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
  }, { filename: "war-room.js" });
  const picker = root.children.find(node => node.className === "wr-theme-picker");
  assert.ok(picker, "appearance picker must be mounted");
  const clickTheme = name => {
    const button = picker.querySelectorAll("[data-wr-theme]").find(n => n.dataset.wrTheme === name);
    assert.ok(button, "unknown theme: " + name);
    picker.dispatch("click", { target: button });
    return button;
  };
  const clickTab = name => {
    const button = host.querySelectorAll("[data-wr-tab]").find(n => n.dataset.wrTab === name);
    assert.ok(button, "unknown tab: " + name);
    host.dispatch("click", { target: button });
    return button;
  };
  const notifyFolder = label => {
    const element = byId.get("folderReadyText");
    element.textContent = label;
    for (const callback of element.__observers || []) callback();
  };
  return { document, root, classic, host, preview, previewHome, originalSelect,
    originalControlIds, preferences, callbacks, clickTheme, clickTab, byId, timers, notifyFolder };
}

test("Old Blue and War Room switch without changing the original renderer or monitoring", () => {
  const app = launch();
  assert.equal(app.classic.hidden, true);
  assert.equal(app.host.hidden, false);
  app.clickTheme("old-blue");
  assert.equal(app.classic.hidden, false);
  assert.equal(app.host.hidden, true);
  assert.equal(app.preferences.get("aoe2war.watcher.display-theme.v1"), "old-blue");
  app.clickTheme("war-room");
  assert.equal(app.classic.hidden, true);
  assert.equal(app.host.hidden, false);
  // Choosing appearance does not dispatch any native action.
  for (const id of app.originalControlIds) assert.equal(app.byId.get(id).clicks, 0);
});

test("real Watcher state and imports update the War Room, without making up results", () => {
  const app = launch();
  app.callbacks.get("onConfig")({ watchDir: "/saved", uploadApiKey: "configured" });
  app.notifyFolder("Folder ready");
  app.callbacks.get("onState")({ isWatching: true });
  assert.equal(app.byId.get("wr-paired").textContent, "Watcher key configured");
  assert.equal(app.byId.get("wr-folder-text").textContent, "Validated");
  assert.equal(app.byId.get("wr-status").textContent, "Watching for new replays");
  app.callbacks.get("onImportState")({
    percent: 50, isRunning: true, uploaded: 4, reviewRouted: 2,
    recentItems: [{ fileName: "battle.aoe2record", status: "review_routed" }]
  });
  assert.equal(app.byId.get("wr-import-uploaded").textContent, "4");
  assert.equal(app.byId.get("wr-import-review").textContent, "2");
  assert.equal(app.byId.get("wr-battle-review").textContent, "2");
  assert.equal(app.byId.get("wr-import-bar").style.width, "50%");
  assert.equal(app.byId.get("wr-import-recent").children.length, 1);
});

test("one native preview element returns to Old Blue after theme or tab changes", () => {
  const app = launch();
  const original = app.preview;
  original.hidden = false;
  original.srcObject = { tracks: ["already-owned-by-classic"] };
  app.byId.get("streamStatePill").textContent = "Live";
  app.clickTab("broadcast");
  assert.equal(original.parentNode, app.byId.get("wr-preview-slot"));
  assert.equal(app.byId.get("wr-preview-empty").hidden, true);
  assert.equal(app.byId.get("wr-session-streams").textContent, "1", "new Idle-to-Live transition counts once");
  app.clickTheme("old-blue");
  assert.equal(original.parentNode, app.previewHome);
  assert.equal(app.byId.get("wr-session-streams").textContent, "1", "theme switching does not count another stream");
  app.clickTheme("war-room");
  app.clickTab("broadcast");
  assert.equal(original.parentNode, app.byId.get("wr-preview-slot"));
  app.clickTab("overview");
  assert.equal(original.parentNode, app.previewHome);
  assert.strictEqual(original, app.preview, "video element identity must be retained");
  assert.strictEqual(original.srcObject.tracks[0], "already-owned-by-classic");
});

test("War Room forwards only enabled original actions and does not start a second engine", () => {
  const app = launch();
  const button = app.host.querySelectorAll("[data-wr-action]")
    .find(node => node.dataset.wrAction === "startWatchingBtn");
  const original = app.byId.get("startWatchingBtn");
  original.disabled = true;
  app.host.dispatch("click", { target: button });
  assert.equal(original.clicks, 0, "disabled source action must not fire");
  original.disabled = false;
  app.host.dispatch("click", { target: button });
  assert.equal(original.clicks, 1);
  assert.equal(app.classic.hidden, true, "existing controls can operate while Classic is hidden");
});

test("CPU chart uses distinct timestamped samples and ignores duplicate app-info snapshots", () => {
  const app = launch();
  const send = app.callbacks.get("onResourceProfile");
  send({ sampledAt: "2026-10-19T10:00:00.000Z", cpuPercent: 0.1, workingSetMb: 200 });
  send({ sampledAt: "2026-10-19T10:00:00.000Z", cpuPercent: 0.1, workingSetMb: 200 });
  assert.equal(app.byId.get("wr-chart").getAttribute("aria-label"), "Recent Watcher CPU samples");
  send({ sampledAt: "2026-10-19T10:01:00.000Z", cpuPercent: 0.2, workingSetMb: 201 });
  assert.match(app.byId.get("wr-chart").getAttribute("aria-label"), /2 actual CPU samples/);
  send({ sampledAt: "2026-10-19T10:01:00.000Z", cpuPercent: 0.2, workingSetMb: 201 });
  assert.match(app.byId.get("wr-chart").getAttribute("aria-label"), /2 actual CPU samples/);
});

test("out-of-order CPU measurements cannot rewind charts or current process readouts", () => {
  const app = launch();
  const profile = app.callbacks.get("onResourceProfile");
  profile({ sampledAt: "2026-10-19T12:02:00Z", cpuPercent: 0.3, workingSetMb: 208 });
  profile({ sampledAt: "2026-10-19T12:03:00Z", cpuPercent: 0.5, workingSetMb: 211 });
  assert.equal(app.byId.get("wr-sys-cpu").textContent, "0.5%");
  assert.equal(app.byId.get("wr-sys-ram").textContent, "211 MB");
  assert.match(app.byId.get("wr-chart").getAttribute("aria-label"), /2 actual CPU samples/);
  profile({ sampledAt: "2026-10-19T12:01:00Z", cpuPercent: 99, workingSetMb: 900 });
  profile({ sampledAt: "2026-10-19T12:03:00Z", cpuPercent: 77, workingSetMb: 800 });
  assert.equal(app.byId.get("wr-sys-cpu").textContent, "0.5%");
  assert.equal(app.byId.get("wr-sys-ram").textContent, "211 MB");
  assert.match(app.byId.get("wr-chart").getAttribute("aria-label"), /2 actual CPU samples/);
  profile({ sampledAt: "2026-10-19T12:04:00Z", cpuPercent: 0.7, workingSetMb: 215 });
  assert.equal(app.byId.get("wr-sys-cpu").textContent, "0.7%");
  assert.match(app.byId.get("wr-chart").getAttribute("aria-label"), /3 actual CPU samples/);
});

test("launching with an already-live stream does not invent another start", () => {
  const app = launch({ alreadyLive: true });
  assert.equal(app.byId.get("wr-session-streams").textContent, "0");
  app.clickTab("broadcast");
  app.clickTheme("old-blue");
  app.clickTheme("war-room");
  assert.equal(app.byId.get("wr-session-streams").textContent, "0");
});

test("War Room source selection passes through Classic's change handler exactly once", () => {
  const app = launch();
  const selected = app.document.createElement("option");
  selected.value = "window:123";
  selected.textContent = "AoE2 HD — selected window";
  const fallback = app.document.createElement("option");
  fallback.value = "screen:1";
  fallback.textContent = "Display 1";
  app.originalSelect.options = [selected, fallback];
  let sourceChanges = 0;
  app.originalSelect.addEventListener("change", () => sourceChanges++);
  app.clickTab("broadcast");
  const warPicker = app.byId.get("wr-source");
  assert.equal(warPicker.options.length, 2);
  warPicker.value = "window:123";
  warPicker.dispatch("change", { type: "change" });
  assert.equal(app.originalSelect.value, "window:123");
  assert.equal(sourceChanges, 1);
  // Malicious/stale option cannot override the source list exposed by Classic.
  warPicker.value = "window:missing";
  warPicker.dispatch("change", { type: "change" });
  assert.equal(app.originalSelect.value, "window:123");
  assert.equal(sourceChanges, 1);
});

test("War Room mode selection delegates to the original mode button", () => {
  const app = launch();
  const warButton = app.host.querySelectorAll("[data-wr-mode]")
    .find(button => button.dataset.wrMode === "screen");
  const original = app.classic.descendants.find(button => button.dataset.streamMode === "screen");
  app.host.dispatch("click", { target: warButton });
  assert.equal(original.clicks, 1);
  original.disabled = true;
  app.host.dispatch("click", { target: warButton });
  assert.equal(original.clicks, 1, "disabled Classic mode must block War Room");
});

test("Watcher issue is visible in the War Room and never shown as healthy", () => {
  const app = launch();
  app.byId.get("watcherStateText").textContent = "Watching with a recent issue";
  app.byId.get("watcherStateDetailText").textContent = "A replay upload failed.";
  app.callbacks.get("onState")({ isWatching: true });
  assert.equal(app.byId.get("wr-hero-headline").textContent, "Attention needed");
  assert.equal(app.byId.get("wr-detail").textContent, "A replay upload failed.");
  assert.equal(app.byId.get("wr-dot").className.includes(" ok"), false);
});

test("verified owner-supplied summary paints concise battle and broadcast intelligence", () => {
  const app = launch();
  const now = new Date().toISOString();
  const publish = app.callbacks.get("onPlayerSummary");
  publish({
    schemaVersion: 1, status: "verified", generatedAt: now,
    player: { displayName: "Emaren" },
    record: { wins: 12, losses: 3, unresolved: 2 },
    ratings: {
      rm: { value: 1350, authority: "steam", asOf: now },
      dm: { value: 1500, authority: "steam", asOf: now }
    },
    recentMatches: [{ opponent: "Jim", map: "Forest Prison", mode: "dm",
      result: "win", playedAt: now }],
    streaming: { sessions: 4, airtimeSeconds: 3720, peakConcurrentViewers: null }
  });
  assert.equal(app.byId.get("wr-player-name").textContent, "Emaren");
  assert.equal(app.byId.get("wr-wins-losses").textContent, "12 / 3");
  assert.equal(app.byId.get("wr-win-rate").textContent, "80%");
  assert.equal(app.byId.get("wr-rating").textContent, "1350 / 1500");
  assert.equal(app.byId.get("wr-recent-matches").children.length, 1);
  assert.equal(app.byId.get("wr-total-streams").textContent, "4");
  assert.equal(app.byId.get("wr-total-airtime").textContent, "1h 02m");
  assert.equal(app.byId.get("wr-peak-viewers").textContent, "—");
  publish({ schemaVersion: 1, status: "unauthorized" });
  assert.equal(app.byId.get("wr-player-name").textContent, "Player profile awaiting verification");
  assert.equal(app.byId.get("wr-wins-losses").textContent, "— / —");
  assert.equal(app.byId.get("wr-rating").textContent, "— / —");
  assert.equal(app.byId.get("wr-total-streams").textContent, "—");
});

test("a credential configuration update clears any previously verified player's display", () => {
  const app = launch();
  const now = new Date().toISOString();
  app.callbacks.get("onPlayerSummary")({
    schemaVersion: 1, status: "verified", generatedAt: now,
    player: { displayName: "FirstPlayer" },
    record: { wins: 10, losses: 2, unresolved: 0 },
    ratings: {}, recentMatches: [], streaming: null
  });
  assert.equal(app.byId.get("wr-player-name").textContent, "FirstPlayer");
  app.callbacks.get("onConfig")({ watchDir: "/replays", uploadApiKey: "rotated" });
  assert.equal(app.byId.get("wr-player-name").textContent, "Player profile awaiting verification");
  assert.equal(app.byId.get("wr-wins-losses").textContent, "— / —");
});

test("one-shot expiry clears verified player data; a newer response cancels the previous timer", () => {
  const app = launch();
  const event = app.callbacks.get("onPlayerSummary");
  const make = name => ({
    schemaVersion: 1, status: "verified", generatedAt: new Date().toISOString(),
    player: { displayName: name }, record: { wins: 1, losses: 0, unresolved: 0 },
    ratings: {}, recentMatches: [], streaming: { sessions: null, airtimeSeconds: null, peakConcurrentViewers: null }
  });
  event(make("First"));
  assert.equal(app.timers.size, 1);
  const earlier = [...app.timers.values()][0].fn;
  event(make("Second"));
  assert.equal(app.timers.size, 1, "new summary replaces the one pending expiry");
  earlier();
  assert.equal(app.byId.get("wr-player-name").textContent, "Second", "obsolete timeout cannot clear newer summary");
  const latest = [...app.timers.values()][0].fn;
  latest();
  assert.equal(app.byId.get("wr-player-name").textContent, "Player profile awaiting verification");
  assert.equal(app.byId.get("wr-total-airtime").textContent, "—");
  assert.equal(app.byId.get("wr-overview-airtime").textContent, "—");
  assert.equal(app.timers.size, 0);
});

test("Overview and Broadcast totals come from the same verified streaming projection", () => {
  const app = launch();
  app.callbacks.get("onPlayerSummary")({
    schemaVersion: 1, status: "verified", generatedAt: new Date().toISOString(),
    player: { displayName: "Commander" },
    record: { wins: 5, losses: 2, unresolved: null }, ratings: {}, recentMatches: [],
    streaming: { sessions: 7, airtimeSeconds: 9000, peakConcurrentViewers: null }
  });
  assert.equal(app.byId.get("wr-total-streams").textContent, "7");
  assert.equal(app.byId.get("wr-overview-streams").textContent, "7");
  assert.equal(app.byId.get("wr-total-airtime").textContent, "2h 30m");
  assert.equal(app.byId.get("wr-overview-airtime").textContent, "2h 30m");
  app.callbacks.get("onConfig")({ watchDir: "/saved", uploadApiKey: "" });
  for (const id of ["wr-total-streams","wr-overview-streams","wr-total-airtime","wr-overview-airtime"])
    assert.equal(app.byId.get(id).textContent, "—");
});

test("current Classic validation overrides old app-info in both directions", () => {
  const app = launch();
  app.callbacks.get("onConfig")({ watchDir: "/replays", uploadApiKey: "present" });
  app.notifyFolder("Folder missing");
  assert.equal(app.byId.get("wr-folder-text").textContent, "Check in Old Blue");
  // An older app-info result cannot override the original renderer's
  // current asynchronous folder-validation result.
  app.callbacks.get("onAppInfo")({ watchDirStatus: { valid: false } });
  app.notifyFolder("Folder ready");
  assert.equal(app.byId.get("wr-folder-text").textContent, "Validated");
  app.callbacks.get("onAppInfo")({ watchDirStatus: { valid: false } });
  assert.equal(app.byId.get("wr-folder-text").textContent, "Validated");
  app.notifyFolder("Folder missing");
  assert.equal(app.byId.get("wr-folder-text").textContent, "Check in Old Blue");
  app.callbacks.get("onAppInfo")({ watchDirStatus: { valid: true } });
  assert.equal(app.byId.get("wr-folder-text").textContent, "Check in Old Blue");
  app.callbacks.get("onConfig")({ watchDir: "/other", uploadApiKey: "present" });
  assert.equal(app.byId.get("wr-folder-text").textContent, "Check in Old Blue",
    "path change requires revalidation");
  app.notifyFolder("Folder ready");
  assert.equal(app.byId.get("wr-folder-text").textContent, "Validated");
});

test("ten active-stream theme changes do not spawn extra native actions or duplicate preview", () => {
  const app = launch({ alreadyLive: true });
  app.preview.srcObject = { identity: "original-capture" };
  app.preview.hidden = false;
  for (let i = 0; i < 10; i++) {
    app.clickTab("broadcast");
    assert.strictEqual(app.preview.parentNode, app.byId.get("wr-preview-slot"));
    app.clickTheme("old-blue");
    assert.strictEqual(app.preview.parentNode, app.previewHome);
    app.clickTheme("war-room");
  }
  assert.equal(app.byId.get("wr-session-streams").textContent, "0");
  for (const id of app.originalControlIds) assert.equal(app.byId.get(id).clicks, 0);
  assert.strictEqual(app.preview.srcObject.identity, "original-capture");
});

test("War Room requires display-share consent for a selected macOS screen", () => {
  const app = launch();
  const display = app.document.createElement("option");
  display.value = "screen:1";
  display.textContent = "Display - Built-in Retina Display";
  const windowSource = app.document.createElement("option");
  windowSource.value = "window:42";
  windowSource.textContent = "Window - Age of Empires II HD";
  app.originalSelect.options = [display, windowSource];
  app.originalSelect.value = "screen:1";
  const goLive = app.host.querySelectorAll("[data-wr-action]")
    .find(button => button.dataset.wrAction === "startNativeStreamBtn");
  const nativeGoLive = app.byId.get("startNativeStreamBtn");
  app.clickTab("broadcast");
  assert.equal(app.byId.get("wr-display-consent").hidden, false);
  assert.equal(goLive.disabled, true, "display source must not start without confirmation");
  app.host.dispatch("click", { target: goLive });
  assert.equal(nativeGoLive.clicks, 0, "synthetic forwarding must also fail closed");

  const checkbox = app.byId.get("wr-display-confirm");
  checkbox.checked = true;
  checkbox.dispatch("change", { type: "change" });
  assert.equal(goLive.disabled, false);
  app.host.dispatch("click", { target: goLive });
  assert.equal(nativeGoLive.clicks, 1, "acknowledged display can use original native start");

  const picker = app.byId.get("wr-source");
  picker.value = "window:42";
  picker.dispatch("change", { type: "change" });
  assert.equal(app.originalSelect.value, "window:42");
  assert.equal(checkbox.checked, false, "consent cannot leak across capture sources");
  assert.equal(app.byId.get("wr-display-consent").hidden, true);
  assert.equal(goLive.disabled, false, "recognized game window needs no display consent");
  app.host.dispatch("click", { target: goLive });
  assert.equal(nativeGoLive.clicks, 2);
  assert.equal(app.originalSelect.value, "window:42");
});

test("unselected display is not an implicit fallback when starting in War Room", () => {
  const app = launch();
  const placeholder = app.document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose game window or display";
  const display = app.document.createElement("option");
  display.value = "screen:only";
  display.textContent = "Display - External monitor";
  app.originalSelect.options = [placeholder, display];
  app.originalSelect.value = "";
  const goLive = app.host.querySelectorAll("[data-wr-action]")
    .find(button => button.dataset.wrAction === "startNativeStreamBtn");
  app.clickTab("broadcast");
  assert.equal(goLive.disabled, true);
  assert.match(app.byId.get("wr-capture-guard").textContent, /Choose a specific game window or display/);
  app.host.dispatch("click", { target: goLive });
  assert.equal(app.byId.get("startNativeStreamBtn").clicks, 0);

  const picker = app.byId.get("wr-source");
  picker.value = "screen:only";
  picker.dispatch("change", { type: "change" });
  assert.equal(goLive.disabled, true, "selecting the display alone is not enough");
  const confirmation = app.byId.get("wr-display-confirm");
  confirmation.checked = true;
  confirmation.dispatch("change", { type: "change" });
  assert.equal(goLive.disabled, false);
  app.host.dispatch("click", { target: goLive });
  assert.equal(app.byId.get("startNativeStreamBtn").clicks, 1);
});

test("without enumerated capture sources the original macOS OS picker remains available", () => {
  const app = launch();
  const goLive = app.host.querySelectorAll("[data-wr-action]")
    .find(button => button.dataset.wrAction === "startNativeStreamBtn");
  app.clickTab("broadcast");
  assert.equal(app.byId.get("wr-display-consent").hidden, true);
  assert.equal(goLive.disabled, false);
  app.host.dispatch("click", { target: goLive });
  assert.equal(app.byId.get("startNativeStreamBtn").clicks, 1);
  // The OS still owns native capture permission and source-choice UI.
});
