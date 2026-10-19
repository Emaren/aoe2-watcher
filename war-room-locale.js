"use strict";
/* War Room presentation-only i18n. No network, credentials, or website guesses.
 * An authenticated profile locale is used only if supplied by the separately
 * reviewed, owner-scoped player-summary IPC; otherwise use the OS locale.
 * A local English/Français choice always overrides the default.
 */
(function expose(root) {
  const STORAGE_KEY = "aoe2war.watcher.locale-override.v1";
  const SUPPORTED = Object.freeze(["en", "fr"]);
  const strings = Object.freeze({
    "APPEARANCE": "APPARENCE", "Old Blue Classic": "Bleu classique",
    "War Room": "Salle de guerre", "WAR ROOM": "SALLE DE GUERRE",
    "AOE2WAR • PLAYER COMPANION": "AOE2WAR • COMPAGNON DE JEU",
    "Your game. Your record. Your battlefield.": "Votre partie. Votre palmarès. Votre champ de bataille.",
    "Overview": "Vue d’ensemble", "Battles": "Batailles", "Broadcast": "Diffusion", "Systems": "Systèmes",
    "YOUR COMMAND POST": "VOTRE POSTE DE COMMANDE",
    "Preparing command post…": "Préparation du poste de commandement…",
    "Player profile awaiting verification": "Profil joueur en attente de vérification",
    "Player profile needs refreshing": "Le profil joueur doit être actualisé",
    "Pair your Watcher to prepare your battlefield.": "Associez le Watcher à votre profil pour préparer le champ de bataille.",
    "Checking pairing": "Vérification du jumelage", "Checking replay folder": "Vérification du dossier de parties",
    "Verified wins / losses": "Victoires / défaites vérifiées",
    "Awaiting verified player statistics": "Statistiques vérifiées en attente",
    "Battle win rate": "Taux de victoire", "Decided results only": "Résultats confirmés uniquement",
    "RM / DM rating": "Classement RM / DM", "Verified ratings only": "Classements vérifiés uniquement",
    "LIVE TELEMETRY": "TÉLÉMÉTRIE EN DIRECT", "Resource pulse": "État des ressources",
    "Measuring CPU…": "Mesure du processeur…", "Recent Watcher CPU samples": "Mesures récentes du processeur Watcher",
    "Waiting for real process samples. No simulated charts.": "En attente de mesures réelles. Aucun graphique simulé.",
    "Recent in-session samples · no extra polling": "Mesures de la session · aucune interrogation supplémentaire",
    "AFTER ACTION": "APRÈS LA BATAILLE", "Latest activity": "Activité récente",
    "Battle desk →": "Journal des batailles →",
    "No new replay activity this session. This is a good thing when idle.": "Aucune nouvelle partie détectée cette session. C’est normal au repos.",
    "THE SENTINEL": "LA SENTINELLE", "Watcher status": "État du Watcher",
    "Build —": "Version —", "Connecting…": "Connexion…", "Replay engine": "Moteur de parties",
    "Initializing.": "Initialisation.", "Replay folder": "Dossier de parties",
    "Profile pairing": "Jumelage du profil", "Checking…": "Vérification…",
    "Start Watching": "Démarrer la surveillance", "Stop": "Arrêter",
    "TELEVISION WOLO": "TÉLÉVISION WOLO", "Broadcast station": "Studio de diffusion",
    "Off air": "Hors antenne", "Game capture is inactive.": "La capture de jeu est inactive.",
    "Live starts observed this session": "Débuts de diffusion observés cette session",
    "Verified lifetime streams": "Diffusions totales vérifiées",
    "Verified lifetime airtime": "Temps d’antenne vérifié", "Broadcast station →": "Studio de diffusion →",
    "REPLAY ARCHIVE": "ARCHIVES DES PARTIES", "Historical imports": "Importations historiques",
    "Recent import batch": "Dernier lot importé", "No active import": "Aucune importation en cours",
    "Uploaded": "Envoyées", "Review routed": "En attente de vérification",
    "Batch upload replays": "Importer un lot de parties",
    "BATTLE INTELLIGENCE": "RENSEIGNEMENTS DE BATAILLE",
    "Your record deserves real evidence.": "Votre palmarès mérite des preuves fiables.",
    "The website owns competitive results, RM/DM ratings and Steam chronology. The Watcher does not guess a winner from a successful upload. Verified personal statistics can appear here when a paired, owner-scoped read-only data contract is available.":
      "Le site web fait autorité pour les résultats, les classements RM/DM et la chronologie Steam. Le Watcher ne déduit pas le vainqueur d’un envoi réussi. Les statistiques personnelles vérifiées apparaîtront après la mise en place d’un accès en lecture seule authentifié.",
    "Open player profile ↗": "Ouvrir mon profil ↗", "REPLAY EVENTS": "ÉVÉNEMENTS DES PARTIES",
    "This session": "Cette session",
    "Replay events will appear as they happen. Uploads are not win/loss decisions.": "Les événements apparaîtront ici. Un envoi ne prouve pas une victoire ou une défaite.",
    "RECENT FORM": "FORME RÉCENTE", "Awaiting verified results": "Résultats vérifiés en attente",
    "Recent verified battle outcomes": "Résultats récents vérifiés",
    "Verified recent battles will appear after a trusted player-summary connection.": "Les batailles vérifiées apparaîtront après la connexion au profil authentifié.",
    "ARCHIVE": "ARCHIVES", "RECENT IMPORT RECEIPTS": "REÇUS D’IMPORTATION",
    "No replay import receipts loaded.": "Aucun reçu d’importation chargé.",
    "Import saved replays": "Importer les parties sauvegardées",
    "Your broadcast studio": "Votre studio de diffusion",
    "Existing Watcher capture preview": "Aperçu de la capture Watcher existante",
    "No live capture. Choose your game window or display in capture controls before broadcasting.":
      "Aucune capture en cours. Choisissez la fenêtre du jeu ou un écran avant de diffuser.",
    "Source protection": "Protection de la source",
    "Display sharing requires confirmation": "Le partage d’écran nécessite une confirmation",
    "Live capture": "Capture en direct", "Idle": "Inactif",
    "Capture diagnostics appear here when an AoE2 session is detected.": "Les diagnostics apparaîtront à la détection d’une partie AoE2.",
    "Game window or display": "Fenêtre de jeu ou écran",
    "Refresh to discover sources": "Actualiser les sources",
    "Full-display capture shares everything visible on the chosen display. Check the preview before going live.":
      "La capture de l’écran entier peut montrer toutes les fenêtres et notifications visibles. Vérifiez l’aperçu avant de diffuser.",
    "I choose to share the": "J’autorise le partage de",
    "entire selected display": "l’intégralité de l’écran sélectionné",
    ", including any visible non-game windows or notifications.": ", y compris les autres fenêtres et notifications visibles.",
    "Use the Watcher capture-source selector to confirm what will be shared.":
      "Vérifiez la source choisie avant de partager l’écran.",
    "Capture quality": "Qualité de capture", "Stable 15": "Stable 15", "Full Screen": "Plein écran",
    "Sharp 24": "Net 24", "Refresh sources": "Actualiser les sources",
    "Go Live": "Diffuser", "Stop video": "Arrêter la vidéo",
    "Classic capture settings": "Paramètres de capture classiques",
    "BROADCAST HISTORY": "HISTORIQUE DES DIFFUSIONS",
    "Your time on air": "Votre temps d’antenne",
    "Verified airtime": "Temps d’antenne vérifié",
    "Peak concurrent viewers": "Pic de spectateurs simultanés",
    "These require durable authenticated broadcast history. Capturing a display is not proof of viewers.":
      "Ces statistiques nécessitent un historique authentifié. Une capture d’écran ne prouve pas qu’il y ait des spectateurs.",
    "ENGINE ROOM": "SALLE DES MACHINES", "Watcher systems": "Systèmes du Watcher",
    "Build": "Version", "CPU": "Processeur", "RAM": "Mémoire",
    "Upload attempt rate": "Débit d’envoi tenté", "Processor wakeups": "Réveils du processeur",
    "Not reported": "Non communiqué", "Latest upload": "Dernier envoi",
    "None this session": "Aucun cette session",
    "Replay detections this session": "Parties détectées cette session",
    "Open Old Blue settings": "Paramètres de Bleu classique",
    "Copy support snapshot": "Copier l’état de diagnostic",
    "Full diagnostics, key recovery, setup, and capture sources are preserved in Old Blue.":
      "Diagnostics complets, récupération de clé, configuration et sources de capture restent dans Bleu classique.",
    "INTERFACE PROVENANCE": "ORIGINE DE L’INTERFACE",
    "Old Blue is preserved.": "Bleu classique est préservé.",
    "Appearance changes only the presentation. Both views share the same replay watcher, paired credentials, import queue and active video engine.":
      "L’apparence ne change que la présentation. Les deux interfaces partagent le même moteur de parties, les identifiants, la file d’importation et la vidéo active.",
    "Switch to Old Blue ↗": "Passer à Bleu classique ↗",
    "Actual measurements only. No custody or financial functions.":
      "Mesures réelles uniquement. Aucune fonction financière ou de garde.",
    "SOURCE-ONLY 1.6.5 DEVELOPMENT": "VERSION 1.6.5",
    "WAR SATCHEL / AUTO BETS": "SACOCHE DE GUERRE / PARIS AUTOMATIQUES",
    "Financial activation pending": "Activation financière en attente",
    "View settings and financial status on the website. This Watcher does not hold WOLO or place bets.":
      "Consultez les paramètres et l’état financier sur le site. Le Watcher ne détient aucun WOLO et ne place aucun pari.",
    "Open Auto Bet settings ↗": "Ouvrir les paramètres des paris ↗",
    "English": "English", "Français": "Français",
    "Starting…": "Démarrage…", "Live": "En direct", "● On air": "● À l’antenne",
    "Game capture inactive.": "Capture inactive.",
    "Existing Watcher capture is streaming.": "La capture Watcher est en diffusion.",
    "Profile paired": "Profil associé", "Not paired": "Non associé",
    "Folder ready": "Dossier prêt", "Folder missing": "Dossier introuvable",
    "Awaiting authenticated player data": "Données du joueur authentifiées en attente",
    "Statistics have expired. No stale player record is shown.":
      "Les statistiques ont expiré. Aucun résultat périmé n’est affiché."
  });
  const normalize = value => {
    const tag = String(value || "").trim().replace(/_/g, "-").toLowerCase();
    return tag === "fr" || tag.startsWith("fr-") ? "fr" : tag === "en" || tag.startsWith("en-") ? "en" : null;
  };
  const translate = (source, lang) => lang === "fr" ? (strings[source] || source) : source;
  const original = new WeakMap();
  const attributes = new WeakMap();
  let selected = null;
  let userOverride = null;
  let profileLocale = null;
  let host = null;
  let picker = null;
  let observer = null;
  function resolvedLocale() {
    return userOverride || profileLocale || normalize(root?.navigator?.language) || "en";
  }
  function translateNode(node, language) {
    const value = node.nodeValue;
    let old = original.get(node);
    if (!old || (value !== old.last && value !== old.source)) old = { source: value, last: value };
    const spaced = /^\s*/.exec(old.source)[0], ending = /\s*$/.exec(old.source)[0];
    const source = old.source.trim();
    const next = spaced + translate(source, language) + ending;
    old.last = next;
    original.set(node, old);
    if (value !== next) node.nodeValue = next;
  }
  function translateAttribute(node, attribute, language) {
    const existing = node.getAttribute(attribute);
    if (existing === null) return;
    let cache = attributes.get(node) || {};
    let old = cache[attribute];
    if (!old || (existing !== old.last && existing !== old.source)) old = { source: existing, last: existing };
    const next = translate(old.source, language);
    old.last = next;
    cache[attribute] = old;
    attributes.set(node, cache);
    if (existing !== next) node.setAttribute(attribute, next);
  }
  function render() {
    if (!host || !picker || !root?.document?.createTreeWalker) return;
    const lang = resolvedLocale();
    root.document.documentElement.lang = lang;
    for (const place of [picker, host]) {
      const walker = root.document.createTreeWalker(place, 4 /* SHOW_TEXT */);
      while (walker.nextNode()) translateNode(walker.currentNode, lang);
      const elements = [place, ...place.querySelectorAll("*")];
      for (const el of elements) for (const attr of ["aria-label", "title", "placeholder"]) {
        translateAttribute(el, attr, lang);
      }
    }
    for (const btn of picker.querySelectorAll("[data-wr-locale]")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.wrLocale === lang));
    }
    selected = lang;
  }
  function attach({ display, controls }) {
    host = display; picker = controls;
    try { userOverride = normalize(root.localStorage.getItem(STORAGE_KEY)); } catch {}
    picker.addEventListener("click", event => {
      const btn = event.target?.closest?.("[data-wr-locale]");
      if (!btn) return;
      const lang = normalize(btn.dataset.wrLocale);
      if (!lang) return;
      userOverride = lang;
      try { root.localStorage.setItem(STORAGE_KEY, lang); } catch {}
      render();
    });
    if (typeof root.MutationObserver === "function") {
      observer = new root.MutationObserver(() => render());
      observer.observe(host, { subtree: true, childList: true, characterData: true });
    }
    render();
  }
  function setVerifiedProfileLocale(locale) {
    profileLocale = normalize(locale);
    render();
  }
  const api = Object.freeze({ SUPPORTED, STORAGE_KEY, normalize, translate, attach, resolvedLocale, setVerifiedProfileLocale });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root) root.WarRoomLocale = api;
})(typeof window !== "undefined" ? window : null);
