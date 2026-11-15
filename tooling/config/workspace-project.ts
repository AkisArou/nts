// The audit builds its declared project in private storage. Project discovery
// and staging use the same reader owner as the gate's other consumers.
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import type {ModuleMembers,ProjectConfig} from '../gate/reader-inputs/main.ts';

type WorkspaceProject={root:string;project:string};

/** Keep the private tree alive through the consumer, including an async one. */
export async function withWorkspaceProject<T>(project:ProjectConfig,namespace:ModuleMembers,sourceRoot:string,operation:(workspace:WorkspaceProject)=>T|Promise<T>):Promise<T>{
  const request=relative(fileURLToPath(namespace.url),fileURLToPath(project.url));
  if(namespace.data!==true||!request||request==='..'||request.startsWith('../')||isAbsolute(request))
    throw new Error('config project requires its declared workspace data namespace');
  const cache=join(homedir(),'.cache'),requested=process.env.TMPDIR?resolve(process.env.TMPDIR):undefined;
  const within=requested===undefined?undefined:relative(cache,requested);
  const parent=requested&&within&&!isAbsolute(within)&&within!=='..'&&!within.startsWith('../')
    ?requested:join(homedir(),'.cache/nts-config-audit');
  mkdirSync(parent,{recursive:true});
  const temporary=mkdtempSync(join(parent,'workspace-')),root=join(temporary,'source');
  let result:T|undefined,failed=false,primary:unknown;
  try{
    const source=realpathSync(sourceRoot);
    // The compiler will observe its new private namespace. Copy the audit's
    // declared current tracked bytes, including working edits, rather than
    // replaying source-Program directory answers into a different filesystem.
    copyModuleClosure([namespace],root,{sourceRoot:source});
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
