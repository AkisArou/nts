import {gitArguments} from "./git-arguments/main.ts";
import {infrastructureProbe,type InfrastructureProbe} from './infrastructure-probe.ts';
import {ToolingInstrumentError} from './step-result.ts';
import {lstatSync,readFileSync} from "node:fs";
import {join} from "node:path";

export type PathChange = {path:string;added:boolean;deleted:boolean;sameMode?:boolean;before?:string;after?:string};

/** A rename is both paths, so moving a fixture cannot erase its old reach. */
export function parseNameStatus(text:string):PathChange[] {
  const out:PathChange[]=[];
  if(text.includes("\0")) {
    const fields=text.split("\0");
    for(let i=0;i<fields.length-1;) {
      const status=fields[i++],path=fields[i++];
      if(!status||path===undefined)throw new Error("incomplete Git name-status record");
      if(/^[RC]/.test(status)) {
        const destination=fields[i++];
        if(destination===undefined)throw new Error("incomplete Git rename record");
        if(status.startsWith("R"))out.push({path,added:false,deleted:true});
        out.push({path:destination,added:true,deleted:false});
      }else out.push({path,added:status.startsWith("A"),deleted:status.startsWith("D")});
    }
    return out;
  }
  for (const line of text.split("\n").filter(Boolean)) {
    const [status,...paths]=line.split("\t");
    if (/^[RC]/.test(status) && paths.length>=2) {
      if (status.startsWith("R")) out.push({path:paths[0],added:false,deleted:true});
      out.push({path:paths[1],added:true,deleted:false});
    } else out.push({path:paths.at(-1)!,added:status.startsWith("A"),deleted:status.startsWith("D")});
  }
  return out;
}

export function contentChanges(repo:string,changes:PathChange[],from:string,to:string|null,probe:InfrastructureProbe=infrastructureProbe):PathChange[] {
  const git=(...args:string[])=>{
    const result=probe({purpose:`selector content git ${args[0]}`,command:'git',args:gitArguments(args),cwd:repo,stdio:['ignore','pipe','pipe'],maxBuffer:8<<20,exits:'classify'});
    if(result.status!==0)throw Error(`selector content git ${args[0]} exited ${result.status}: ${(result.stderr??'').trim()}`);
    return result.stdout;
  };
  return changes.map(change=>{
    if(change.added||change.deleted)return change;
    try {
      const mode=(rev:string)=>git("ls-tree",rev,"--",change.path).split(" ")[0];
      const oldMode=mode(from),file=to?null:lstatSync(join(repo,change.path));
      const newMode=to?mode(to):file!.isFile()?file!.mode&0o111?"100755":"100644":"other";
      if(!["100644","100755"].includes(oldMode)||oldMode!==newMode)return change;
      return {...change,sameMode:true,before:git("show",`${from}:${change.path}`),after:to?git("show",`${to}:${change.path}`):readFileSync(join(repo,change.path),"utf8")};
    } catch(error) {if(error instanceof ToolingInstrumentError)throw error;return change;}
  });
}

export function committedChanges(repo:string,from:string,to:string,probe:InfrastructureProbe=infrastructureProbe):PathChange[] {
  const status=probe({purpose:'selector committed Git paths',command:'git',args:gitArguments(["diff","--name-status","-z","-M",from,to]),cwd:repo}).stdout;
  return contentChanges(repo,parseNameStatus(status),from,to,probe);
}
