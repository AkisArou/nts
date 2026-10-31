// Discover test entries, rather than maintaining a second catalogue of folders.
import {execFileSync} from "node:child_process";
import {readdirSync,readFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {publishToolingFailure,ToolingInstrumentError} from "./step-result.ts";

export const TOOLING_TEST_EXCLUSIONS="tooling/gate/tooling-test-exclusions.json";
export type ToolingTestExclusion={path:string;reason:string;step:string};
export function isToolingTest(path:string):boolean {
  return /^tooling\/(?:[^/]+\/)*[^/]+\.test\.(?:ts|mjs)$/.test(path)
    &&!path.split("/").some(part=>["node_modules",".",".."].includes(part))&&!path.includes("\\");
}
function observe<T>(name:string,read:()=>T):T {
  try{return read();}
  catch(error){throw new ToolingInstrumentError("tooling-setup",`cannot observe ${name}: ${String(error)}`,{cause:error});}
}
export function toolingStepNames(root:string):string[] {
  return observe("gate step names",()=>execFileSync("sh",[join(root,"tooling/gate/all.sh"),"--list"],{
    cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],
  }).trim().split("\n").filter(Boolean));
}
export function parseToolingTestExclusions(value:unknown,steps:Iterable<string>):ToolingTestExclusion[] {
  if(!Array.isArray(value))throw new Error("tooling test exclusions must be an array");
  const owners=new Set(steps),seen=new Set<string>();
  return value.map((item:unknown)=>{
    if(typeof item!=="object"||item===null)throw new Error("invalid tooling test exclusion");
    const row=item as Record<string,unknown>;
    if(Object.keys(row).sort().join(",")!=="path,reason,step"||typeof row.path!=="string"||!isToolingTest(row.path)
      ||/[\x00-\x1f*?\[\]]/.test(row.path)||typeof row.reason!=="string"||!row.reason.trim()
      ||typeof row.step!=="string"||row.step==="tooling"||!owners.has(row.step))
      throw new Error(`invalid tooling test exclusion: ${JSON.stringify(item)}; requires an exact test path, reason and another existing gate step`);
    if(seen.has(row.path))throw new Error(`duplicate tooling test exclusion: ${row.path}`);
    seen.add(row.path);
    return {path:row.path,reason:row.reason,step:row.step};
  });
}
export function readToolingTestExclusions(root:string,steps:Iterable<string>):ToolingTestExclusion[] {
  const text=observe(TOOLING_TEST_EXCLUSIONS,()=>readFileSync(join(root,TOOLING_TEST_EXCLUSIONS),"utf8"));
  return parseToolingTestExclusions(JSON.parse(text),steps);
}
/** Shared with owed: an excluded test still owes the step that runs it. */
export function toolingTestStep(path:string,exclusions:readonly ToolingTestExclusion[]):string|undefined {
  return isToolingTest(path)?exclusions.find(row=>row.path===path)?.step??"tooling":undefined;
}
export function collectToolingTests(root:string):string[] {
  const files:string[]=[];
  function walk(path:string):void {
    const entries=observe(path,()=>readdirSync(join(root,path),{withFileTypes:true}));
    for(const entry of entries){
      if(entry.name==="node_modules")continue;
      const child=`${path}/${entry.name}`;
      if(entry.isDirectory())walk(child);
      else if(entry.isFile()&&isToolingTest(child))files.push(child);
      else if(entry.isSymbolicLink()&&isToolingTest(child))throw new Error(`tooling test entry must be a regular file: ${child}`);
    }
  }
  walk("tooling");
  return files.sort();
}
/** Independent of the directory walker: dropping a folder must fail coverage.
 * Include untracked and ignored files too; node_modules is the only directory
 * exception, and neither an index omission nor .gitignore may hide a test. */
export function toolingTestInventory(root:string):string[] {
  const paths=observe("Git tooling test inventory",()=>execFileSync("git",["ls-files","-z","--cached","--others","--","tooling"],{
    cwd:root,encoding:"utf8",maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"],
  }));
  return [...new Set(paths.split("\0").filter(isToolingTest))].sort();
}
export function validateToolingCoverage(inventory:readonly string[],collected:readonly string[],exclusions:readonly ToolingTestExclusion[]):void {
  const expected=new Set(inventory),covered=new Set<string>();
  if(!expected.size)throw new Error("tooling test inventory is empty");
  for(const path of [...collected,...exclusions.map(row=>row.path)]){
    if(!expected.has(path))throw new Error(`stale or unknown tooling test entry: ${path}`);
    if(covered.has(path))throw new Error(`tooling test entry collected more than once or also excluded: ${path}`);
    covered.add(path);
  }
  const missing=[...expected].filter(path=>!covered.has(path));
  if(missing.length)throw new Error(`tooling tests neither collected nor explicitly excluded:\n${missing.join("\n")}`);
}
export function discoverToolingTests(root:string):{files:string[];exclusions:ToolingTestExclusion[];inventoryCount:number} {
  const inventory=toolingTestInventory(root),exclusions=readToolingTestExclusions(root,toolingStepNames(root));
  const excluded=new Set(exclusions.map(row=>row.path));
  const files=collectToolingTests(root).filter(path=>!excluded.has(path));
  validateToolingCoverage(inventory,files,exclusions);
  return {files,exclusions,inventoryCount:inventory.length};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {
    const mode=process.argv.slice(2);
    if(mode.length!==1||mode[0]!=="--list")throw new Error("usage: node tooling/gate/tooling-discovery.ts --list");
    const root=resolve(dirname(fileURLToPath(import.meta.url)),"../.."),selection=discoverToolingTests(root);
    process.stdout.write(JSON.stringify(selection,null,2)+"\n");
  } catch(error) {
    if(error instanceof ToolingInstrumentError)publishToolingFailure(error);
    process.stderr.write((error instanceof Error?error.stack:String(error))+"\n");
    process.exitCode=error instanceof ToolingInstrumentError?2:1;
  }
}
