// One Linux flag recipe shared by raw subject derivation and interpretation.
import type {FileObserverReceipt} from './file-input-observer.ts';
type Request={syscall:string;operation:string;args:readonly string[]};
const recipes:Record<string,{operation:string;flags:number|null;mask:bigint;empty:boolean}>= {
  newfstatat:{operation:'lookup',flags:3,mask:0x1900n,empty:true},
  fstatat:{operation:'lookup',flags:3,mask:0x1900n,empty:true},
  statx:{operation:'lookup',flags:2,mask:0x7900n,empty:true},
  faccessat2:{operation:'lookup',flags:3,mask:0x1300n,empty:true},
  readlinkat:{operation:'lookup',flags:null,mask:0n,empty:false},
  linkat:{operation:'link',flags:4,mask:0x1400n,empty:true},
  execveat:{operation:'execute',flags:4,mask:0x1100n,empty:true},
};
export function inputAtFlags(row:Request):bigint|undefined{
  const recipe=recipes[row.syscall];if(!recipe||recipe.operation!==row.operation)return;
  if(recipe.flags===null)return 0n;
  const text=row.args[recipe.flags];if(text===undefined||!/^[0-9a-f]{1,16}$/.test(text))return;
  const value=BigInt('0x'+text);if((value&~recipe.mask)!==0n)return;
  if(row.syscall==='statx'&&(value&0x6000n)===0x6000n)return;
  if(row.syscall==='faccessat2'){
    const mode=row.args[2];if(mode===undefined||!/^[0-9a-f]{1,16}$/.test(mode)||(BigInt('0x'+mode)&~7n)!==0n)return;
  }
  return value;
}
/** Only the source path of linkat is descriptor-backed. A nonempty path is
 * never converted, and callers keep unknown/unsupported ABI cases literal. */
export function emptyPathDescriptorArgument(row:Request,observer:FileObserverReceipt|null):{pathArg:1;descriptorArg:0}|undefined{
  if(observer?.abi!=='linux-x86_64-v1')return;
  const recipe=recipes[row.syscall],flags=inputAtFlags(row);
  if(!recipe||flags===undefined||recipe.empty&&(flags&0x1000n)===0n)return;
  return {pathArg:1,descriptorArg:0};
}
