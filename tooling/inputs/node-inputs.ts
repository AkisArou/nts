// Offline consumers select one verified immutable pair. Only explicit acquire
// copies a supplied, authenticated release; a lookup never uses shared clones.
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,copyFileSync,cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,realpathSync,renameSync,rmSync,rmdirSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {nodePin,verifySource} from '../bootstrap/node.ts';

export type Identity={commit:string;tree:string;archive:string;sourceRecord:string};
export type Records={version:1;releases:Record<string,Identity>};
type Entry={sha256:string;execute:number}|{link:string};
type Inventory=Record<string,Entry>;
type Manifest={version:1;release:string;identity:Identity;node:Inventory;source:Inventory};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const git=(root:string,...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32<<20}).trim();
export const inputCache=()=>process.env.NTS_NODE_INPUTS_CACHE??join(homedir(),'.cache/nts-node-inputs');
export function records():Records{return JSON.parse(readFileSync(new URL('./node-inputs.json',import.meta.url),'utf8'));}
function expected(release:string,table:Records):Identity{
  const row=table.releases[release];
  if(table.version!==1||!row)throw Error('node inputs: no recorded source identities for Node '+release);
  for(const name of ['commit','tree','archive','sourceRecord'] as const)
    if(!new RegExp('^[a-f0-9]{'+(name==='commit'||name==='tree'?40:64)+'}$').test(row[name]))throw Error('node inputs: invalid '+name+' identity for Node '+release);
  return {commit:row.commit,tree:row.tree,archive:row.archive,sourceRecord:row.sourceRecord};
}
export function pairPath(release:string,identity:Identity,cache=inputCache()):string{
  return join(cache,release,sha(JSON.stringify(identity)));
}
export function inventory(root:string,files?:string[]):Inventory{
  const entries:Inventory={};
  function entry(path:string){
    const key=relative(root,path),stat=lstatSync(path);
    if(stat.isDirectory())walk(path);
    else if(stat.isFile())entries[key]={sha256:sha(readFileSync(path)),execute:stat.mode&0o111};
    else if(stat.isSymbolicLink()){
      const link=readlinkSync(path),target=relative(root,resolve(dirname(path),link));
      if(isAbsolute(link)||target==='..'||target.startsWith('../'))throw Error('node inputs: escaping source link '+path);
      entries[key]={link};
    }else throw Error('node inputs: unsupported source entry '+path);
  }
  function walk(dir:string){
    for(const name of readdirSync(dir).sort()){
      if(dir===root&&name==='.git')continue;
      entry(join(dir,name));
    }
  }
  if(files)for(const file of files.sort())entry(join(root,file));else walk(root);
  return entries;
}
/** Sparse checked-out upstream files plus the owned CommonJS boundary. */
export function corpusInventory(root:string):Inventory{
  const files=git(root,'ls-files','-z').split('\0').filter(file=>{
    if(!file)return false;
    if(isAbsolute(file)||file.split('/').includes('..'))throw Error('node inputs: invalid corpus path '+file);
    try{const stat=lstatSync(join(root,file));if(stat.isDirectory())throw Error('node inputs: unmaterialized corpus submodule '+file);return true;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  });
  return inventory(root,[...new Set([...files,'package.json'])]);
}
function identityOf(node:string,source:string,release:string,identity:Identity){
  if(git(node,'rev-parse','HEAD')!==identity.commit||git(node,'rev-parse','HEAD^{tree}')!==identity.tree)
    throw Error('node inputs: corpus source identity differs from Node '+release);
  const stamp=readFileSync(join(source,'NTS-SOURCE.json'));
  if(sha(stamp)!==identity.sourceRecord||JSON.parse(stamp.toString()).archive_sha256!==identity.archive)
    throw Error('node inputs: source archive identity differs from Node '+release);
  verifySource(source,release);
}
function verifyRecipe(tree:string,source:string,release:string){
  const recipe=JSON.parse(readFileSync(join(tree,'build/node-deps/recipes.json'),'utf8'));
  if(recipe.node!==release)throw Error('node inputs: recipe Node '+recipe.node+' differs from tree pin '+release);
  const sourceRecord=JSON.parse(readFileSync(join(source,'NTS-SOURCE.json'),'utf8'));
  if(recipe.source_sha256!==sourceRecord.archive_sha256)throw Error('node inputs: recipe archive identity differs from Node '+release);
  for(const [name,hash] of Object.entries(recipe.files)){
    if(isAbsolute(name)||name.split('/').includes('..')||sha(readFileSync(join(source,name)))!==hash)
      throw Error('node inputs: recipe source hash differs for '+name+' in Node '+release);
  }
}
function validate(directory:string,release:string,identity:Identity):Manifest{
  const file=join(directory,'pair.json');
  if(!existsSync(file))throw Error('node inputs: missing immutable pair for Node '+release+' at '+directory+'; acquire that exact release first');
  const saved:Manifest=JSON.parse(readFileSync(file,'utf8'));
  if(saved.version!==1||saved.release!==release||!isDeepStrictEqual(saved.identity,identity))
    throw Error('node inputs: mismatched immutable pair for Node '+release+' at '+directory);
  for(const name of ['node','node-source'])if(!lstatSync(join(directory,name)).isDirectory()||lstatSync(join(directory,name)).isSymbolicLink())
    throw Error('node inputs: immutable '+name+' root is not a snapshot directory for Node '+release);
  identityOf(join(directory,'node'),join(directory,'node-source'),release,identity);
  for(const [name,key] of [['node','node'],['node-source','source']] as const)
    if(!isDeepStrictEqual(inventory(join(directory,name)),saved[key]))throw Error('node inputs: immutable '+name+' bytes changed for Node '+release);
  return saved;
}
function protect(path:string){
  const stat=lstatSync(path);if(stat.isSymbolicLink())return;
  if(stat.isDirectory()){for(const name of readdirSync(path))protect(join(path,name));chmodSync(path,0o555);}
  else chmodSync(path,0o444|(stat.mode&0o111));
}
function writable(path:string){
  const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isDirectory())return;
  chmodSync(path,0o755);for(const name of readdirSync(path))writable(join(path,name));
}
/** Explicit provisioning from existing release inputs; never run by lookup. */
export function acquire(tree:string,cache=inputCache(),table=records()):string{
  const release=nodePin(tree),identity=expected(release,table),destination=pairPath(release,identity,cache);
  if(existsSync(destination)){validate(destination,release,identity);verifyRecipe(tree,join(destination,'node-source'),release);return destination;}
  const node=realpathSync(join(tree,'third_party/node')),source=realpathSync(join(tree,'third_party/node-source'));
  identityOf(node,source,release,identity);verifyRecipe(tree,source,release);
  if(git(node,'diff','--name-only','HEAD'))throw Error('node inputs: modified upstream corpus for Node '+release);
  const extras=git(node,'ls-files','--others','--exclude-standard').split('\n').filter(Boolean);
  if(extras.some(path=>path!=='package.json'))throw Error('node inputs: untracked corpus input '+extras.join(', '));
  if(readFileSync(join(node,'package.json'),'utf8')!=='{ "type": "commonjs" }\n')throw Error('node inputs: corpus CommonJS boundary changed');
  mkdirSync(dirname(destination),{recursive:true});const stage=mkdtempSync(join(dirname(destination),'.pair-'));
  try{
    const selected=corpusInventory(node),snapshot=join(stage,'node');mkdirSync(snapshot);
    // Git metadata must not depend on an origin after its files are copied.
    if(!lstatSync(join(node,'.git')).isDirectory()||existsSync(join(node,'.git/objects/info/alternates')))
      throw Error('node inputs: acquisition needs standalone corpus git metadata');
    cpSync(realpathSync(join(node,'.git')),join(snapshot,'.git'),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
    for(const [name,entry] of Object.entries(selected)){
      const destinationFile=join(snapshot,name);mkdirSync(dirname(destinationFile),{recursive:true});
      if('link' in entry)symlinkSync(entry.link,destinationFile);else copyFileSync(join(node,name),destinationFile);
    }
    cpSync(source,join(stage,'node-source'),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
    if(git(join(stage,'node'),'diff','--name-only','HEAD'))throw Error('node inputs: corpus changed while acquiring Node '+release);
    const manifest:Manifest={version:1,release,identity,node:selected,source:inventory(source)};
    writeFileSync(join(stage,'pair.json'),JSON.stringify(manifest,null,2)+'\n');
    validate(stage,release,identity);protect(stage);
    try{renameSync(stage,destination);}catch(error){
      if(!existsSync(destination))throw error;validate(destination,release,identity);
    }
    return destination;
  }finally{if(existsSync(stage)){writable(stage);rmSync(stage,{recursive:true,force:true});}}
}
/** Tree pin selects both corpora. Missing/version/hash errors never fall back. */
export function link(tree:string,cache=inputCache(),table=records()):string{
  const release=nodePin(tree),identity=expected(release,table),directory=pairPath(release,identity,cache);
  validate(directory,release,identity);verifyRecipe(tree,join(directory,'node-source'),release);
  const parent=join(tree,'third_party');mkdirSync(parent,{recursive:true});
  const present=(path:string)=>{try{return lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
  // Preflight all destinations before replacing any old link. Private clones
  // belong to their owner; this selector only replaces links or empty slots.
  for(const name of ['node','node-source','node-inputs']){
    const path=join(parent,name),stat=present(path);
    if(stat&&!stat.isSymbolicLink()&&(!stat.isDirectory()||readdirSync(path).length))
      throw Error('node inputs: refusing to replace private input directory '+path+'; move it aside explicitly');
  }
  for(const name of ['node','node-source']){
    const path=join(parent,name),stat=present(path);
    if(stat&&!stat.isSymbolicLink())rmdirSync(path);
    const temporary=path+'.'+randomUUID();
    try{symlinkSync(join('node-inputs',name),temporary,'dir');renameSync(temporary,path);}
    finally{if(present(temporary))unlinkSync(temporary);}
  }
  const pointer=join(parent,'node-inputs'),stat=present(pointer);
  if(stat&&!stat.isSymbolicLink())rmdirSync(pointer);
  const temporary=pointer+'.'+randomUUID();
  try{symlinkSync(directory,temporary,'dir');renameSync(temporary,pointer);}
  finally{if(present(temporary))unlinkSync(temporary);}
  return directory;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [mode,tree,...extra]=process.argv.slice(2);
    if(!tree||extra.length||!['--acquire','--link'].includes(mode??''))throw Error('usage: node-inputs.ts --acquire|--link <tree>');
    console.log(mode==='--acquire'?acquire(resolve(tree)):link(resolve(tree)));
  }catch(error){console.error(String(error));process.exitCode=1;}
}
