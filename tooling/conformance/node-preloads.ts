// Runtime and preparation share these decisions. Planning never imports a port
// or runs a shim: it captures the finite roots that run-one will actually load.
import {createHash} from 'node:crypto';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {nodeHarnessPaths} from './node-paths.ts';
import {nodeModuleFiles,nodeGlobalGroups,nodeGlobalEntry,nodeSiblingModules} from './node-preload-runtime.ts';
export {nodeModuleFiles,nodeGlobalGroups,nodeGlobalEntry,nodeSiblingModules} from './node-preload-runtime.ts';

// Declare the launched entries even when a fixture routes them through its own
// repository root. The same declarations supply parsed fixture closures.
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const DRIVER=new URL('./run-one.mjs',import.meta.url),WORKER=new URL('./run-cjs-worker.mjs',import.meta.url);
const inRoot=(root:string,asset:URL)=>join(root,relative(SOURCE_ROOT,fileURLToPath(asset)));

export function nodePreloadPlan(root:string,name:string,compiled:boolean,addon?:string){
  const host=new OracleFilesystem(),subject=nodeModuleFiles(root,name),siblings=nodeSiblingModules(root,subject.dir,host),globals=nodeGlobalGroups(subject.dir,host);
  const files:Record<string,string>={},absent:string[]=[],edges:{from:string;to:string;kind:string}[]=[];
  const preloads:{entry:string;project:string|null}[]=[];
  const observe=(file:string)=>{if(host.fileExists(file)){const bytes=host.readBytes(file)!;files[file]=createHash('sha256').update(bytes).digest('hex');}else absent.push(file);};
  const typed=(entry:string,from:string,kind:string)=>{
    if(!host.fileExists(entry))throw Error('node declared TypeScript root is missing: '+entry);
    entry=host.realpath(entry);
    edges.push({from,to:entry,kind});
    if(!preloads.some(item=>item.entry===entry))preloads.push({entry,project:host.projectFor(entry)});
  };
  const visited=new Set<string>();
  function javascript(file:string){
    file=host.realpath(file);if(visited.has(file))return;visited.add(file);observe(file);
    const ast=parse(host.readFile(file)!,{ecmaVersion:'latest',sourceType:'module'});
    function visit(node:any):void{
      if(!node||typeof node!=='object')return;
      if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)){
        const specifier=node.source?.value;
        if(typeof specifier==='string'&&specifier.startsWith('.')){
          const target=resolve(dirname(file),specifier);edges.push({from:file,to:target,kind:'static import'});
          if(/\.[cm]?tsx?$/.test(target))typed(target,file,'static TypeScript import');
          else if(/\.[cm]?js$/.test(target))javascript(target);
        }
      }
      for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    }
    visit(ast);
  }

  const drivers:{commonjsWorker?:{source:string;sha256:string}}={};
  const workerDriver=inRoot(root,WORKER);
  observe(workerDriver);
  if(host.fileExists(workerDriver)){
    javascript(workerDriver);const source=host.realpath(workerDriver);
    drivers.commonjsWorker={source,sha256:files[source]!};
  }
  observe(fileURLToPath(import.meta.url));
  javascript(inRoot(root,DRIVER));
  observe(join(subject.dir,'uses'));observe(join(subject.dir,'globals'));
  observe(subject.childFixtures);
  if(!compiled){if(host.fileExists(subject.bindings))javascript(subject.bindings);else observe(subject.bindings);typed(subject.entry,subject.dir,'subject');}
  if(host.fileExists(subject.shape))javascript(subject.shape);else observe(subject.shape);
  for(const global of globals??[])typed(nodeGlobalEntry(subject.dir,global),join(subject.dir,'globals'),'global '+global);
  for(const sibling of siblings){
    if(host.fileExists(sibling.bindings))javascript(sibling.bindings);else observe(sibling.bindings);
    typed(sibling.entry,join(subject.dir,'uses'),'sibling '+sibling.requestedName);
    if(host.fileExists(sibling.shape))javascript(sibling.shape);else observe(sibling.shape);
  }
  // Preload project configs and their resolved options are captured by emit.
  const paths=nodeHarnessPaths(root,name),usesHarnessPaths=preloads.some(item=>item.entry===join(root,'tooling/conformance/node-paths.ts'));
  const runtimeRoots=[...(usesHarnessPaths?[paths.nodeTestRoot]:[]),subject.dir,...siblings.map(sibling=>sibling.dir),...visited,...(addon?[addon]:[])];
  const descriptor={version:1,drivers,module:name,compiled,subject,siblings,globals,preloads,edges,paths,runtimeRoots};
  return {entry:inRoot(root,DRIVER),preloads,runtimeRoots,declarations:{descriptor,files,absent:[...new Set(absent)],observations:host.captured()}};
}
