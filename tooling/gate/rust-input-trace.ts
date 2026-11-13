// Kernel observations for Rust test input declarations. The tracer owns no
// policy: failed lookups, directory membership and build/setup reads remain
// distinguishable from successful runtime opens in its detached output.
import {createInterface} from 'node:readline';
import {createReadStream} from 'node:fs';
import {basename,isAbsolute,resolve} from 'node:path';

export type FileObservation={pid:number;image:number;operation:'open'|'lookup'|'directory'|'execute'|'write';path:string;success:boolean;syscall:string};
export type TraceEvent={pid:number;syscall:string;args:string[];result:string;order:number};
export type DescriptorProbe={pid:number;image:number;syscall:string;kind:'invalid-argument'|'non-file-descriptor';argument:string;result:string};
export type TraceResult={observations:FileObservation[];descriptorProbes:DescriptorProbe[];executions:{id:number;parent:number;pid:number;path:string;cwd:string;args:string[];order:number}[]};

/** One tracer follows every descendant. Decoded fd paths supply the actual
 * dirfd/cwd at the syscall, including failed openat probes. No environment or
 * file contents are requested from strace. */
export function inputTraceArguments(output:string,command:string,args:readonly string[]):string[]{
  if(!isAbsolute(output))throw Error('Rust input trace needs an absolute output path');
  return ['-f','-qq','--always-show-pid','--decode-fds=path','--string-limit=65536',
    '--abbrev=all','--verbose=all',
    '--signal=none','--trace=open,openat,openat2,access,faccessat,faccessat2,stat,lstat,newfstatat,statx,readlink,readlinkat,getdents64,getcwd,chdir,fchdir,clone,clone3,fork,vfork,execve,execveat',
    '--output='+output,'--',command,...args];
}

function problem(message:string):never{throw Error('Rust input trace: '+message);}
export function traceString(value:string):string{
  if(!/^"(?:[^"\\]|\\.)*"$/.test(value))problem('incomplete path string '+value.slice(0,160));
  if(!value.includes('\\'))return value.slice(1,-1);
  const chunks:Buffer[]=[];
  for(let at=1;at<value.length-1;){
    const char=String.fromCodePoint(value.codePointAt(at)!);at+=char.length;
    if(char!=='\\'){chunks.push(Buffer.from(char));continue;}
    const escaped=value[at++]!,octal=/^[0-7]{1,3}/.exec(value.slice(at-1))?.[0];
    if(octal){chunks.push(Buffer.from([Number.parseInt(octal,8)]));at+=octal.length-1;continue;}
    if(escaped==='x'){
      const hex=value.slice(at,at+2);if(!/^[0-9a-fA-F]{2}$/.test(hex))problem('invalid hex path escape');
      chunks.push(Buffer.from([Number.parseInt(hex,16)]));at+=2;continue;
    }
    const simple:Record<string,string>={'\\':'\\','"':'"',n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v',a:'\x07'};
    if(simple[escaped]===undefined)problem('invalid path escape '+escaped);
    chunks.push(Buffer.from(simple[escaped]));
  }
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{problem('path is not UTF-8');}
}
/** Split syscall arguments without interpreting quoted paths or nested ABI
 * structures as separators. The same parser handles exec argv arrays. */
export function traceArguments(value:string):string[]{
  const args:string[]=[],stack:string[]=[];let start=0,quoted=false,escaped=false,fd=false;
  for(let at=0;at<value.length;at++){
    const char=value[at]!;
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(fd){if(char==='>')fd=false;continue;}
    if(char==='<'&&/\d$|AT_FDCWD$/.test(value.slice(start,at).trim())){fd=true;continue;}
    if('([{'.includes(char))stack.push(char);
    else if(')]}'.includes(char)){if(stack.pop()!==({')':'(',']':'[','}':'{'} as Record<string,string>)[char])problem('unbalanced syscall arguments');}
    else if(char===','&&!stack.length){args.push(value.slice(start,at).trim());start=at+1;}
  }
  if(quoted||stack.length||fd)problem('unfinished syscall arguments');
  const last=value.slice(start).trim();if(last)args.push(last);return args;
}

