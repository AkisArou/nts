// Erased by the producer into the pinned --import data URL. Keeping
// this owner synchronous to import also keeps Worker module graphs synchronous.
import {isMainThread,workerData} from 'node:worker_threads';
import {registerHooks} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,constants} from 'node:fs';
import {hash} from 'node:crypto';

export async function startOracleChild(){
  const context=!isMainThread&&workerData?.role==='nts-commonjs-worker'?workerData.oracle:process.env;
  const manifest=context.NTS_ORACLE_EMIT_MANIFEST,snapshotText=context.NTS_ORACLE_SNAPSHOT;
  if(typeof manifest!=='string'||typeof snapshotText!=='string')throw Error('oracle snapshot runtime identity is missing');
  const root=pathToFileURL(manifest),snapshot=JSON.parse(snapshotText);
  const directory=new URL('./assets/',root),assets=snapshot.assets;
  if(!lstatSync(directory).isDirectory()||realpathSync(directory)!==fileURLToPath(directory).replace(/\/$/,'')||!assets||Array.isArray(assets)||Object.keys(assets).length>128||
    !['loader','runtime','assets'].every(name=>Object.hasOwn(assets,'assets/oracle-'+name+'.mjs')))throw Error('oracle generated bootstrap directory changed');
  const files=new Map<string,{name:string;sha256:string}>();
  for(const [name,expected] of Object.entries(assets)){
    const parts=name.split('/');
    if(parts.shift()!=='assets'||!name.endsWith('.mjs')||!parts.length||parts.some(part=>!part||part==='.'||part==='..'||!/^[A-Za-z0-9_.-]+$/.test(part))||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('oracle generated bootstrap record is invalid');
    files.set(new URL('./'+name,root).href,{name,sha256:expected});
  }
  const io={open:openSync,close:closeSync,stat:fstatSync,read:readFileSync,real:realpathSync},digest=hash;
  const checked=(url:string)=>{
    const asset=files.get(url),label=asset?.name??url;
    if(!asset||io.real(new URL(url))!==fileURLToPath(url))throw Error('oracle generated bootstrap asset changed: '+label);
    const fd=io.open(new URL(url),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      if(!io.stat(fd).isFile())throw Error('oracle generated bootstrap asset changed: '+label);
      const bytes=io.read(fd);
      if(digest('sha256',bytes,'hex')!==asset.sha256)throw Error('oracle generated bootstrap asset changed: '+label);
      return bytes;
    }finally{io.close(fd);}
  };
  // Validate the whole authenticated graph before any module body can run.
  for(const url of files.keys())checked(url);
  registerHooks({load(url,context,next){
    if(!url.startsWith(directory.href))return next(url,context);
    return {format:'module',source:checked(url),shortCircuit:true};
  }});
  await import(new URL('./assets/oracle-loader.mjs',root).href);
}
