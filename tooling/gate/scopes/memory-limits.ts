// Kernel memory limits shared by scope owners, without importing launchers.
import {readFileSync} from 'node:fs';

/** The kernel's rounded limits; Infinity denotes an uncapped boundary. */
export function readLimits(group:string):{max:number;high:number;swap:number}{
  const read=(name:string)=>{
    const value=readFileSync(`/sys/fs/cgroup${group}/${name}`,'utf8').trim();
    return value==='max'?Infinity:Number(value);
  };
  return {max:read('memory.max'),high:read('memory.high'),swap:read('memory.swap.max')};
}
