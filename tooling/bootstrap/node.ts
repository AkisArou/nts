// Prepare Node's unedited dependency sources. Recipe resolution is bootstrap-only.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT=resolve(import.meta.dirname,'../..');
export const DEPENDENCIES=['openssl','brotli','zlib','zstd','uv'] as const;
export const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function nodePin(root=ROOT):string {
 const entries=readFileSync(join(root,'.tool-versions'),'utf8').split('\n').filter(line=>/^nodejs\s/.test(line));
 const pin=entries.length===1?/^nodejs\s+(\d+\.\d+\.\d+)\s*$/.exec(entries[0])?.[1]:undefined;
 if(!pin)throw Error('.tool-versions must name exactly one Node release');
 return pin;
}
export function publishedHash(text:string,filename:string):string {
 const rows=text.split('\n').map(line=>/^([a-f0-9]{64})  (\S+)$/.exec(line)).filter(row=>row?.[2]===filename);
 if(rows.length!==1)throw Error('published SHASUMS256 has no unique '+filename);
 return rows[0]![1];
}
export function inputFiles(source:string):Record<string,string> {
 const result:Record<string,string>={};
 function walk(relative:string){
  const path=join(source,relative),st=lstatSync(path);
  if(st.isDirectory())for(const name of readdirSync(path).sort())walk(relative+'/'+name);
  else result[relative]=digest(readFileSync(path));
 }
 for(const name of DEPENDENCIES)walk('deps/'+name);
 return result;
}
export function verifySource(source:string,version:string):void {
 const record=JSON.parse(readFileSync(join(source,'NTS-SOURCE.json'),'utf8'));
 if(record.version!==version||!/^[a-f0-9]{64}$/.test(record.archive_sha256))throw Error('prepared Node source version/hash does not match '+version);
 if(JSON.stringify(inputFiles(source))!==JSON.stringify(record.files))throw Error('prepared Node dependency sources changed or are incomplete');
 const versionHeader=readFileSync(join(source,'src/node_version.h'),'utf8');
 const actual=['MAJOR','MINOR','PATCH'].map(part=>new RegExp('^#define NODE_'+part+'_VERSION (\\d+)$','m').exec(versionHeader)?.[1]).join('.');
 if(actual!==version)throw Error('Node source header differs from pin');
}
async function download(url:string):Promise<Buffer>{
 const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw Error(url+': HTTP '+response.status);
 return Buffer.from(await response.arrayBuffer());
}
export async function prepare(destination=join(ROOT,'third_party/node-source'),root=ROOT,releaseBase='https://nodejs.org/download/release'):Promise<void>{
 const version=nodePin(root);
 if(existsSync(destination)){verifySource(destination,version);return;}
 mkdirSync(dirname(destination),{recursive:true});
 const stage=mkdtempSync(join(dirname(destination),'.node-source-'));
 try{
  const filename='node-v'+version+'.tar.xz',base=releaseBase+'/v'+version+'/';
  const sums=await download(base+'SHASUMS256.txt'),expected=publishedHash(sums.toString(),filename),bytes=await download(base+filename);
  if(digest(bytes)!==expected)throw Error('Node source archive checksum mismatch');
  const archive=join(stage,filename);writeFileSync(archive,bytes);
  const members=execFileSync('tar',['-tf',archive],{encoding:'utf8',maxBuffer:32<<20}).trim().split('\n');
  if(members.some(name=>!name.startsWith('node-v'+version+'/')||name.split('/').includes('..')))throw Error('unexpected archive member');
  execFileSync('tar',['-xf',archive,'-C',stage]);
  const source=join(stage,'node-v'+version);
  writeFileSync(join(source,'NTS-SOURCE.json'),JSON.stringify({version,archive_sha256:expected,archive_url:base+filename,files:inputFiles(source)},null,2)+'\n');
  writeFileSync(join(source,'NTS-SHASUMS256.txt'),sums);
  verifySource(source,version);renameSync(source,destination);
 }finally{rmSync(stage,{recursive:true,force:true});}
}

export function resolveRecipe(source:string,output=join(ROOT,'build/node-deps/recipes.json'),check=false):void {
 verifySource(source,nodePin());
 mkdirSync(dirname(output),{recursive:true});
 const stage=mkdtempSync(join(dirname(output),'.node-recipe-'));
 try {
  const generated=join(stage,'recipes.json');
  execFileSync('python3',['-B',join(ROOT,'tooling/bootstrap/node_recipe.py'),resolve(source),generated],{stdio:['ignore','pipe','pipe']});
  const bytes=readFileSync(generated);
  if(check){if(!bytes.equals(readFileSync(output)))throw Error('committed Node recipe differs from fresh GYP evaluation; run bootstrap with --resolve-recipe');}
  else writeFileSync(output,bytes);
 }finally{rmSync(stage,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),paths=args.filter(s=>!s.startsWith('--'));
  if(paths.length>1||args.some(s=>s.startsWith('--')&&!['--resolve-recipe','--check-recipe'].includes(s)))throw Error('usage: node.ts [destination] [--resolve-recipe|--check-recipe]');
  const source=paths[0]?resolve(paths[0]):join(ROOT,'third_party/node-source');
  await prepare(source);
  if(args.includes('--resolve-recipe')||args.includes('--check-recipe'))resolveRecipe(source,undefined,args.includes('--check-recipe'));
  console.log('Node dependency source prepared: '+nodePin());
 }
 catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
}
