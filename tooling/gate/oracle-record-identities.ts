// Cheap population inputs are checked on every landing. The other identity
// fields are named gaps requiring native planning, not inferred from metadata.
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {domainDeclaration,fixtureOf,recordPath,type OracleIdentityInputs,type RecordedDomain} from "../differential/oracle-records.ts";
import {infrastructureProbe,type InfrastructureProbe} from "./infrastructure-probe.ts";
import {publishToolingFailure,ToolingInstrumentError} from "./step-result.ts";

export const ORACLE_IDENTITY_INPUTS={
  source:"tree",source_digest:"tree",input_domain:"tree",
  signature:"native-plan",keys:"native-plan",cases_sha256:"native-plan",driver_sha256:"native-plan",
} as const satisfies Record<keyof OracleIdentityInputs,"tree"|"native-plan">;
type TreeInput={ [K in keyof typeof ORACLE_IDENTITY_INPUTS]:typeof ORACLE_IDENTITY_INPUTS[K] extends "tree"?K:never }[keyof typeof ORACLE_IDENTITY_INPUTS];

/** NumericDomain's declared defaults match the native planner. Explanatory
 * reasons and JSON formatting do not generate calls. */
export function domainConstraints(value:RecordedDomain["declaration"]|undefined):string {
  if(!value)return "null";
  const parsed=domainDeclaration(value);
  const ordered=([a]:[string,unknown],[b]:[string,unknown])=>a<b?-1:a>b?1:0;
  return JSON.stringify(Object.entries(parsed.functions).sort(ordered).map(([name,parameters])=>
    [name,Object.entries(parameters).sort(ordered).map(([parameter,value])=>
      [parameter,{min:value.min??null,max:value.max??null,integer:value.integer??false,allowNaN:value.allowNaN??false}])]));
}

/** One deterministic XXH3-128 batch uses the same digest as the Rust reader.
 * xxhsum is a required system capability; a missing or broken tool is named
 * by the shared infrastructure probe, never treated as a matching digest. */
export function oracleSourceDigests(root:string,sources:readonly string[],env:NodeJS.ProcessEnv,probe:InfrastructureProbe=infrastructureProbe):Map<string,string>{
  if(!sources.length)return new Map();
  const fail=(reason:string):never=>{
    const error=new ToolingInstrumentError("tooling-setup","oracle source_digest: "+reason);
    publishToolingFailure(error,env);throw error;
  };
  const result=probe({purpose:"oracle source_digest XXH3-128",command:"xxhsum",args:["-H128","--",...sources],cwd:root,env});
  const expected=new Set(sources),found=new Map<string,string>();
  for(const line of result.stdout.trimEnd().split("\n")){
    const match=/^([a-f0-9]{32})  (.+)$/.exec(line);
    if(!match)return fail("malformed xxhsum result: "+line);
    if(!expected.has(match[2]!)||found.has(match[2]!))fail("unexpected xxhsum result: "+line);
    found.set(match[2]!,match[1]!);
  }
  if(found.size!==expected.size)fail("xxhsum omitted a requested source");
  return found;
}

export function oracleIdentityProblems(root:string,rows:readonly OracleIdentityInputs[],env:NodeJS.ProcessEnv,probe:InfrastructureProbe=infrastructureProbe):string[]{
  const sources=[...new Set(rows.filter(row=>row.source_digest!==undefined&&existsSync(join(root,row.source))).map(row=>row.source))].sort();
  const digests=oracleSourceDigests(root,sources,env,probe),domains=new Map<string,string>();
  const currentDomain=(source:string)=>{
    if(!domains.has(source)){
      const path=join(root,source).replace(/\.[^/.]+$/,".domains.json");
      try{domains.set(source,domainConstraints(existsSync(path)?domainDeclaration(JSON.parse(readFileSync(path,"utf8"))):undefined));}
      catch(error){throw Error(`oracle identity input_domain ${path}: ${String(error)}`,{cause:error});}
    }
    return domains.get(source)!;
  };
  const check:Record<TreeInput,(row:OracleIdentityInputs)=>boolean>={
    source:row=>existsSync(join(root,row.source)),
    source_digest:row=>row.source_digest===undefined||digests.get(row.source)===row.source_digest,
    input_domain:row=>currentDomain(row.source)===domainConstraints(row.input_domain?.declaration),
  };
  const problems:string[]=[];
  for(const row of rows)for(const input of Object.keys(check) as TreeInput[]){
    if(!check[input](row))problems.push(`${recordPath(fixtureOf(row.source))}: ${row.source}: recorded identity input ${input} changed; delete this fixture's oracle record in the same commit so the full check re-records it`);
  }
  return [...new Set(problems)].sort();
}

export function oracleIdentityScope():string{
  const named=(scope:"tree"|"native-plan")=>Object.entries(ORACLE_IDENTITY_INPUTS).filter(([,value])=>value===scope).map(([name])=>name).join(", ");
  return `oracle identity inputs checked: ${named("tree")} (input_domain by normalized declaration); require native plans: ${named("native-plan")}, input_domain.identity's native serialization hash, generator version/digest. Budget revision provenance remains the refresh planner's input.`;
}
