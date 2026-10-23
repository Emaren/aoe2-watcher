"use strict";

// Read-only advisory: user-scoped macOS installation eligibility.
// No chmod, sudo, quarantine modification, process control or file writes.
// This is NOT sufficient authority to install; a future helper must recheck
// exact inode/ownership/OS ACL and process identity immediately before swap.
const fs=require("node:fs");
const path=require("node:path");

const APP="AoE2HDBets Watcher.app";
function assessment(status,reason) {
  return Object.freeze({status,reason,verifiedInstallAuthority:false});
}
function startsAt(root,candidate) {
  return candidate===root||candidate.startsWith(root+path.sep);
}
async function inspectUserScopedMacInstall({
  installedPath,homeDirectory,stagingDirectory,
}={}){
  if(typeof installedPath!=="string"||typeof homeDirectory!=="string"||
     typeof stagingDirectory!=="string"||
     !path.isAbsolute(installedPath)||!path.isAbsolute(homeDirectory)||
     !path.isAbsolute(stagingDirectory)||
     [installedPath,homeDirectory,stagingDirectory].some(x=>
       x.includes("\0")||path.normalize(x)!==x)) {
    return assessment("blocked","invalid_paths");
  }
  const expected=path.join(homeDirectory,"Applications",APP);
  if(installedPath===path.join("/Applications",APP)) {
    return assessment("migration_required","system_applications_is_not_an_unprivileged_install_target");
  }
  if(installedPath!==expected||!startsAt(homeDirectory,installedPath)) {
    return assessment("blocked","not_exact_user_applications_location");
  }
  try {
    const home=await fs.promises.lstat(homeDirectory);
    const parent=await fs.promises.lstat(path.dirname(installedPath));
    const installed=await fs.promises.lstat(installedPath);
    const stage=await fs.promises.lstat(stagingDirectory);
    const dirs=[home,parent,installed,stage];
    if(dirs.some(x=>!x.isDirectory()||x.isSymbolicLink())) {
      return assessment("blocked","symlink_or_not_directory");
    }
    const uid=typeof process.getuid==="function"?process.getuid():null;
    if(uid===null||dirs.some(x=>x.uid!==uid)) {
      return assessment("blocked","owner_mismatch");
    }
    if((home.mode&0o022)||(parent.mode&0o022)||(stage.mode&0o077)) {
      return assessment("blocked","unsafe_permissions");
    }
    if(parent.dev!==stage.dev||parent.dev!==installed.dev) {
      return assessment("blocked","cross_device_atomic_swap_unavailable");
    }
    // access() reflects some ACL failures but is NOT an install-time lock or
    // immutable proof of permissions. Keep the result explicitly advisory.
    await fs.promises.access(path.dirname(installedPath),fs.constants.W_OK|fs.constants.X_OK);
    return assessment("candidate","user_owned_same_device_requires_runtime_recheck");
  }catch(error){
    if(error?.code==="ENOENT")return assessment("blocked","missing_user_install_or_staging");
    if(error?.code==="EACCES"||error?.code==="EPERM") {
      return assessment("blocked","permission_denied");
    }
    return assessment("blocked","filesystem_preflight_failed");
  }
}
module.exports={inspectUserScopedMacInstall};
