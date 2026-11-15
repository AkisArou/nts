// The audit builds its declared project in private storage. Project discovery
// and staging use the same reader owner as the gate's other consumers.
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import type {ProjectConfig} from '../gate/reader-inputs/main.ts';

type WorkspaceProject={root:string;project:string};

/** Keep the private tree alive through the consumer, including an async one. */
export async function withWorkspaceProject<T>(project:ProjectConfig,sourceRoot:string,operation:(workspace:WorkspaceProject)=>T|Promise<T>):Promise<T>{
  const cache=join(homedir(),'.cache'),requested=process.env.TMPDIR?resolve(process.env.TMPDIR):undefined;
  const within=requested===undefined?undefined:relative(cache,requested);
  const parent=requested&&within&&!isAbsolute(within)&&within!=='..'&&!within.startsWith('../')
    ?requested:join(homedir(),'.cache/nts-config-audit');
  mkdirSync(parent,{recursive:true});
  const temporary=mkdtempSync(join(parent,'workspace-')),root=join(temporary,'source');
  let result:T|undefined,failed=false,primary:unknown;
  try{
    const source=realpathSync(sourceRoot);
    copyModuleClosure([project],root,{sourceRoot:source});
    result=await operation({root,project:join(root,relative(source,fileURLToPath(project.url)))});
  }catch(error){failed=true;primary=error;}
  try{rmSync(temporary,{recursive:true,force:true});}
  catch(error){
    if(failed)throw new AggregateError([primary,error],'config workspace and cleanup failed',{cause:primary});
    throw error;
  }
  if(failed)throw primary;
  return result!;
}