export class InputTraceParser{
  private order=0;
  private next=0;
  private readonly pending=new Map<number,{syscall:string;prefix:string;order:number}>();
  private readonly ready=new Map<number,TraceEvent>();
  private readonly cwd=new Map<number,{path:string}>();
  private readonly images=new Map<number,number>();
  private readonly observations=new Map<string,FileObservation>();
  private readonly descriptorProbes=new Map<string,DescriptorProbe>();
  private readonly executions:TraceResult['executions']=[];
  private readonly initialCwd:string;
  constructor(initialCwd:string){this.initialCwd=initialCwd;}
  line(line:string):void{
    if(!line.trim())return;
    const row=/^(\d+)\s+(.*)$/.exec(line);if(!row)problem('unrecognized trace row '+line.slice(0,160));
    const pid=Number(row[1]),body=row[2]!;
    if(body.startsWith('+++')||body.startsWith('---'))return;
    const resumed=/^<\.\.\. (\w+) resumed>(.*)$/.exec(body);
    let call=body,order:number;
    if(resumed){
      const held=this.pending.get(pid);if(!held||held.syscall!==resumed[1])problem('unmatched resumed syscall for '+pid);
      this.pending.delete(pid);call=held.prefix+resumed[2];order=held.order;
    }else if(body.endsWith('<unfinished ...>')){
      order=this.order++;
      const name=/^(\w+)\(/.exec(body)?.[1];if(!name||this.pending.has(pid))problem('overlapping unfinished syscall for '+pid);
      this.pending.set(pid,{syscall:name,prefix:body.slice(0,-'<unfinished ...>'.length),order});return;
    }else order=this.order++;
    const event=/^(\w+)\((.*)\)\s+=\s+(.*)$/.exec(call);
    if(!event)problem('unrecognized syscall '+call.slice(0,160));
    this.ready.set(order,{pid,syscall:event[1]!,args:traceArguments(event[2]!),result:event[3]!,order});
    // A blocked syscall must not make the observer retain an unbounded log.
    // Start-order preserves clone/chdir ownership across resumed trace lines.
    if(this.ready.size>4096)problem('more than 4096 syscalls await an unfinished predecessor');
    while(this.ready.has(this.next)){const value=this.ready.get(this.next)!;this.ready.delete(this.next++);this.consume(value);}
  }
  private consume(event:TraceEvent):void{
    const {cwd,observations,executions}=this;
    const record=(row:Omit<FileObservation,'image'>)=>{
      const image=this.images.get(row.pid)??0;
      observations.set(JSON.stringify([image,row.operation,row.path,row.success]),{...row,image});
    };
    const state=(pid:number)=>{let value=cwd.get(pid);if(!value){value={path:this.initialCwd};cwd.set(pid,value);}return value;};
    const decoded=(value:string|undefined):string|undefined=>{
      if(!value)return undefined;
      const match=/^(?:AT_FDCWD|-?\d+)<(.*)>$/.exec(value);return match?.[1];
    };
      const {pid,syscall,args,result,order}=event,success=!/^-1\b|^\?/.test(result),current=state(pid);
      const descriptor=(kind:DescriptorProbe['kind'])=>{
        const row:DescriptorProbe={pid,image:this.images.get(pid)??0,syscall,kind,argument:args.slice(0,2).join(', '),result};
        this.descriptorProbes.set(JSON.stringify(row),row);
      };
      if(['clone','clone3','fork','vfork'].includes(syscall)){
        const child=/^(\d+)\b/.exec(result);if(child){const id=Number(child[1]);cwd.set(id,args.join(',').includes('CLONE_FS')?current:{path:current.path});this.images.set(id,this.images.get(pid)??0);}
        return;
      }
      const pathAt=(index:number,dirfd?:number)=>{
        const token=args[index];if(token===undefined)problem('missing '+syscall+' path');
        if(token==='NULL')problem(syscall+' has NULL path: '+args.join(', ')+' = '+result);
        const path=traceString(token);
        return isAbsolute(path)?resolve(path):resolve(dirfd===undefined?current.path:decoded(args[dirfd])??(args[dirfd]==='AT_FDCWD'?current.path:problem('undecoded dirfd '+args[dirfd])),path);
      };
      if(syscall==='getcwd'){if(success)current.path=traceString(args[0]!);return;}
      if(syscall==='chdir'){if(success)current.path=pathAt(0);return;}
      if(syscall==='fchdir'){if(success)current.path=decoded(args[0])??problem('undecoded fchdir');return;}
      if(syscall==='getdents64'){
        const path=decoded(args[0]);
        if(!path||!isAbsolute(path)){
          if(!success&&/\bEBADF\b|\bENOTDIR\b/.test(result)){descriptor('non-file-descriptor');return;}
          problem('undecoded directory enumeration');
        }
        record({pid,syscall,path,success,operation:'directory'});return;
      }
      const at=['openat','openat2','execveat','newfstatat','fstatat64','statx','faccessat','faccessat2','readlinkat'].includes(syscall),token=args[at?1:0];
      // Capability probes may deliberately supply a null pathname/output.
      // EFAULT with a null pathname cannot depend on any repository file.
      if(token==='NULL'&&!success&&/\bEFAULT\b/.test(result)){descriptor('invalid-argument');return;}
      let path:string,operation:FileObservation['operation'];
      if(syscall==='execve'||syscall==='execveat'){
        const index=syscall==='execve'?0:1;path=pathAt(index,index?0:undefined);operation='execute';
        if(success){
          let commandArgs:string[]=[];
          if(basename(path)==='rustdoc'){
            const vector=args[index+1];if(!vector?.startsWith('[')||!vector.endsWith(']'))problem('incomplete rustdoc argv');
            commandArgs=traceArguments(vector.slice(1,-1)).map(traceString);
          }
          const id=executions.length+1,parent=this.images.get(pid)??0;
          executions.push({id,parent,pid,path,cwd:current.path,args:commandArgs,order});this.images.set(pid,id);
        }
      }else if(syscall==='open'||syscall==='openat'||syscall==='openat2'||syscall==='creat'){
        const at=syscall.startsWith('openat');path=pathAt(at?1:0,at?0:undefined);
        operation=syscall==='creat'||/\bO_WRONLY\b/.test(args.slice(at?2:1).join(','))?'write':'open';
      }else if(['access','stat','lstat','stat64','lstat64','readlink'].includes(syscall)){path=pathAt(0);operation='lookup';}
      else if(['newfstatat','fstatat64','statx','faccessat','faccessat2','readlinkat'].includes(syscall)){
        if(args[1]==='""'||args[1]==='NULL'){
          const file=decoded(args[0]);
          if(!file||!isAbsolute(file)){descriptor('non-file-descriptor');return;}
          path=file;
        }else path=pathAt(1,0);operation='lookup';
      }else problem('unrecognized traced file syscall '+syscall);
      record({pid,syscall,path,success,operation});
  }
  finish():TraceResult{
    if(this.pending.size||this.ready.size)problem('trace ended with unfinished syscalls: '+[...this.pending.keys()].join(', '));
    return {observations:[...this.observations.values()],descriptorProbes:[...this.descriptorProbes.values()],executions:this.executions};
  }
}

/** Read incrementally; a syscall-heavy test need not duplicate its whole raw
 * trace as a giant JavaScript string. */
export async function readInputTrace(file:string,cwd:string):Promise<TraceResult>{
  const parser=new InputTraceParser(cwd),lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});
  for await(const line of lines)parser.line(line);
  return parser.finish();
}
