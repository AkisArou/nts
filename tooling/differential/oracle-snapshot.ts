// Cleanup of caller-owned immutable snapshots, after their execution drains.
import {chmodSync,lstatSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
export function removeOracleSnapshot(dir:string):void{
  let root;try{root=lstatSync(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(root.isDirectory()){
    const writable=(path:string)=>{chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink())writable(join(path,item.name));};
    writable(dir);
  }
  rmSync(dir,{recursive:true,force:true});
}
