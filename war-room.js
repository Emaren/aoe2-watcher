
"use strict";
/* War Room display: same renderer process, existing IPC and native capture engine. */
(() => {
  const root = document.querySelector(".app-shell");
  const classic = document.getElementById("oldBlueShell");
  const host = document.getElementById("warRoomHost");
  if (!root || !classic || !host) return;

  const picker = document.createElement("div");
  picker.className = "wr-theme-picker";
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "Watcher appearance");
  picker.innerHTML = '<span class="wr-picker-label">APPEARANCE</span><button type="button" data-wr-theme="old-blue" aria-label="Old Blue Classic" title="Old Blue · original Watcher" aria-pressed="false">◈</button><button type="button" data-wr-theme="war-room" aria-label="War Room" title="War Room · player cockpit" aria-pressed="false">⚔</button>';
  root.insertBefore(picker, classic);

  host.innerHTML = [
    '<main class="war-room" aria-label="AoE2WAR War Room">',
    '<header class="wr-top"><div class="wr-logo"><div class="wr-sigil" aria-hidden="true">W</div><div>',
    '<div class="wr-kicker">AOE2WAR • PLAYER COMPANION</div><h1>WAR ROOM</h1>',
    '<div class="wr-muted wr-small">Your game. Your record. Your battlefield.</div></div></div></header>',
    '<nav class="wr-nav" aria-label="War Room sections">',
    '<button type="button" data-wr-tab="overview" aria-selected="true">Overview</button>',
    '<button type="button" data-wr-tab="battles" aria-selected="false">Battles</button>',
    '<button type="button" data-wr-tab="broadcast" aria-selected="false">Broadcast</button>',
    '<button type="button" data-wr-tab="systems" aria-selected="false">Systems</button></nav>',
    '<section data-wr-panel="overview"><div class="wr-layout"><div class="wr-stack">',
    '<section class="wr-card wr-ornate wr-hero"><div class="wr-avatar" aria-hidden="true">⚔</div><div class="wr-hero-copy">',
    '<div class="wr-kicker">YOUR COMMAND POST</div><h2>Ready for battle.</h2>',
    '<p class="wr-muted wr-small" id="wr-identity">Pair your Watcher to prepare your battlefield.</p>',
    '<div class="wr-chips"><span class="wr-chip" id="wr-paired">Checking pairing</span><span class="wr-chip" id="wr-folder">Checking replay folder</span></div>',
    '</div></section>',
    '<section class="wr-metrics" aria-label="Player record; values require verified player data">',
    '<div class="wr-metric"><span>Verified wins / losses</span><strong>— / —</strong><small>Awaiting paired player statistics</small></div>',
    '<div class="wr-metric"><span>Battle win rate</span><strong>—</strong><small>Decided results only</small></div>',
    '<div class="wr-metric"><span>RM / DM rating</span><strong>— / —</strong><small>Chronology-qualified Steam rating</small></div></section>',
    '<section class="wr-card"><div class="wr-heading"><div><div class="wr-kicker">LIVE TELEMETRY</div><h2>Resource pulse</h2></div><span class="wr-chip" id="wr-cpu">Measuring CPU…</span></div>',
    '<div class="wr-chart" id="wr-chart" role="img" aria-label="Recent Watcher CPU samples"><span class="wr-chart-note">Waiting for real process samples. No simulated charts.</span></div>',
    '<div class="wr-line wr-muted wr-small" style="margin-top:12px"><span>Recent in-session samples · no extra polling</span><span id="wr-memory">RAM —</span></div></section>',
    '<section class="wr-card"><div class="wr-heading"><div><div class="wr-kicker">AFTER ACTION</div><h2>Latest activity</h2></div><button type="button" class="wr-action" data-wr-tab-target="battles">Battle desk →</button></div>',
    '<div class="wr-list" id="wr-activity"><div class="wr-empty">No new replay activity this session. This is a good thing when idle.</div></div></section>',
    '</div><div class="wr-stack">',
    '<section class="wr-card"><div class="wr-heading"><div><div class="wr-kicker">THE SENTINEL</div><h2>Watcher status</h2></div><span class="wr-chip" id="wr-version">Build —</span></div>',
    '<div class="wr-line"><strong><span class="wr-status-dot" id="wr-dot"></span><span id="wr-status">Connecting…</span></strong><span class="wr-muted wr-small">Replay engine</span></div>',
    '<p class="wr-muted wr-small" id="wr-detail" style="margin-top:12px">Initializing.</p><div class="wr-rule"></div>',
    '<div class="wr-statline"><span class="wr-muted">Replay folder</span><strong id="wr-folder-text">Checking…</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Profile pairing</span><strong id="wr-pair-text">Checking…</strong></div>',
    '<div class="wr-actions"><button type="button" class="wr-action wr-primary" data-wr-action="startWatchingBtn">Start Watching</button>',
    '<button type="button" class="wr-action" data-wr-action="stopWatchingBtn">Stop</button></div></section>',
    '<section class="wr-card"><div class="wr-kicker">TELEVISION WOLO</div><h2 style="margin:5px 0 14px">Broadcast station</h2>',
    '<div class="wr-broadcast"><div class="wr-cam-icon" aria-hidden="true">◉</div><div><strong id="wr-stream-status">Off air</strong>',
    '<p class="wr-muted wr-small" id="wr-stream-detail">Game capture is inactive.</p></div></div>',
    '<div class="wr-statline"><span class="wr-muted">Live starts observed this session</span><strong id="wr-session-streams">0</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Verified lifetime airtime</span><strong>Not yet available</strong></div>',
    '<div class="wr-actions"><button type="button" class="wr-action wr-primary" data-wr-tab-target="broadcast">Broadcast station →</button></div></section>',
    '<section class="wr-card"><div class="wr-kicker">REPLAY ARCHIVE</div><h2 style="margin:5px 0 12px">Historical imports</h2>',
    '<div class="wr-line wr-muted wr-small"><span>Recent import batch</span><span id="wr-import-label">No active import</span></div>',
    '<div class="wr-minibar"><i id="wr-import-bar" style="width:0%"></i></div><div class="wr-mini-grid">',
    '<div class="wr-statline"><span class="wr-muted">Uploaded</span><strong id="wr-import-uploaded">—</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Review routed</span><strong id="wr-import-review">—</strong></div></div>',
    '<div class="wr-actions"><button type="button" class="wr-action" data-wr-action="scanImportBtn">Batch upload replays</button></div></section>',
    '</div></div></section>',
    '<section data-wr-panel="battles" hidden><div class="wr-layout"><div class="wr-stack">',
    '<section class="wr-card wr-ornate"><div class="wr-kicker">BATTLE INTELLIGENCE</div><h2 style="margin:8px 0 12px">Your record deserves real evidence.</h2>',
    '<p class="wr-muted">The website owns competitive results, RM/DM ratings and Steam chronology. The Watcher does not guess a winner from a successful upload. Verified personal statistics can appear here when a paired, owner-scoped read-only data contract is available.</p>',
    '<div class="wr-actions"><a class="wr-action wr-primary" href="https://aoe2war.com/profile" rel="noreferrer" target="_blank">Open player profile ↗</a></div></section>',
    '<section class="wr-card"><div class="wr-kicker">REPLAY EVENTS</div><h2 style="margin:8px 0 15px">This session</h2>',
    '<div class="wr-list" id="wr-battle-events"><div class="wr-empty">Replay events will appear as they happen. Uploads are not win/loss decisions.</div></div></section>',
    '</div><div class="wr-stack">',
    '<section class="wr-card"><div class="wr-kicker">RECENT FORM</div><h2 style="margin:8px 0">Awaiting verified results</h2>',
    '<div class="wr-chart" style="margin-top:18px"><span class="wr-chart-note">Verified wins, losses and unresolved matches will have distinct marks. No fake streaks.</span></div></section>',
    '<section class="wr-card"><div class="wr-kicker">ARCHIVE</div><h2 style="margin:8px 0">Historical imports</h2>',
    '<div class="wr-statline"><span class="wr-muted">Uploaded</span><strong id="wr-battle-imported">—</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Review routed</span><strong id="wr-battle-review">—</strong></div>',
    '<div class="wr-rule"></div><div class="wr-kicker">RECENT IMPORT RECEIPTS</div>',
    '<div class="wr-list" id="wr-import-recent"><div class="wr-empty">No replay import receipts loaded.</div></div>',
    '<div class="wr-actions"><button type="button" class="wr-action" data-wr-action="scanImportBtn">Import saved replays</button></div></section>',
    '</div></div></section>',
    '<section data-wr-panel="broadcast" hidden><div class="wr-layout"><div class="wr-stack">',
    '<section class="wr-card wr-ornate"><div class="wr-kicker">TELEVISION WOLO</div><h2 style="margin:8px 0">Your broadcast studio</h2>',
    '<div class="wr-preview-slot" id="wr-preview-slot" aria-label="Existing Watcher capture preview"></div>',
    '<div class="wr-empty" id="wr-preview-empty">No live capture. Choose your game window or display in capture controls before broadcasting.</div>',
    '<div class="wr-statline"><span class="wr-muted">Broadcast</span><strong id="wr-broadcast-status">Off air</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Source protection</span><strong>Explicit choice / safe fallback</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Live capture</span><strong id="wr-capture-headline">Idle</strong></div>',
    '<p class="wr-muted wr-small wr-stream-detail" id="wr-capture-details">Capture diagnostics appear here when an AoE2 session is detected.</p>',
    '<div class="wr-rule"></div>',
    '<label class="wr-field-label" for="wr-source">Game window or display</label>',
    '<select class="wr-select" id="wr-source" aria-describedby="wr-screen-warning"><option value="">Refresh to discover sources</option></select>',
    '<p class="wr-muted wr-small" id="wr-screen-warning" style="margin:8px 0 16px">Full-display capture shares everything visible on the chosen display. Check the preview before going live.</p>',
    '<div class="wr-field-label">Capture quality</div>',
    '<div class="wr-mode-options" role="group" aria-label="Capture quality">',
    '<button type="button" class="wr-action" data-wr-mode="stable" aria-pressed="false">Stable 15</button>',
    '<button type="button" class="wr-action" data-wr-mode="screen" aria-pressed="false">Full Screen</button>',
    '<button type="button" class="wr-action" data-wr-mode="sharp" aria-pressed="false">Sharp 24</button></div>',
    '<div class="wr-actions"><button type="button" class="wr-action" data-wr-action="refreshStreamSourcesBtn">Refresh sources</button>',
    '<button type="button" class="wr-action wr-primary" data-wr-action="startNativeStreamBtn">Go Live</button>',
    '<button type="button" class="wr-action" data-wr-action="stopNativeStreamBtn">Stop video</button>',
    '<button type="button" class="wr-action" id="wr-capture-controls">Classic capture settings</button></div></section></div>',
    '<div class="wr-stack"><section class="wr-card"><div class="wr-kicker">BROADCAST HISTORY</div><h2 style="margin:8px 0 12px">Your time on air</h2>',
    '<div class="wr-statline"><span class="wr-muted">Lifetime streams</span><strong>Not yet tracked</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Verified airtime</span><strong>Not yet tracked</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Peak concurrent viewers</span><strong>Not yet tracked</strong></div>',
    '<p class="wr-muted wr-small" style="margin-top:14px">These require durable authenticated broadcast history. Capturing a display is not proof of viewers.</p>',
    '</section></div></div></section>',
    '<section data-wr-panel="systems" hidden><div class="wr-layout"><div class="wr-stack">',
    '<section class="wr-card"><div class="wr-kicker">ENGINE ROOM</div><h2 style="margin:8px 0">Watcher systems</h2>',
    '<div class="wr-statline"><span class="wr-muted">Build</span><strong id="wr-sys-build">Checking…</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">CPU</span><strong id="wr-sys-cpu">Measuring…</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">RAM</span><strong id="wr-sys-ram">Measuring…</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Latest upload</span><strong id="wr-sys-upload">None this session</strong></div><div class="wr-statline"><span class="wr-muted">Replay detections this session</span><strong id="wr-session-replays">0</strong></div>',
    '<div class="wr-actions"><button type="button" class="wr-action wr-primary" id="wr-open-classic-settings">Open Old Blue settings</button>',
    '<button type="button" class="wr-action" data-wr-action="copySupportBtn">Copy support snapshot</button></div>',
    '<p class="wr-muted wr-small" style="margin-top:14px">Full diagnostics, key recovery, setup, and capture sources are preserved in Old Blue.</p></section>',
    '</div><div class="wr-stack"><section class="wr-card"><div class="wr-kicker">INTERFACE PROVENANCE</div>',
    '<h2 style="margin:8px 0">Old Blue is preserved.</h2><p class="wr-muted">Appearance changes only the presentation. Both views share the same replay watcher, paired credentials, import queue and active video engine.</p>',
    '<div class="wr-actions"><button type="button" class="wr-action" data-wr-show-classic>Switch to Old Blue ↗</button></div>',
    '</section></div></div></section>',
    '<footer class="wr-foot"><span>AOE2WAR • WAR ROOM • SOURCE-ONLY 1.6.5 DEVELOPMENT</span>',
    '<span>Actual measurements only. No custody or financial functions.</span></footer></main>'
  ].join("");

  // Accessible tab structure, including arrow-key navigation.
  const tabButtons = Array.from(host.querySelectorAll("[data-wr-tab]"));
  const nav = host.querySelector(".wr-nav");
  nav.setAttribute("role", "tablist");
  for (const button of tabButtons) {
    const key = button.dataset.wrTab;
    button.id = "wr-tab-" + key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "wr-panel-" + key);
    button.tabIndex = key === "overview" ? 0 : -1;
    const panel = host.querySelector('[data-wr-panel="' + key + '"]');
    panel.id = "wr-panel-" + key;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
  }
  nav.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const at = tabButtons.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const targetIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabButtons.length - 1
      : (at + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
    chooseTab(tabButtons[targetIndex].dataset.wrTab);
    tabButtons[targetIndex].focus();
  });
  const el = (id) => document.getElementById(id);
  const write = (id, val) => { const node = el(id); if (node) node.textContent = String(val); };
  const THEMES = ["old-blue", "war-room"];
  const STORAGE_KEY = "aoe2war.watcher.display-theme.v1";
  let theme = "war-room";
  let tab = "overview";
  let statusKnown = false;
  let watching = false;
  let paired = false;
  let folderReady = false;
  let recentEvents = [];
  let detectedReplays = 0;
  let observedStreamStarts = 0;
  let previousLiveState = false;
  let streamStatusBaselineRead = false;
  const cpuSamples = [];

  function chooseTheme(next, persist = true) {
    if (!THEMES.includes(next)) return;
    theme = next;
    host.hidden = next !== "war-room";
    classic.hidden = next === "war-room";
    picker.querySelectorAll("[data-wr-theme]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.wrTheme === next));
    });
    if (persist) { try { window.localStorage.setItem(STORAGE_KEY, next); } catch {} }
    if (next === "war-room") drawChart();
    syncPreview();
  }
  function chooseTab(next) {
    if (!["overview", "battles", "broadcast", "systems"].includes(next)) return;
    tab = next;
    host.querySelectorAll("[data-wr-panel]").forEach(panel => panel.hidden = panel.dataset.wrPanel !== next);
    host.querySelectorAll("[data-wr-tab]").forEach(button => {
      const selected = button.dataset.wrTab === next;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    syncPreview();
  }
  function forward(originalId) {
    const button = el(originalId);
    if (button && !button.disabled && !button.hidden) button.click();
  }
  function openClassic(selector) {
    chooseTheme("old-blue");
    const target = classic.querySelector(selector);
    if (target) target.scrollIntoView({ block: "center", behavior: "auto" });
  }
  picker.addEventListener("click", event => {
    const btn = event.target.closest("[data-wr-theme]");
    if (btn) chooseTheme(btn.dataset.wrTheme);
  });
  host.addEventListener("click", event => {
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.dataset.wrTab) chooseTab(btn.dataset.wrTab);
    else if (btn.dataset.wrTabTarget) chooseTab(btn.dataset.wrTabTarget);
    else if (btn.dataset.wrAction) forward(btn.dataset.wrAction);
    else if (btn.dataset.wrMode) {
      const original = classic.querySelector('[data-stream-mode="' + btn.dataset.wrMode + '"]');
      if (original && !original.disabled) original.click();
    }
    else if (btn.hasAttribute("data-wr-show-classic")) chooseTheme("old-blue");
    else if (btn.id === "wr-open-classic-settings") openClassic(".content-grid .field-grid");
    else if (btn.id === "wr-capture-controls") openClassic(".stream-panel");
  });

  // The War Room is only a presentation adapter for the existing controls.
  // Source choice is committed through Classic's change handler and original policy.
  const sourcePicker = el("wr-source");
  if (sourcePicker) sourcePicker.addEventListener("change", () => {
    const original = el("streamSourceSelect");
    if (!original || original.disabled) return;
    if (!Array.from(original.options).some(option => option.value === sourcePicker.value)) return;
    original.value = sourcePicker.value;
    original.dispatchEvent(new Event("change", { bubbles: true }));
  });
  function syncCaptureControls() {
    if (theme !== "war-room") return;
    const original = el("streamSourceSelect");
    if (original && sourcePicker) {
      const options = Array.from(original.options).map(option => ({ value: option.value, text: option.textContent }));
      const currentOptions = Array.from(sourcePicker.options).map(option => ({ value: option.value, text: option.textContent }));
      if (JSON.stringify(options) !== JSON.stringify(currentOptions)) {
        const items = options.map(option => {
          const element = document.createElement("option");
          element.value = option.value;
          element.textContent = option.text;
          return element;
        });
        sourcePicker.replaceChildren(...items);
      }
      sourcePicker.value = original.value;
      sourcePicker.disabled = original.disabled;
    }
    for (const button of host.querySelectorAll("[data-wr-mode]")) {
      const originalMode = classic.querySelector('[data-stream-mode="' + button.dataset.wrMode + '"]');
      if (originalMode) {
        button.disabled = originalMode.disabled;
        button.setAttribute("aria-pressed", String(originalMode.classList.contains("selected")));
      }
    }
    for (const button of host.querySelectorAll("[data-wr-action]")) {
      const originalButton = el(button.dataset.wrAction);
      if (originalButton) {
        button.disabled = originalButton.disabled;
        button.setAttribute("aria-disabled", String(originalButton.disabled));
      }
    }
  }
  // Targeted observers only; never observe the log, card trees or resource text.
  for (const id of [
    "startWatchingBtn", "stopWatchingBtn", "scanImportBtn", "startNativeStreamBtn",
    "stopNativeStreamBtn", "refreshStreamSourcesBtn", "streamSourceSelect"
  ]) {
    const control = el(id);
    if (!control) continue;
    new MutationObserver(syncCaptureControls).observe(control, {
      attributes: true, attributeFilter: ["disabled"],
      childList: id === "streamSourceSelect",
      subtree: false
    });
  }
  // Class updates carry the selected capture-quality mode even when disabled
  // state remains unchanged. Keep the new controls in sync without polling.
  for (const mode of classic.querySelectorAll("[data-stream-mode]")) {
    new MutationObserver(syncCaptureControls).observe(mode, {
      attributes: true, attributeFilter: ["class", "disabled"]
    });
  }
  function paintReadiness() {
    const oldStatus = String(el("watcherStateText")?.textContent || "").trim();
    const oldDetail = String(el("watcherStateDetailText")?.textContent || "").trim();
    const initialLabel = oldStatus && oldStatus !== "Loading watcher…" ? oldStatus : "Connecting…";
    write("wr-status", !statusKnown ? initialLabel : watching ? "Monitoring replays" : "Standing by");
    write("wr-detail", !statusKnown ? oldDetail || "Waiting for Watcher state." : watching
      ? "Listening for new Age of Empires II replay events."
      : "Monitoring is stopped. Start it before your next match.");
    // A late-loaded presentation adapter can miss the first watcher:state.
    // In that case trust the already-rendered Classic status, not a guess
    // made from the saved configuration or replay directory.
    const visuallyMonitoring = statusKnown ? watching : oldStatus === "Watching for new replays";
    const dot = el("wr-dot");
    if (dot) dot.className = "wr-status-dot" + (visuallyMonitoring ? " ok" : statusKnown || initialLabel !== "Connecting…" ? " warn" : "");
    write("wr-paired", paired ? "Profile paired" : "Profile not paired");
    write("wr-pair-text", paired ? "Paired" : "Pair in Old Blue");
    write("wr-folder", folderReady ? "Replay path configured" : "Replay folder needed");
    write("wr-folder-text", folderReady ? "Configured" : "Choose in Old Blue");
    el("wr-paired").className = "wr-chip" + (paired ? " ok" : " warn");
    el("wr-folder").className = "wr-chip" + (folderReady ? " ok" : " warn");
    write("wr-identity", paired
      ? "Watcher paired. Player record needs a verified statistics feed."
      : "Pair in Old Blue to link your replays to your player profile.");
  }
  function onConfig(config) {
    if (!config || typeof config !== "object") return;
    paired = Boolean(config.uploadApiKey);
    folderReady = Boolean(config.watchDir);
    paintReadiness();
  }
  function onInfo(info) {
    if (!info || typeof info !== "object") return;
    const version = String(info.version || "Unknown");
    write("wr-version", "v" + version);
    write("wr-sys-build", version);
    if (info.watchDirStatus && typeof info.watchDirStatus.valid === "boolean") {
      folderReady = info.watchDirStatus.valid;
      paintReadiness();
    }
    if (info.resourceProfile) onResource(info.resourceProfile);
  }
  function onResource(profile) {
    if (!profile || typeof profile !== "object") return;
    const cpu = typeof profile.cpuPercent === "number" ? profile.cpuPercent : NaN;
    const ram = typeof profile.workingSetMb === "number" ? profile.workingSetMb : NaN;
    if (Number.isFinite(cpu) && cpu >= 0 && cpu <= 1000) {
      cpuSamples.push(cpu);
      if (cpuSamples.length > 40) cpuSamples.shift();
      write("wr-cpu", cpu.toFixed(1) + "% CPU");
      write("wr-sys-cpu", cpu.toFixed(1) + "%");
      if (theme === "war-room") drawChart();
    }
    if (Number.isFinite(ram) && ram >= 0) {
      write("wr-memory", "RAM " + Math.round(ram) + " MB");
      write("wr-sys-ram", Math.round(ram) + " MB");
    }
  }
  function drawChart() {
    if (cpuSamples.length < 2) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 360 125");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const ceiling = Math.max(2, ...cpuSamples);
    const coords = cpuSamples.map((value, i) => {
      const x = (i / (cpuSamples.length - 1)) * 350 + 5;
      const y = 110 - (value / ceiling) * 90;
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", coords.join(" "));
    path.setAttribute("stroke", "#e7be70");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    el("wr-chart").replaceChildren(svg);
    el("wr-chart").setAttribute("aria-label", cpuSamples.length + " actual CPU samples.");
  }
  function onRuntime(event) {
    if (!event || !["replay-detected", "upload-success", "upload-failure", "final-candidate-accepted"].includes(event.type)) return;
    const labels = {
      "replay-detected": "Replay detected",
      "upload-success": "Replay upload received",
      "upload-failure": "Replay upload failed",
      "final-candidate-accepted": "Final replay candidate received"
    };
    if (event.type === "replay-detected") { detectedReplays += 1; write("wr-session-replays", detectedReplays); }
    const file = String(event.fileName || "").replace(/[\r\n\t]/g, " ").slice(0, 95);
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    recentEvents.unshift(time + " • " + labels[event.type] + (file ? " · " + file : ""));
    if (recentEvents.length > 5) recentEvents.length = 5;
    if (event.type === "upload-success" || event.type === "upload-failure") write("wr-sys-upload", labels[event.type]);
    for (const target of ["wr-activity", "wr-battle-events"]) {
      const box = el(target);
      const fragment = document.createDocumentFragment();
      for (const entry of recentEvents) {
        const div = document.createElement("div");
        div.className = "wr-list-item";
        div.textContent = entry;
        fragment.appendChild(div);
      }
      if (box) box.replaceChildren(fragment);
    }
  }
  function onImport(state) {
    if (!state || typeof state !== "object") return;
    const percent = Number(state.percent);
    const uploaded = Number(state.uploaded);
    const review = Number(state.reviewRouted);
    write("wr-import-label", state.isRunning ? "In progress" : state.completedAt ? "Last import finished" : "No active import");
    el("wr-import-bar").style.width = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) + "%" : "0%";
    write("wr-import-uploaded", Number.isFinite(uploaded) ? uploaded : "—");
    write("wr-battle-imported", Number.isFinite(uploaded) ? uploaded : "—");
    write("wr-import-review", Number.isFinite(review) ? review : "—");
    write("wr-battle-review", Number.isFinite(review) ? review : "—");
    const list = el("wr-import-recent");
    if (list && Array.isArray(state.recentItems)) {
      const items = state.recentItems.slice(0, 5);
      if (!items.length) {
        list.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "wr-empty";
        empty.textContent = "No replay import receipts in this batch.";
        list.appendChild(empty);
      } else {
        const fragment = document.createDocumentFragment();
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const row = document.createElement("div");
          row.className = "wr-list-item";
          const name = String(item.fileName || "Replay").replace(/[\r\n\t]/g, " ").slice(0, 120);
          const result = {
            result_ready: "Result ready",
            review_routed: "Sent to review",
            uploaded: "Uploaded",
            archived: "Archived",
            failed: "Upload failed",
            skipped: "Skipped"
          }[item.status] || "Observed";
          row.textContent = name + " · " + result;
          fragment.appendChild(row);
        }
        list.replaceChildren(fragment);
      }
    }
  }
  function syncPreview() {
    const summary = String(el("streamReadoutSummary")?.textContent || "Idle").trim();
    const details = String(el("streamReadoutDetail")?.textContent || "").trim();
    write("wr-capture-headline", summary.slice(0, 160));
    write("wr-capture-details", details.slice(0, 400) || "Live capture details will appear here.");
    const pill = el("streamStatePill");
    const classicVideo = el("streamPreview");
    const state = String(pill && pill.textContent || "Idle").trim();
    const live = state === "Live";
    if (streamStatusBaselineRead && live && !previousLiveState) {
      observedStreamStarts += 1;
      write("wr-session-streams", observedStreamStarts);
    }
    previousLiveState = live;
    streamStatusBaselineRead = true;
    write("wr-stream-status", live ? "● On air" : state === "Starting" ? "Starting…" : "Off air");
    write("wr-stream-detail", live ? "Existing Watcher capture is streaming." : "Game capture inactive.");
    write("wr-broadcast-status", live ? "Live" : state);
    syncCaptureControls();
    // Reparent the ONE original preview node. The renderer retains control
    // of srcObject, stream upload, MediaRecorder, and native source selection.
    if (classicVideo && previewHome && previewSlot) {
      const inStudio = theme === "war-room" && tab === "broadcast";
      const destination = inStudio ? previewSlot : previewHome;
      if (classicVideo.parentNode !== destination) {
        if (inStudio) previewSlot.appendChild(classicVideo);
        else previewHome.insertBefore(
          classicVideo,
          previewHomeNext && previewHomeNext.parentNode === previewHome ? previewHomeNext : null
        );
        if (classicVideo.srcObject && !classicVideo.hidden) classicVideo.play().catch(() => {});
      }
      const hasPreview = inStudio && Boolean(classicVideo.srcObject) && !classicVideo.hidden;
      const empty = el("wr-preview-empty");
      if (empty) empty.hidden = hasPreview;
    }
  }
  // The Classic renderer may paint its first status before our independent listener attaches.
  // Mirror its authoritative presentation until a watcher:state event arrives.
  const classicStatus = el("watcherStateText");
  if (classicStatus) {
    const syncInitialStatus = () => {
      if (!statusKnown) paintReadiness();
    };
    new MutationObserver(syncInitialStatus).observe(classicStatus, { childList: true, characterData: true, subtree: true });
    syncInitialStatus();
  }
  // Observe only existing capture readouts, not the full Classic DOM tree.
  for (const id of ["streamStatePill", "streamReadoutSummary", "streamReadoutDetail"]) {
    const node = el(id);
    if (node) new MutationObserver(syncPreview).observe(node, {
      childList: true, characterData: true, subtree: true
    });
  }
  // Store Classic's exact original video position for lossless restoration.
  const previewVideo = el("streamPreview");
  const previewHome = previewVideo?.parentNode || null;
  const previewHomeNext = previewVideo?.nextSibling || null;
  const previewSlot = el("wr-preview-slot");
  const bridge = window.watcherApi;
  if (bridge) {
    if (typeof bridge.onState === "function") bridge.onState(state => {
      if (!state || typeof state.isWatching !== "boolean") return;
      statusKnown = true;
      watching = state.isWatching;
      paintReadiness();
    });
    if (typeof bridge.onConfig === "function") bridge.onConfig(onConfig);
    if (typeof bridge.onAppInfo === "function") bridge.onAppInfo(onInfo);
    if (typeof bridge.onResourceProfile === "function") bridge.onResourceProfile(onResource);
    if (typeof bridge.onImportState === "function") bridge.onImportState(onImport);
    if (typeof bridge.onRuntimeEvent === "function") bridge.onRuntimeEvent(onRuntime);
    if (typeof bridge.getConfig === "function") bridge.getConfig().then(onConfig).catch(() => {});
    if (typeof bridge.getAppInfo === "function") bridge.getAppInfo().then(onInfo).catch(() => {});
  }
  paintReadiness();
  syncPreview();
  let initial = "war-room";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (THEMES.includes(saved)) initial = saved;
  } catch {}
  chooseTheme(initial, false);
})();
