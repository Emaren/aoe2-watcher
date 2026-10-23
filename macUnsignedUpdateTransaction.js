"use strict";

// Pure, disconnected state model for a *future* independently authenticated,
// user-scoped unsigned-Mac replacement helper. No filesystem/process actions.
// A journal record by itself NEVER authorizes an installation or bypasses
// Gatekeeper. Verified bundle, source, path, process exit, and health checks
// must be supplied by future independently trusted helper code.

const VERSION = 1;
const STATES = Object.freeze([
  "archive_verified",
  "bundle_verified",
  "idle_confirmed",
  "quit_requested",
  "process_exited",
  "old_app_backed_up",
  "new_app_swapped",
  "relaunch_requested",
  "health_confirmed",
  "committed",
  "rollback_requested",
  "rolled_back",
  "failed_before_backup",
]);
const ALLOWED = Object.freeze({
  archive_verified: ["bundle_verified","failed_before_backup"],
  bundle_verified: ["idle_confirmed","failed_before_backup"],
  idle_confirmed: ["quit_requested","failed_before_backup"],
  quit_requested: ["process_exited","failed_before_backup"],
  process_exited: ["old_app_backed_up","failed_before_backup"],
  old_app_backed_up: ["new_app_swapped","rollback_requested"],
  new_app_swapped: ["relaunch_requested","rollback_requested"],
  relaunch_requested: ["health_confirmed","rollback_requested"],
  health_confirmed: ["committed","rollback_requested"],
  rollback_requested: ["rolled_back"],
  committed: [],
  rolled_back: [],
  failed_before_backup: [],
});
const REQUIRED_EVIDENCE = Object.freeze({
  bundle_verified: "bundle_evidence",
  idle_confirmed: "idle_evidence",
  quit_requested: "quit_evidence",
  process_exited: "process_exit_evidence",
  old_app_backed_up: "backup_evidence",
  new_app_swapped: "swap_evidence",
  relaunch_requested: "launch_evidence",
  health_confirmed: "installed_health_evidence",
  committed: "commit_evidence",
  rollback_requested: "rollback_reason",
  rolled_back: "restore_evidence",
  failed_before_backup: "failure_reason",
});
const EVIDENCE_RE = /^[A-Za-z0-9][A-Za-z0-9 .:,_+\-\/]{3,200}$/;

function fail(reason) {
  const error = new Error("Mac update transaction rejected: "+reason);
  error.code = "AOE2_MAC_UPDATE_TRANSACTION_REJECTED";
  throw error;
}
function isPlain(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function isSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function createMacUpdateTransaction({ transactionId, version, artifactSha256, sourceSha }) {
  if (typeof transactionId !== "string" ||
      !/^[a-f0-9]{32}$/.test(transactionId) ||
      typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version) ||
      !isSha(artifactSha256) ||
      typeof sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    fail("invalid_verified_release_identity");
  }
  const first = Object.freeze({
    schema:VERSION,
    transactionId,
    version,
    artifactSha256,
    sourceSha,
    sequence:0,
    state:"archive_verified",
    transitions: Object.freeze([]),
  });
  return Object.freeze(first);
}
function validateMacUpdateTransaction(record) {
  if(!isPlain(record) ||
      Object.keys(record).sort().join(",") !==
        ["artifactSha256","schema","sequence","sourceSha","state","transactionId","transitions","version"].sort().join(",") ||
      record.schema!==VERSION ||
      typeof record.transactionId!=="string" ||
      !/^[a-f0-9]{32}$/.test(record.transactionId) ||
      !/^\d+\.\d+\.\d+$/.test(record.version) ||
      !isSha(record.artifactSha256) ||
      typeof record.sourceSha!=="string" ||
      !/^[a-f0-9]{40}$/.test(record.sourceSha) ||
      !Number.isSafeInteger(record.sequence) || record.sequence<0 ||
      !STATES.includes(record.state) ||
      !Array.isArray(record.transitions) ||
      record.transitions.length!==record.sequence ||
      record.transitions.length>32) {
    return false;
  }
  let prior="archive_verified";
  for(let i=0;i<record.transitions.length;i++){
    const item=record.transitions[i];
    if(!isPlain(item) || Object.keys(item).sort().join(",")!=="evidence,from,sequence,to" ||
        item.sequence!==i+1 || item.from!==prior ||
        !ALLOWED[prior]?.includes(item.to) ||
        typeof item.evidence!=="string" || !EVIDENCE_RE.test(item.evidence)) return false;
    prior=item.to;
  }
  return prior===record.state;
}
function transitionMacUpdateTransaction(record, nextState, evidence) {
  if(!validateMacUpdateTransaction(record)) fail("invalid_prior_transaction");
  if(!ALLOWED[record.state]?.includes(nextState)) fail("illegal_transition");
  if(typeof evidence!=="string" || !EVIDENCE_RE.test(evidence)) fail("invalid_evidence_reference");
  if(record.sequence>=32) fail("transition_limit");
  const entry=Object.freeze({
    sequence:record.sequence+1,
    from:record.state,
    to:nextState,
    evidence,
  });
  const next={
    ...record,sequence:entry.sequence,state:nextState,
    transitions:Object.freeze([...record.transitions,entry]),
  };
  if(!validateMacUpdateTransaction(next)) fail("invalid_transition_result");
  return Object.freeze(next);
}
// Recovery is a *read-only instruction*, never a filesystem mutation.
// After old-app backup, success may never be inferred solely from a journal.
function classifyMacUpdateRecovery(record) {
  if(!validateMacUpdateTransaction(record)) return "REFUSE_INVALID_JOURNAL";
  if(record.state==="committed") return "NO_ACTION_CONFIRMED";
  if(record.state==="rolled_back") return "NO_ACTION_ROLLED_BACK";
  if(record.state==="failed_before_backup") return "NO_ACTION_OLD_APP_UNTOUCHED";
  if(record.state==="rollback_requested") return "MANUAL_VERIFY_BACKUP_AND_RESTORE";
  if(["old_app_backed_up","new_app_swapped","relaunch_requested","health_confirmed"].includes(record.state)) {
    return "MANUAL_VERIFY_BACKUP_AND_RESTORE";
  }
  return "DO_NOT_SWAP_OLD_APP_MAY_STILL_RUN";
}
module.exports={
  STATES,
  ALLOWED,
  REQUIRED_EVIDENCE,
  createMacUpdateTransaction,
  transitionMacUpdateTransaction,
  validateMacUpdateTransaction,
  classifyMacUpdateRecovery,
};
