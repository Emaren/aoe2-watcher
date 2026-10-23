"use strict";

// Adversarial native-archive fixture: proves the release inspector can FAIL,
// including for payloads outside app.asar (app.asar.unpacked).
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const asar=require("@electron/asar");

function put(root,name,data) {
 const full=path.join(root,...name.split("/"));
 fs.mkdirSync(path.dirname(full),{recursive:true});
 fs.writeFileSync(full,data);
 return full;
}
function invoke(archive){
 return spawnSync(process.execPath,
  [path.join(__dirname,"..","scripts","audit-packaged-runtime.cjs"),archive],
  {encoding:"utf8",timeout:12000,windowsHide:true});
}
test("packaged-runtime auditor refuses dev modules, hidden Mac helpers and unpatched sidecar transport",{
 timeout:30000,
},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-asar-audit-adversarial-"));
 const src=path.join(root,"source"),out=path.join(root,"dist","app.asar");
 const unpacked=out+".unpacked";
 try{
  fs.mkdirSync(src,{recursive:true});
  for(const name of ["main.js","watcher.js","telemetryQueue.js","telemetryDelivery.js"])
   put(src,name,"// simulated source for read-only inspector negative tests\n");
  put(src,"package.json",JSON.stringify({name:"aoe2-watcher",version:"1.6.5"}));
  put(src,"node_modules/follow-redirects/package.json",
   JSON.stringify({name:"follow-redirects",version:"1.16.1"}));
  put(src,"padding.bin",Buffer.alloc(1200000,0x37));
  fs.mkdirSync(path.dirname(out),{recursive:true});
  await asar.createPackage(src,out);
  const ok=invoke(out);
  assert.equal(ok.status,0,ok.stderr);
  const first=JSON.parse(ok.stdout);
  assert.equal(first.packageVersion,"1.6.5");
  assert.deepEqual(first.followRedirectsVersions,["1.16.1"]);
  assert.deepEqual(first.unpackedSidecar,{fileCount:0,bytes:0,sha256:null});

  put(unpacked,"node_modules/sprintf-js/index.js","dev-only package injection");
  const dev=invoke(out);
  assert.notEqual(dev.status,0);
  assert.match(dev.stderr,/dev-only dependency in unpacked sidecar/);
  fs.rmSync(path.join(unpacked,"node_modules","sprintf-js"),{recursive:true,force:true});

  put(unpacked,"macUnsignedUpdateStaging.js","disconnected unsafe helper");
  const updater=invoke(out);
  assert.notEqual(updater.status,0);
  assert.match(updater.stderr,/unqualified Mac helper in unpacked sidecar/);
  fs.rmSync(path.join(unpacked,"macUnsignedUpdateStaging.js"));

  put(unpacked,"node_modules/follow-redirects/package.json",
   JSON.stringify({name:"follow-redirects",version:"1.16.0"}));
  const old=invoke(out);
  assert.notEqual(old.status,0);
  assert.match(old.stderr,/unpatched unpacked redirect transport/);

  put(unpacked,"node_modules/follow-redirects/package.json",
   JSON.stringify({name:"follow-redirects",version:"1.16.1"}));
  put(unpacked,"native-addon.node",Buffer.from([1,2,3,4]));
  const valid=invoke(out);
  assert.equal(valid.status,0,valid.stderr);
  const receipt=JSON.parse(valid.stdout);
  assert.equal(receipt.unpackedSidecar.fileCount,2);
  assert.equal(receipt.followRedirectsVersions.length,2);
  assert.match(receipt.unpackedSidecar.sha256,/^[0-9a-f]{64}$/);

  if(process.platform!=="win32"){
   fs.symlinkSync(path.join(root,"target"),path.join(unpacked,"misdirected"));
   const link=invoke(out);
   assert.notEqual(link.status,0);
   assert.match(link.stderr,/unpacked sidecar symlink/);
  }
 }finally {fs.rmSync(root,{recursive:true,force:true});}
});


test("Electron ASAR inspector refuses missing main-process local imports and accepts their real modules",{
 timeout:30000,
},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"watcher-asar-main-import-"));
 const src=path.join(root,"source"),out=path.join(root,"dist","app.asar");
 try{
  for(const name of ["watcher.js","telemetryQueue.js","telemetryDelivery.js"])
   put(src,name,"// harmless native package fixture\n");
  put(src,"main.js",
   '"use strict";\nconst { boundedDiagnosticBytes } = require("./diagnosticLimits");\n');
  put(src,"package.json",JSON.stringify({name:"aoe2-watcher",version:"1.6.5"}));
  put(src,"node_modules/follow-redirects/package.json",
   JSON.stringify({name:"follow-redirects",version:"1.16.1"}));
  put(src,"padding.bin",Buffer.alloc(1200000,0x37));
  fs.mkdirSync(path.dirname(out),{recursive:true});
  await asar.createPackage(src,out);

  const refused=invoke(out);
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,
   /missing packaged local CommonJS module: main\.js -> \.\/diagnosticLimits/);

  put(src,"diagnosticLimits.js",
   '"use strict"; module.exports={boundedDiagnosticBytes:()=>42};\n');
  await asar.createPackage(src,out);
  const accepted=invoke(out);
  assert.equal(accepted.status,0,accepted.stderr);
  const receipt=JSON.parse(accepted.stdout);
  const main=receipt.rootModuleClosure.find(x=>x.file==="main.js");
  assert.ok(main);
  assert.equal(main.staticLocalImports,1);

  put(src,"main.js",'"use strict"; require("../outside");\n');
  await asar.createPackage(src,out);
  const escape=invoke(out);
  assert.notEqual(escape.status,0);
  assert.match(escape.stderr,/root module import escapes archive/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test("the published desktop file allowlist includes every local static main import",()=>{
 const root=path.join(__dirname,"..");
 const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
 const main=fs.readFileSync(path.join(root,"main.js"),"utf8");
 const allow=new Set(pkg.build.files);
 const modules=[...main.matchAll(/\brequire\s*\(\s*["'](\.\/[^"']+)["']\s*\)/g)]
  .map(m=>m[1].slice(2));
 for(const mod of modules){
  assert.ok(allow.has(mod)||allow.has(mod+".js"),
   "Electron build.files omits required main-process module "+mod);
 }
 assert.ok(allow.has("backgroundTimerPolicy.js"));
 assert.ok(allow.has("diagnosticLimits.js"));
});
