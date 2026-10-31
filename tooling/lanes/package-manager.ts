// The archive hash in packageManager owns the tool, independently of Node's
// distribution. Only acquisition fetches; every invocation executes a private
// copy extracted from the verified cached bytes, never a mutable installation.
import {createHash} from "node:crypto";
import {closeSync,existsSync,fsyncSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,renameSync,rmSync,statSync,writeFileSync} from "node:fs";
import {userInfo} from "node:os";
import {dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
import {activeCommand} from "../gate/active-command.ts";
import {hostEnvironment,FIXED_AMBIENT} from "../gate/canonical-environment.ts";
import {ToolingInstrumentError} from "../gate/step-result.ts";
import {GateResource} from "./gate-resource.ts";
import {durableRecord} from "./durable-record.ts";

// Manifests before this commit carry bare pins. This frozen table only gains
// an entry for a bare spec that a historical main actually shipped.
export const HISTORICAL_PACKAGE_MANAGERS:Readonly<Record<string,string>>=Object.freeze({
  "pnpm@10.15.0":"486ebc259d3e999a4e8691ce03b5cac4a71cbeca39372a9b762cb500cfdf0873e2cb16abe3d951b1ee2cf012503f027b98b6584e4df22524e0c7450d9ec7aa7b",
});
export type ManagerPin={spec:string;declared:string;version:string;sha512:string};
const failure=(message:string)=>new ToolingInstrumentError("tooling-setup",`package manager: ${message}`);
const hash=(bytes:Buffer)=>createHash("sha512").update(bytes).digest("hex");
export function packageManagerPin(declared:unknown):ManagerPin {
  if(typeof declared!=="string")throw failure(`packageManager must be a hash-pinned pnpm spec, got ${String(declared)}`);
  const match=/^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(?:\+sha512\.([0-9a-f]{128}))?$/.exec(declared);
  if(!match)throw failure(`invalid packageManager ${declared}; expected pnpm@<version>+sha512.<128 hex digits>`);
  const version=match[1]!,historical=HISTORICAL_PACKAGE_MANAGERS[`pnpm@${version}`];
  const sha512=match[2]??historical;
  if(!sha512)throw failure(`unknown historical bare spec ${declared}; a sha512 pin is required`);
  if(historical&&sha512!==historical)throw failure(`hash conflict for pnpm@${version}: manifest ${sha512}, historical main ${historical}`);
  return {declared,version,sha512,spec:`pnpm@${version}+sha512.${sha512}`};
}
export function managerPin(tree:string):ManagerPin {
  return packageManagerPin(JSON.parse(readFileSync(join(tree,"package.json"),"utf8")).packageManager);
}
const toolchains=()=>join(userInfo().homedir,".cache/nts-toolchains");
export function managerArchive(pin:ManagerPin,cache=toolchains()):string {
  return join(cache,"pnpm",pin.sha512,"pnpm.tgz");
}
export function verifiedManagerBytes(pin:ManagerPin,cache=toolchains()):Buffer {
  const archive=managerArchive(pin,cache);
  if(!existsSync(archive))throw failure(`cache missing for ${pin.spec}: ${archive}; acquire this revision first`);
  const bytes=readFileSync(archive),actual=hash(bytes);
  if(actual!==pin.sha512)throw failure(`cache hash mismatch for ${pin.spec}: ${archive}; observed sha512.${actual}`);
  return bytes;
}
async function command(tree:string,program:string,args:string[]):Promise<string> {
  const result=await activeCommand(program,args,{cwd:tree,env:{...hostEnvironment(process.env),...FIXED_AMBIENT,CI:"true"}});
  if(result.hung||result.runaway)throw failure(result.hung??result.runaway!);
  if(result.error||result.status!==0)throw failure(`${program} ${args.join(" ")}\n${result.error?.message??result.out}`);
  return result.stdout;
}
export type PackageManager={pin:ManagerPin;run:(args:string[])=>Promise<string>};
async function privateManager<T>(tree:string,pin:ManagerPin,bytes:Buffer,cache:string,operation:(manager:PackageManager)=>Promise<T>):Promise<T> {
  const parent=join(cache,"executing");mkdirSync(parent,{recursive:true});
  const scratch=mkdtempSync(join(parent,"pnpm-")),archive=join(scratch,"pnpm.tgz"),unpacked=join(scratch,"unpacked");
  try {
    // Copy the exact bytes already hashed, so an archive replaced after the
    // verification cannot become the extraction input.
    writeFileSync(archive,bytes,{flag:"wx",mode:0o600});mkdirSync(unpacked);
    const names=(await command(tree,"tar",["-tzf",archive])).split("\n").filter(Boolean);
    if(!names.length||names.some(name=>isAbsolute(name)||name.split("/").includes("..")||!/^package(?:\/|$)/.test(name)))throw failure(`unsafe archive paths for ${pin.spec}`);
    await command(tree,"tar",["-xzf",archive,"--no-same-owner","--no-same-permissions","-C",unpacked]);
    const directory=join(unpacked,"package"),manifest=JSON.parse(readFileSync(join(directory,"package.json"),"utf8"));
    if(manifest.name!=="pnpm"||manifest.version!==pin.version)throw failure(`archive identity for ${pin.spec} is ${manifest.name}@${manifest.version}`);
    const entry=typeof manifest.bin==="string"?manifest.bin:manifest.bin?.pnpm;
    if(typeof entry!=="string"||isAbsolute(entry))throw failure(`archive has no pnpm bin for ${pin.spec}`);
    const binary=realpathSync(resolve(directory,entry)),inside=relative(realpathSync(directory),binary);
    if(inside===".."||inside.startsWith(".."+sep)||!statSync(binary).isFile())throw failure(`archive bin escapes pnpm for ${pin.spec}`);
    return await operation({pin,run:args=>command(tree,process.execPath,[binary,"--config.manage-package-manager-versions=false",...args])});
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
const DOWNLOAD=`
import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
const response=await fetch(process.argv[1]);
if(!response.ok)throw Error('HTTP '+response.status+' for '+process.argv[1]);
const file=openSync(process.argv[2],'wx',0o600);let bytes=0;
try {for await(const chunk of response.body){writeFileSync(file,chunk);bytes+=chunk.length;process.stdout.write('received '+bytes+' bytes\\n');}fsyncSync(file);}finally{closeSync(file);}
`;
async function acquireManager(tree:string,pin:ManagerPin,cache:string):Promise<void> {
  const archive=managerArchive(pin,cache),directory=dirname(archive),lock=join(cache,"locks",pin.sha512+".lock");
  let resource:GateResource|null;
  while(!(resource=GateResource.tryAcquire(lock)))await pause(100);
  try {
    if(existsSync(directory)){verifiedManagerBytes(pin,cache);return;}
    const parent=dirname(directory);mkdirSync(parent,{recursive:true});
    const staging=mkdtempSync(join(parent,"acquiring-")),downloaded=join(staging,"pnpm.tgz");
    try {
      const url=`https://registry.npmjs.org/pnpm/-/pnpm-${pin.version}.tgz`;
      await command(tree,process.execPath,["--input-type=module","-e",DOWNLOAD,url,downloaded]);
      const bytes=readFileSync(downloaded),actual=hash(bytes);
      if(actual!==pin.sha512)throw failure(`download hash mismatch for ${pin.spec}: ${url}; observed sha512.${actual}`);
      await privateManager(tree,pin,bytes,cache,async manager=>{
        const observed=(await manager.run(["--version"])).trim();
        if(observed!==pin.version)throw failure(`archive ${pin.spec} returned version ${observed}`);
      });
      durableRecord(join(staging,"artifact.json"),{version:1,package:"pnpm",packageVersion:pin.version,sha512:pin.sha512,url,bytes:bytes.length});
      renameSync(staging,directory);
      const fd=openSync(parent,"r");try{fsyncSync(fd);}finally{closeSync(fd);}
    }finally{rmSync(staging,{recursive:true,force:true});}
  }finally{resource.close();}
}
/** One private manager per dependency operation; only acquire may fetch. */
export async function withPackageManager<T>(tree:string,options:{acquire?:boolean;cache?:string},operation:(manager:PackageManager)=>Promise<T>):Promise<T> {
  const pin=managerPin(tree),cache=options.cache??toolchains();
  if(options.acquire)await acquireManager(tree,pin,cache);
  return privateManager(tree,pin,verifiedManagerBytes(pin,cache),cache,operation);
}
