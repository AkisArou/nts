// Observation only. Node keeps ownership of every filesystem operation and
// its arguments, return value, error and ordering.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export function observeOracleAssets(options:{trees:{tree:string;paths?:string[];absent?:string[];identity:(path:string)=>string|null;contains?:(path:string)=>boolean}[];instrument:(reason:string)=>void}):void{
  const trees=options.trees.map(item=>({tree:resolve(item.tree),identity:item.identity,contains:item.contains,captured:new Set([resolve(item.tree),...(item.paths??[]).map(path=>resolve(item.tree,path)),...(item.absent??[]).map(path=>resolve(item.tree,path))])}));
  const observe=(value:unknown)=>{
    // Do not coerce application objects before Node does, or change an invalid
    // argument's error. URLs and UTF-8 Buffers are Node's ordinary path types.
    let path:string;
    if(typeof value==='string')path=value;
    else if(Buffer.isBuffer(value)){
      path=value.toString('utf8');if(!Buffer.from(path).equals(value))return;
    }else if(value instanceof URL){
      if(value.protocol!=='file:')return;
      try{path=fileURLToPath(value);}catch{return;}
    }else return;
    const absolute=isAbsolute(path)?resolve(path):resolve(process.cwd(),path);
    const owner=trees.find(item=>absolute===item.tree||absolute.startsWith(item.tree+sep));if(!owner)return;
    if(absolute.split(sep).includes('node_modules'))return;
    const canonical=owner.identity(absolute);
    const known=(path:string)=>owner.contains?owner.contains(path):owner.captured.has(path);
    if(!known(absolute)&&(canonical===null||!known(canonical)))options.instrument('oracle runtime asset was not captured: '+absolute);
  };
  const wrappers=new WeakMap<Function,Function>();
  const callable=(original:Function,read:(args:unknown[])=>boolean):Function=>{
    const previous=wrappers.get(original);if(previous)return previous;
    const wrapped=function(this:unknown,...args:unknown[]){
      if(read(args))observe(args[0]);
      return Reflect.apply(original,this,args);
    };
    wrappers.set(original,wrapped);
    for(const key of Reflect.ownKeys(original)){
      const descriptor=Object.getOwnPropertyDescriptor(original,key)!;
      // Node exposes these as independent callable filesystem entries. Their
      // arguments/results stay owned by Node, including exists' custom promise.
      if((key==='native'||key===promisify.custom)&&typeof descriptor.value==='function')descriptor.value=callable(descriptor.value,read);
      Object.defineProperty(wrapped,key,descriptor);
    }
    return wrapped;
  };
  const wrap=(object:Record<string,any>,key:string,read=(_args:unknown[])=>true)=>{
    const original=object[key];if(typeof original!=='function')return;
    const wrapped=callable(original,read);
    Object.defineProperty(object,key,{...Object.getOwnPropertyDescriptor(object,key),value:wrapped});
  };
  const probes=['readFile','readlink','realpath','opendir','readdir','stat','lstat','statfs','access','exists'];
  for(const name of probes){wrap(fs,name);wrap(fs,name+'Sync');wrap(promises,name);}
  wrap(fs,'createReadStream');
  const reads=(args:unknown[])=>{
    const flags=args[1];
    // Invalid flags retain Node's own diagnostic and conversion order.
    return flags===undefined||typeof flags==='string'&&(flags.startsWith('r')||flags.includes('+'))||
      typeof flags==='number'&&(flags&fs.constants.O_WRONLY)===0;
  };
  wrap(fs,'open',reads);wrap(fs,'openSync',reads);wrap(promises,'open',reads);
  // Both named ESM imports and require('fs') see the same public function.
  syncBuiltinESMExports();
}
