// Kernel memory limits shared by scope owners, without importing launchers.
import {readFileSync,statSync} from 'node:fs';

export type CgroupIdentity={dev:bigint;ino:bigint};
/** Exact kernel identity, detached from the filesystem's mutable object. */
export function readCgroupIdentity(group:string):CgroupIdentity{
  const value=statSync('/sys/fs/cgroup'+group,{bigint:true});return {dev:value.dev,ino:value.ino};
}

/** The kernel's rounded limits; Infinity denotes an uncapped boundary. */
export function readLimits(group:string):{max:number;high:number;swap:number}{
  const read=(name:string)=>{
    const value=readFileSync(`/sys/fs/cgroup${group}/${name}`,'utf8').trim();
    return value==='max'?Infinity:Number(value);
  };
  return {max:read('memory.max'),high:read('memory.high'),swap:read('memory.swap.max')};
}
