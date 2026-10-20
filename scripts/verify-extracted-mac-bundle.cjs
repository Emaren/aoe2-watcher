"use strict";
// CI-only verification of an extracted real native Mac ZIP. This script NEVER
// installs, launches, signs, notarizes, or swaps an application.
const path=require("node:path");
const {inspectExtractedMacBundle}=require("../macUnsignedUpdateBundleAudit");
async function main(args){
  if(process.platform!=="darwin")throw Error("Mac extracted-bundle qualification requires macOS");
  if(args.length!==3)throw Error("Usage: app-path stable-version arch");
  const [appRoot,version,arch]=args;
  const result=await inspectExtractedMacBundle({
    appRoot:path.resolve(appRoot),version,arch,
  });
  if(!result.valid)throw Error("Real Mac bundle audit did not complete");
  process.stdout.write(
    "REAL_MAC_EXTRACTED_BUNDLE_PASS version="+result.version+
    " bundleId="+result.bundleId+" arch="+result.arch+
    " files="+result.fileCount+
    " expandedBytes="+result.expandedBytes+"\n");
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{
  console.error(error.message);process.exitCode=1;
});
