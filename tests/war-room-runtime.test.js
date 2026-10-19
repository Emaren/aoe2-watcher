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
    this.style = {};
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
      contains: (name) => this.className.split(/\s+/).includes(name)
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
  observe() {}
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
    "onState", "onConfig", "onAppInfo", "onResourceProfile", "onImportState", "onRuntimeEvent"
  ]) watcherApi[name] = callback => callbacks.set(name, callback);
  const preferences = new Map();
  const window = {
    watcherApi,
    localStorage: {
      getItem: key => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value)
    }
  };
  for (const node of byId.values()) node.document = document;
  vm.runInNewContext(source, {
    window, document, MutationObserver: Observer, Event: class { constructor(type) { this.type = type; } },
    Date, String, Number, Boolean, Array, Object, Math, Promise,
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
  return { document, root, classic, host, preview, previewHome, originalSelect,
    originalControlIds, preferences, callbacks, clickTheme, clickTab, byId };
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
