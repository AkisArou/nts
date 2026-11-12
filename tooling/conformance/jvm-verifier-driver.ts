// A run owns one javac result for its verifier driver. Runtime and outcomes
// commands share that run-local result; no compilation survives into another run.
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {artifactFiles,canonicalJson,fileDigest} from "../gate/artifact-shadow.ts";
import {durableRecord} from "../gate/durable-record.ts";
import {ToolingInstrumentError} from "../gate/step-result.ts";
import {vmToolFlags} from "../jvm/vm-flags.ts";

export type DriverProcessResult={status?:number|null;signal?:string|null;error?:Error;stdout:string;stderr:string};
export type DriverCommand=(command:string,args:string[],env:NodeJS.ProcessEnv)=>Promise<DriverProcessResult>;
export type VerifierDriver={directory:string;identity:{source_sha256:string;javac:unknown;flags:string[]}};
type DriverOptions={root:string;source:string;javac:string;env:NodeJS.ProcessEnv;run:DriverCommand;identify:(command:string,env:NodeJS.ProcessEnv)=>unknown};

/** The caller owns root inside its run. One promise coordinates its workers;
 * a checked manifest lets the next sequential corpus command use the same
 * compilation. Its source, compiler and every produced class are validated. */
export function createVerifierDriver():(options:DriverOptions)=>Promise<VerifierDriver>{
  const preparing=new Map<string,Promise<VerifierDriver>>();
  return options=>{
    const identity={source_sha256:fileDigest(options.source),javac:options.identify(options.javac,options.env),flags:vmToolFlags(options.javac)};
    const key=createHash("sha256").update(canonicalJson(identity)).digest("hex"),root=join(options.root,key);
    let work=preparing.get(root);
    if(!work){work=prepare({...options,root},identity);preparing.set(root,work);}
    return work;
  };
}

async function prepare(options:DriverOptions,identity:VerifierDriver["identity"]):Promise<VerifierDriver>{
  const directory=join(options.root,"classes"),manifest=join(options.root,"manifest.json");
  const files=()=>artifactFiles(directory,"verifier-driver").map(file=>({name:file.name,sha256:fileDigest(file.path)}));
  try {
    const saved=JSON.parse(readFileSync(manifest,"utf8"));
    if(saved.version===1&&canonicalJson(saved.identity)===canonicalJson(identity)
      &&Array.isArray(saved.files)&&saved.files.length>0&&canonicalJson(saved.files)===canonicalJson(files()))return {directory,identity};
  }catch{ /* Only an intact compilation from this run may be reused. */ }
  rmSync(manifest,{force:true});rmSync(directory,{recursive:true,force:true});mkdirSync(directory,{recursive:true});
  const result=await options.run(options.javac,[...identity.flags,"-d",directory,options.source],options.env);
  if(result.error||result.signal||result.status!==0)throw new ToolingInstrumentError("tooling-setup",
    `verifier driver javac failed: ${result.error?.message??result.signal??`exit ${result.status}`}\n${result.stdout}${result.stderr}`);
  const compiled=files();
  if(!compiled.some(file=>file.name==="verifier-driver/JvmVerify.class"))throw new ToolingInstrumentError("tooling-setup","verifier driver javac wrote no JvmVerify.class");
  if(fileDigest(options.source)!==identity.source_sha256||canonicalJson(options.identify(options.javac,options.env))!==canonicalJson(identity.javac))
    throw new ToolingInstrumentError("tooling-setup","verifier driver source or javac changed during compilation");
  durableRecord(manifest,{version:1,identity,files:compiled});
  return {directory,identity};
}
