"use strict";

/**
 * Television WOLO source admission: one deliberately selected AoE2 window,
 * never a desktop, browser, Steam library or generic application.
 *
 * Automatic capture is a privacy-sensitive action. Ambiguous/windowless
 * sources fail closed. Screen capture remains a separate explicit user action.
 * Pure CommonJS + browser export keeps Electron main/renderer decisions aligned.
 */
(function installTelevisionCapturePolicy(root) {
  function safeText(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function isPrivateOrNonGameTitle(value) {
    const name = safeText(value);
    return /aoe2war|aoe2hdbets|chrome|chromium|edge|firefox|brave|opera|safari|browser|discord|explorer|desktop|task manager|streamyard|obs studio/.test(name);
  }

  function isIdentifiableAoE2WindowName(value) {
    const name = safeText(value);
    if (!name || isPrivateOrNonGameTitle(name)) return false;
    return /age of empires\s*(?:ii|2)(?:\s*hd)?(?:\b|$)/.test(name) ||
      /(?:^|\W)age2hd(?:\.exe)?(?:\W|$)/.test(name) ||
      /(?:^|\W)aok\s*hd(?:\.exe)?(?:\W|$)/.test(name) ||
      /age of kings/.test(name) ||
      /(?:^|\W)aoe2(?:\s*hd)?(?:\.exe)?(?:\W|$)/.test(name);
  }

  function isSafeAutomaticSource(source) {
    return Boolean(source && source.kind === "window" &&
      typeof source.id === "string" && source.id.startsWith("window:") &&
      isIdentifiableAoE2WindowName(source.name));
  }

  function selectAutomaticSource(sources, previouslySelectedId = "") {
    if (!Array.isArray(sources)) return null;
    const candidates = sources.filter(isSafeAutomaticSource);
    if (!candidates.length) return null;
    return candidates.find(source => source.id === previouslySelectedId) ||
      candidates.sort((a, b) => {
        const scoreA = Number.isFinite(a.score) ? a.score : 0;
        const scoreB = Number.isFinite(b.score) ? b.score : 0;
        return scoreB - scoreA || a.id.localeCompare(b.id);
      })[0];
  }

  const policy = Object.freeze({
    isIdentifiableAoE2WindowName, isSafeAutomaticSource, selectAutomaticSource,
  });
  if (typeof module !== "undefined" && module.exports) module.exports = policy;
  if (root) root.televisionCapturePolicy = policy;
})(typeof window !== "undefined" ? window : null);
