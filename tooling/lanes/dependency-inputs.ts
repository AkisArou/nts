// Registry bytes are acquired before submission; every reader installs frozen
// and offline into its own tree. No installed tree is an input of another.
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {userInfo} from "node:os";
import {dirname,join,relative,resolve,sep} from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as pause} from "node:timers/promises";
import {activeCommand} from "../gate/active-command.ts";
import {ToolingInstrumentError,publishToolingFailure} from "../gate/step-result.ts";
import {hostEnvironment,FIXED_AMBIENT} from "../gate/canonical-environment.ts";
import {GateResource} from "./gate-resource.ts";
import {durableRecord} from "./durable-record.ts";

const digest=(data:string|Buffer)=>createHash("sha256").update(data).digest("hex");
export function dependencyCache(root:string):string {
  return join(userInfo().homedir,".cache/nts-dependencies",digest(realpathSync(root)));
}
const failure=(message:string)=>new ToolingInstrumentError("tooling-setup",`dependency inputs: ${message}`);
function git(repo:string,...args:string[]):string {
  return execFileSync("git",args,{cwd:repo,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
}
function hasDependencies(tree:string):boolean {
  if(!existsSync(join(tree,"pnpm-lock.yaml"))) {
    if(existsSync(join(tree,"package.json")))throw failure(`missing pnpm-lock.yaml in ${tree}`);
    return false; // Non-JavaScript scratch repositories have no package graph.
  }
  return true;
}
async function locked<T>(path:string,operation:()=>Promise<T>):Promise<T> {
  let lock:GateResource|null;
  while(!(lock=GateResource.tryAcquire(path)))await pause(100);
  try{return await operation();}finally{lock.close();}
}
function managerVersion(tree:string):string {
  const manifest=JSON.parse(readFileSync(join(tree,"package.json"),"utf8"));
  const version=/^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(?:\+.*)?$/.exec(manifest.packageManager??"")?.[1];
  if(!version)throw failure(`packageManager must name an exact pnpm version: ${String(manifest.packageManager)}`);
  return version;
}
function managerSpec(tree:string):string {managerVersion(tree);return JSON.parse(readFileSync(join(tree,"package.json"),"utf8")).packageManager;}
function managerHome(spec:string):string {return join(userInfo().homedir,".cache/nts-toolchains/corepack",digest(spec),"home");}
function publishedManager(spec:string):{version:1;pnpm:string;spec:string;sha256:string} {
  const path=join(dirname(managerHome(spec)),"manager.json");
  if(!existsSync(path))throw failure(`package-manager artifact is not acquired for ${spec}`);
  const record=JSON.parse(readFileSync(path,"utf8"));
  if(record.version!==1||record.spec!==spec||typeof record.pnpm!=="string"||typeof record.sha256!=="string"||!/^[0-9a-f]{64}$/.test(record.sha256))throw failure(`invalid package-manager identity for ${spec}`);
  return record;
}
async function command(tree:string,program:string,args:string[],extra:NodeJS.ProcessEnv={}):Promise<string> {
  const result=await activeCommand(program,args,{cwd:tree,env:{...hostEnvironment(process.env),...FIXED_AMBIENT,CI:"true",...extra}});
  if(result.hung||result.runaway)throw failure(result.hung??result.runaway!);
  if(result.error||result.status!==0)throw failure(`${program} ${args.join(" ")}\n${result.error?.message??result.out}`);
  return result.stdout;
}
async function pnpm(tree:string,args:string[]):Promise<string> {
  const spec=managerSpec(tree);publishedManager(spec);
  return command(tree,"corepack",[spec,"--config.manage-package-manager-versions=false",...args],{
    COREPACK_HOME:managerHome(spec),COREPACK_ENABLE_NETWORK:"0",COREPACK_ENABLE_DOWNLOAD_PROMPT:"0",COREPACK_DEFAULT_TO_LATEST:"0",
  });
}
/** Export the already installed host manager through Corepack's public API.
 * Only acquisition may fetch a missing manager. Consumers disable networking
 * through both the manager launcher and pnpm, even with a fresh HOME.
 */
async function acquireManager(tree:string):Promise<void> {
  const version=managerVersion(tree),spec=managerSpec(tree),directory=dirname(managerHome(spec));
  await locked(join(directory,"acquire.lock"),async()=>{
    const record=join(directory,"manager.json"),archive=join(directory,"corepack.tgz");
    if(existsSync(record)) {
      const previous=JSON.parse(readFileSync(record,"utf8"));
      if(previous.version!==1||previous.pnpm!==version||previous.spec!==spec||previous.sha256!==digest(readFileSync(archive)))throw failure("package-manager artifact identity changed");
    }else {
      await command(tree,"corepack",["pack",spec,"--json","--output",archive],{COREPACK_ENABLE_NETWORK:"1",COREPACK_ENABLE_DOWNLOAD_PROMPT:"0",COREPACK_DEFAULT_TO_LATEST:"0"});
      await command(tree,"corepack",["install","--global","--cache-only",archive],{COREPACK_HOME:managerHome(spec),COREPACK_ENABLE_NETWORK:"0"});
    }
    const observed=(await command(tree,"corepack",[spec,"--version"],{COREPACK_HOME:managerHome(spec),COREPACK_ENABLE_NETWORK:"0",COREPACK_ENABLE_DOWNLOAD_PROMPT:"0",COREPACK_DEFAULT_TO_LATEST:"0"})).trim();
    if(observed!==version)throw failure(`package-manager artifact returned ${observed}, expected ${version}`);
    if(!existsSync(record))durableRecord(record,{version:1,pnpm:version,spec,sha256:digest(readFileSync(archive))});
  });
}

type Identity={version:1;key:string;pnpm:string;manager:string;node:string;platform:string;arch:string;inputs:{path:string;sha256:string}[];importers:string[]};
async function identity(tree:string):Promise<Identity> {
  const version=(await pnpm(tree,["--version"])).trim();
  const manifest=JSON.parse(readFileSync(join(tree,"package.json"),"utf8"));
  const expected=/^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(?:\+.*)?$/.exec(manifest.packageManager??"")?.[1];
  if(!expected||version!==expected)throw failure(`packageManager ${String(manifest.packageManager)} requires pnpm ${expected??"with an exact version"}, observed ${version}`);
  const projects=JSON.parse(await pnpm(tree,["--recursive","--include-workspace-root","list","--depth=-1","--json"])) as {path:string}[];
  const importers=[...new Set([".",...projects.map(project=>{
    const path=relative(tree,realpathSync(project.path));
    if(path===".."||path.startsWith(".."+sep)||resolve(tree,path)===dirname(tree))throw failure("pnpm reported a workspace outside its tree");
    return path||".";
  })])].sort();
  const files=[...new Set(["pnpm-lock.yaml","pnpm-workspace.yaml",".npmrc",".pnpmfile.cjs","pnpmfile.cjs",...importers.flatMap(path=>[join(path,"package.json"),join(path,".npmrc")])])].sort();
  const inputs=files.map(path=>({path,sha256:existsSync(join(tree,path))?digest(readFileSync(join(tree,path))):"absent"}));
  const manager=publishedManager(managerSpec(tree)).sha256;
  const value={version:1 as const,pnpm:version,manager,node:process.versions.node,platform:process.platform,arch:process.arch,inputs,importers};
  return {...value,key:digest(JSON.stringify(value))};
}
function storeAt(root:string,id:Identity):string {
  return join(dependencyCache(root),`pnpm-${id.pnpm}-${id.platform}-${id.arch}`,"store");
}
function recordAt(root:string,id:Identity):string {return join(dependencyCache(root),"identities",id.key+".json");}
function assertPrivate(root:string,tree:string):void {
  if(realpathSync(root)===realpathSync(tree))throw failure("prepare a private tree; the shared checkout is never an installation target");
}
function removeModules(tree:string,importers:string[]):void {
  const files=execFileSync("git",["ls-files","-z"],{cwd:tree,encoding:"utf8"}).split("\0").filter(Boolean);
  const owners=new Set(importers),tracked=new Set<string>();
  for(const file of files) {
    const parts=file.split("/");
    const at=parts.indexOf("node_modules");if(at>=0)tracked.add(parts.slice(0,at+1).join("/"));
    for(let directory=dirname(file);directory!==".";directory=dirname(directory))owners.add(directory);
  }
  for(const importer of owners) {
    const path=join(tree,importer,"node_modules");
    if([...tracked].some(source=>relative(tree,path)===source||relative(tree,path).startsWith(source+sep))) {
      if(importers.includes(importer))throw failure(`an install target is tracked source: ${relative(tree,path)}`);
      continue;
    }
    if(existsSync(dirname(path))) {
      const parent=realpathSync(dirname(path));
      if(parent!==tree&&!parent.startsWith(tree+sep))throw failure(`module directory escapes its tree: ${path}`);
    }
    // rm removes a symlink itself. It must never traverse main's old link.
    if(existsSync(path)||(()=>{try{return lstatSync(path).isSymbolicLink();}catch(error){if(error.code==="ENOENT")return false;throw error;}})())rmSync(path,{recursive:true,force:true});
  }
}

/** The only online path, run on an immutable archive, never main or a caller's tree. */
export async function acquireRevision(root:string,repo:string,revision:string):Promise<string|undefined> {
  const cache=dependencyCache(root),parent=join(cache,"acquiring");mkdirSync(parent,{recursive:true});
  const scratch=mkdtempSync(join(parent,"revision-")),tree=join(scratch,"tree"),archive=join(scratch,"source.tar");mkdirSync(tree);
  try {
    const sha=git(repo,"rev-parse","--verify",`${revision}^{commit}`);
    git(repo,"archive","--format=tar",`--output=${archive}`,sha);
    execFileSync("tar",["-xf",archive,"-C",tree]);rmSync(archive);
    if(!hasDependencies(tree))return;
    await acquireManager(tree);
    const id=await identity(tree);
    return await locked(join(cache,"locks",id.key+".lock"),async()=>{
      const record=recordAt(root,id);
      if(existsSync(record)) {
        const previous=JSON.parse(readFileSync(record,"utf8"));
        if(previous.version!==1||previous.acquired!==true||JSON.stringify(previous.identity)!==JSON.stringify(id))throw failure("dependency identity record changed");
      }
      // A record is provenance, not proof that regenerable content still
      // exists. pnpm validates the store and acquires any missing bytes.
      await pnpm(tree,["fetch","--frozen-lockfile","--ignore-scripts","--verify-store-integrity","--fetch-retries=0","--store-dir",storeAt(root,id),"--reporter=append-only"]);
      const after=await identity(tree);
      if(after.key!==id.key) {
        const changed=after.inputs.filter(file=>id.inputs.find(old=>old.path===file.path)?.sha256!==file.sha256).map(file=>file.path);
        throw failure(`dependency inputs changed during acquisition: ${changed.join(", ")||"workspace inventory"}`);
      }
      durableRecord(record,{version:1,identity:id,source:sha,acquired:true});
      return id.key;
    });
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

/** Prepare all preflight endpoints before a selector or the gate reads them. */
export async function acquireSubmission(root:string,tree:string,sha:string):Promise<void> {
  try {
    if(!hasDependencies(tree))return;
    await acquireRevision(root,tree,sha);
    const base=git(root,"merge-base","main",sha),main=git(root,"rev-parse","main");
    for(const revision of new Set([base,main]))if(revision!==sha)await acquireRevision(root,root,revision);
  }catch(error){throw error instanceof ToolingInstrumentError?error:failure(String(error));}
}

/** A composed lock may be new; its acquired content union must resolve offline. */
export async function installDependencies(root:string,tree:string):Promise<string|undefined> {
  tree=realpathSync(tree);
  if(!hasDependencies(tree))return;
  assertPrivate(root,tree);
  const cache=dependencyCache(root);
  return locked(join(cache,"trees",digest(realpathSync(tree))+".lock"),async()=>{
    const id=await identity(tree),state=join(cache,"trees",digest(realpathSync(tree))+".json");
    let previous:string[]=[];
    if(existsSync(state)) {
      const record=JSON.parse(readFileSync(state,"utf8"));if(record.version!==1)throw failure("unsupported importer inventory");previous=record.importers;
      if(!Array.isArray(previous)||previous.some(p=>typeof p!=="string"||resolve(tree,p)!==tree&&!resolve(tree,p).startsWith(tree+sep)))throw failure("invalid previous importer inventory");
    }
    removeModules(tree,[...new Set([...previous,...id.importers])]);
    await pnpm(tree,["install","--offline","--frozen-lockfile","--ignore-scripts","--verify-store-integrity","--store-dir",storeAt(root,id),"--reporter=append-only"]);
    if((await identity(tree)).key!==id.key)throw failure("dependency inputs changed during offline installation");
    durableRecord(state,{version:1,identity:id.key,importers:id.importers});
    durableRecord(recordAt(root,id),{version:1,identity:id,acquired:true});
    return id.key;
  });
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [mode,root,tree,revision,...extra]=process.argv.slice(2);
  try {
    if(!root||!tree||extra.length||!['--acquire','--offline'].includes(mode))throw failure("usage: dependency-inputs.ts --acquire <shared> <source> <commit> | --offline <shared> <tree>");
    if(mode==="--acquire")await acquireSubmission(root,tree,revision??"HEAD");
    else await installDependencies(root,tree);
  }catch(error){const problem=error instanceof ToolingInstrumentError?error:failure(String(error));publishToolingFailure(problem);console.error(`instrument failure: ${problem.message}`);process.exitCode=2;}
}
