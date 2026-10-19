"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const locale = require("../war-room-locale");
const dir = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(dir, "war-room.js"), "utf8");
const pkg = require("../package.json");

test("French and English modes translate core War Room UI labels without affecting unknown player text", () => {
  for (const [english, french] of [
    ["Overview", "Vue d’ensemble"], ["Battles", "Batailles"], ["Broadcast", "Diffusion"],
    ["Systems", "Systèmes"], ["Start Watching", "Démarrer la surveillance"],
    ["Go Live", "Diffuser"], ["WAR SATCHEL / AUTO BETS", "SACOCHE DE GUERRE / PARIS AUTOMATIQUES"],
    ["Financial activation pending", "Activation financière en attente"]
  ]) {
    assert.equal(locale.translate(english, "fr"), french, english);
    assert.equal(locale.translate(english, "en"), english);
  }
  assert.equal(locale.translate("Tekki_2026", "fr"), "Tekki_2026");
  assert.equal(locale.translate("300 WOLO", "fr"), "300 WOLO");
});
test("French OS and verified profile locale normalization is bounded and explicit", () => {
  assert.equal(locale.normalize("fr-FR"), "fr");
  assert.equal(locale.normalize("fr_CA"), "fr");
  assert.equal(locale.normalize("en-US"), "en");
  assert.equal(locale.normalize("es-ES"), null, "Spanish is not silently declared supported");
  assert.equal(locale.normalize(""), null);
  assert.deepEqual(locale.SUPPORTED, ["en", "fr"]);
});
test("French language module and manual override are packaged without changing Old Blue", () => {
  assert.ok(html.indexOf("src=\"./renderer.js\"") < html.indexOf("src=\"./war-room-locale.js\""));
  assert.ok(html.indexOf("src=\"./war-room-locale.js\"") < html.indexOf("src=\"./war-room.js\""));
  assert.ok(pkg.build.files.includes("war-room-locale.js"));
  assert.match(ui, /data-wr-locale="en"/);
  assert.match(ui, /data-wr-locale="fr"/);
  assert.match(ui, /WarRoomLocale\.attach/);
  assert.match(ui, /WarRoomLocale\.setVerifiedProfileLocale/);
  assert.match(ui, /Financial activation pending/);
  assert.doesNotMatch(ui, /signAndBroadcast|settlementExecute|satchelWithdraw|warSatchelAutoBetExecutor/);
});
test("localization does not request network access, forward secret keys or create an extra timer", () => {
  const text = fs.readFileSync(path.join(dir, "war-room-locale.js"), "utf8");
  assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|setInterval|uploadApiKey|x-api-key|wallet|privateKey/);
  assert.match(text, /locale-override\.v1/);
  assert.match(text, /documentElement\.lang/);
});
