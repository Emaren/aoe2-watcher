
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
    '<div class="wr-statline"><span class="wr-muted">Streaming sessions</span><strong>Not yet tracked</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Broadcast airtime</span><strong>Not yet tracked</strong></div>',
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
    '<div class="wr-actions"><button type="button" class="wr-action" data-wr-action="scanImportBtn">Import saved replays</button></div></section>',
    '</div></div></section>',
    '<section data-wr-panel="broadcast" hidden><div class="wr-layout"><div class="wr-stack">',
    '<section class="wr-card wr-ornate"><div class="wr-kicker">TELEVISION WOLO</div><h2 style="margin:8px 0">Your broadcast studio</h2>',
    '<video class="wr-video" id="wr-preview" muted autoplay playsinline hidden aria-label="Existing Watcher capture preview"></video>',
    '<div class="wr-empty" id="wr-preview-empty">No live capture. Choose your game window or display in capture controls before broadcasting.</div>',
    '<div class="wr-statline"><span class="wr-muted">Broadcast</span><strong id="wr-broadcast-status">Off air</strong></div>',
    '<div class="wr-statline"><span class="wr-muted">Source protection</span><strong>Explicit choice / safe fallback</strong></div>',
    '<div class="wr-actions"><button type="button" class="wr-action wr-primary" id="wr-capture-controls">Open capture controls</button>',
    '<button type="button" class="wr-action" data-wr-action="stopNativeStreamBtn">Stop video</button></div></section></div>',
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
    '<div class="wr-statline"><span class="wr-muted">Latest upload</span><strong id="wr-sys-upload">None this session</strong></div>',
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
    syncPreview();
  }
  function chooseTab(next) {
    if (!["overview", "battles", "broadcast", "systems"].includes(next)) return;
    tab = next;
    host.querySelectorAll("[data-wr-panel]").forEach(panel => panel.hidden = panel.dataset.wrPanel !== next);
    host.querySelectorAll("[data-wr-tab]").forEach(button => {
      button.setAttribute("aria-selected", String(button.dataset.wrTab === next));
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
    else if (btn.hasAttribute("data-wr-show-classic")) chooseTheme("old-blue");
    else if (btn.id === "wr-open-classic-settings") openClassic(".content-grid .field-grid");
    else if (btn.id === "wr-capture-controls") openClassic(".stream-panel");
  });

  function paintReadiness() {
    write("wr-status", !statusKnown ? "Connecting…" : watching ? "Monitoring replays" : "Standing by");
    write("wr-detail", !statusKnown ? "Waiting for Watcher state." : watching
      ? "Listening for new Age of Empires II replay events."
      : "Monitoring is stopped. Start it before your next match.");
    const dot = el("wr-dot");
    if (dot) dot.className = "wr-status-dot" + (statusKnown ? watching ? " ok" : " warn" : "");
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
    const cpu = Number(profile.cpuPercent);
    const ram = Number(profile.workingSetMb);
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
  }
  function syncPreview() {
    const pill = el("streamStatePill");
    const classicVideo = el("streamPreview");
    const mirror = el("wr-preview");
    const state = String(pill && pill.textContent || "Idle").trim();
    const live = state === "Live";
    write("wr-stream-status", live ? "● On air" : state === "Starting" ? "Starting…" : "Off air");
    write("wr-stream-detail", live ? "Existing Watcher capture is streaming." : "Game capture inactive.");
    write("wr-broadcast-status", live ? "Live" : state);
    const media = live && theme === "war-room" && tab === "broadcast" && classicVideo ? classicVideo.srcObject : null;
    if (mirror && mirror.srcObject !== media) {
      mirror.srcObject = media;
      mirror.hidden = !media;
      el("wr-preview-empty").hidden = Boolean(media);
      if (media && theme === "war-room" && tab === "broadcast") mirror.play().catch(() => {});
    }
  }
  const pill = el("streamStatePill");
  if (pill) {
    const observer = new MutationObserver(syncPreview);
    observer.observe(pill, { childList: true, characterData: true, subtree: true });
  }
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
