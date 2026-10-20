"use strict";

// Deliberately sandbox-only POSIX rehearsal of old-app backup, new-app rename,
// post-launch health failure, and rollback. NOT an unsigned Mac installer.
// No process control, no production path, no manifest trust, no shell commands.
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");

const APP="AoE2HDBets Watcher.app";
const PREFIX="watcher-swap-rehearsal-";

function refused(reason) {
  const error=new Error("Watcher swap rehearsal refused: "+reason);
  error.code="AOE2_SWAP_REHEARSAL_REFUSED";
  return error;
}
async function assertDirectory(candidate,privateOnly=false){
  const st=await fs.promises.lstat(candidate);
  if(!st.isDirectory()||st.isSymbolicLink())throw refused("non-directory_or_symlink");
  if(typeof process.getuid==="function"&&st.uid!==process.getuid())throw refused("different_owner");
  if((st.mode&(privateOnly?0o077:0o022))!==0)throw refused("directory_permissions");
  return st;
}
async function qualifySandbox(root){
  if(process.platform==="win32"||!fs.constants.O_NOFOLLOW)throw refused("POSIX_only");
  if(typeof root!=="string"||!path.isAbsolute(root)||root.includes("\0")||
    path.normalize(root)!==root||!path.basename(root).startsWith(PREFIX)){
    throw refused("not_a_disposable_rehearsal_root");
  }
  await assertDirectory(root,true);
  const [realRoot,realTemp]=await Promise.all([
    fs.promises.realpath(root),fs.promises.realpath(os.tmpdir())
  ]);
  // root must be a direct child, not a nested arbitrary application tree.
  if(path.dirname(realRoot)!==realTemp)throw refused("outside_disposable_temp");
  const parents=["installed","staged","backup"];
  const stats=[];
  for(const name of parents)stats.push(await assertDirectory(path.join(root,name)));
  if(new Set(stats.map(x=>x.dev)).size!==1)throw refused("cross_device_rename");
  const installed=path.join(root,"installed",APP);
  const incoming=path.join(root,"staged",APP);
  const backup=path.join(root,"backup",APP);
  for(const candidate of [installed,incoming])await assertDirectory(candidate);
  try{
    await fs.promises.lstat(backup);
    throw refused("backup_already_exists");
  }catch(e){if(e.code!=="ENOENT")throw e;}
  return {installed,incoming,backup,dirs:parents.map(x=>path.join(root,x))};
}
async function syncDirectories(dirs){
  for(const dir of dirs){
    let handle;
    try{
      handle=await fs.promises.open(dir,
        fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      await handle.sync();
    }finally{if(handle)await handle.close().catch(()=>{});}
  }
}
async function acquire(root){
  try{
    return await fs.promises.open(path.join(root,".swap-rehearsal.lock"),
      fs.constants.O_WRONLY|fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  }catch(e){
    if(e.code==="EEXIST")throw refused("existing_or_stale_lock");
    throw e;
  }
}
async function rehearseMacAppSwap({
  sandboxRoot,
  assertProcessExited,
  assertReplacementHealthy,
  faultAt=null,
}={}){
  if(typeof assertProcessExited!=="function"||
     typeof assertReplacementHealthy!=="function")throw refused("missing_external_witness");
  const qualified=await qualifySandbox(sandboxRoot);
  const lock=await acquire(sandboxRoot);
  let backedUp=false,swapped=false;
  let rollbackError=null;
  try{
    // These callbacks are intentionally mock witnesses in disposable tests.
    // A production helper MUST use OS-level, independently authenticated
    // process identity and installed-app health evidence instead.
    if(await assertProcessExited()!==true)throw refused("process_not_confirmed_exited");
    if(faultAt==="before_backup")throw refused("injected_prebackup_failure");
    await fs.promises.rename(qualified.installed,qualified.backup);
    backedUp=true;
    await syncDirectories(qualified.dirs);
    if(faultAt==="after_backup")throw refused("injected_backup_failure");
    await fs.promises.rename(qualified.incoming,qualified.installed);
    swapped=true;
    await syncDirectories(qualified.dirs);
    if(faultAt==="after_swap")throw refused("injected_swap_failure");
    if(await assertReplacementHealthy(qualified.installed)!==true)
      throw refused("new_application_health_failed");
    // Never erase old known-good binary in a rehearsal. Production cleanup
    // needs its own authenticated post-health release gate.
    return Object.freeze({ok:true,backupRetained:true,installed:qualified.installed,
      backup:qualified.backup});
  }catch(error){
    if(backedUp){
      try{
        if(swapped){
          // Retain failed candidate for analysis; NEVER recursively delete a
          // possibly live/new app while restoring a known-good installation.
          const rejected=path.join(sandboxRoot,"staged","rejected-upgrade.app");
          await fs.promises.rename(qualified.installed,rejected);
        }
        await fs.promises.rename(qualified.backup,qualified.installed);
        await syncDirectories(qualified.dirs);
      }catch(err){rollbackError=err;}
    }
    if(rollbackError){
      const aggregate=new AggregateError([error,rollbackError],
        "Swap rehearsal failed AND rollback failed; manual recovery needed");
      aggregate.code="AOE2_SWAP_REHEARSAL_ROLLBACK_FAILED";
      throw aggregate;
    }
    throw error;
  }finally{
    await lock.close().catch(()=>{});
    // Lock remains if an actual helper process crashes; never auto-reap it.
    await fs.promises.rm(path.join(sandboxRoot,".swap-rehearsal.lock"),
      {force:true}).catch(()=>{});
  }
}
module.exports={qualifySandbox,rehearseMacAppSwap};
