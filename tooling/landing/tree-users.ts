// One read-only process observation owner for pool reset and disk reclamation.
// A complete supplied proc tree replaces live sampling in decision controls.
import {readdirSync,readFileSync,readlinkSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';

export type TreeUser={pid:number;command:string;where:string};
type ObservedUser=TreeUser&{link:string;path:string};
export type TreeProcessOptions={proc?:string;self?:number;/** A fixture's explicitly owned kernel processes. */pids?:readonly number[]};
export type TreeProcessObservation={users:ObservedUser[];ignored:{pid:number;birth:string;command:string;group:string}[];unreadable:Error[]};
const PROC='/proc';
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const under=(root:string,path:string)=>path===root||path.startsWith(root+sep);
/** Read-only provenance; no signalling or membership authority. */
export function processCgroup(pid:number,proc=PROC):string{return readFileSync(join(proc,String(pid),'cgroup'),'utf8');}

export function observeTreeProcesses(roots:readonly string[],{proc=PROC,self,pids}:TreeProcessOptions={}):TreeProcessObservation{
  const uid=process.getuid?.(),normalized=roots.map(root=>resolve(root));
  const reading:TreeProcessObservation={users:[],ignored:[],unreadable:[]};
  const names=pids===undefined?readdirSync(proc).filter(name=>/^[1-9][0-9]*$/.test(name)):pids.map(String);
  for(const pid of names){
    if(Number(pid)===self)continue;
    const dir=join(proc,pid);let birth:string;
    try{
      // Non-dumpable processes may have root-owned proc inodes. status owns UID.
      const status=readFileSync(join(dir,'status'),'utf8'),owner=/^Uid:\s+(\d+)\s+\d+\s+\d+\s+\d+$/m.exec(status);
      if(!owner)throw Error('process has no UID observation');
      if(Number(owner[1])!==uid)continue;
      const fields=readFileSync(join(dir,'stat'),'utf8').split(') ').at(-1)!.split(' ');
      if(fields[0]==='Z'||fields[0]==='X')continue;
      birth=fields[19]!;
    }catch(error){if(missing(error))continue;reading.unreadable.push(Error('unreadable process ownership '+dir,{cause:error}));continue;}
    try{
      // Read cwd and exe before enumerating fds, so a known positive owner
      // remains visible even when another observation would refuse later.
      const inspect=(link:string):boolean=>{
        let path:string;
        try{path=readlinkSync(join(dir,link)).replace(/ \(deleted\)$/,'');}
        catch(error){if(missing(error))return false;throw error;}
        const root=normalized.find(root=>under(root,path));if(!root)return false;
        const command=readFileSync(join(dir,'comm'),'utf8').trim()||'?';
        const shown=relative(root,path)||'.';
        const where=link==='cwd'?'its working directory':link==='exe'?'its executable '+shown:'an open file '+shown;
        reading.users.push({pid:Number(pid),command,where,link,path});return true;
      };
      if(inspect('cwd')||inspect('exe'))continue;
      for(const fd of readdirSync(join(dir,'fd')))if(inspect('fd/'+fd))break;
    }catch(error){
      let current:string;
      try{const fields=readFileSync(join(dir,'stat'),'utf8').split(') ').at(-1)!.split(' ');if(fields[0]==='Z'||fields[0]==='X')continue;current=fields[19]!;}
      catch(again){if(missing(again))continue;reading.unreadable.push(Error('unreadable process ownership '+dir,{cause:error}));continue;}
      if(current!==birth)continue;
      try{
        const lines=processCgroup(Number(pid),proc).trim().split('\n'),group=lines.length===1&&/^0::(\/.*)$/.exec(lines[0]!)?.[1];
        if(!group||group.split('/').some(part=>part==='.'||part==='..'))throw Error('invalid unified cgroup identity');
        const denied=['EACCES','EPERM'].includes((error as NodeJS.ErrnoException).code??'');
        if(denied&&!group.split('/').some(part=>/^nts(?:[.-]|$)/.test(part))){
          const command=readFileSync(join(dir,'comm'),'utf8').trim();
          reading.ignored.push({pid:Number(pid),birth,command,group});continue;
        }
        throw Error('live unreadable tool process '+pid+'; cgroup '+group+': '+errorText(error));
      }catch(reason){reading.unreadable.push(Error('tree ownership keeps unreadable process '+pid+': '+errorText(reason),{cause:error}));}
    }
  }
  reading.users.sort((a,b)=>a.pid-b.pid);return reading;
}
function complete(reading:TreeProcessObservation):void{
  if(reading.unreadable.length)throw new AggregateError(reading.unreadable,'tree ownership keeps root: '+reading.unreadable.map(error=>error.message).join('; '));
}
/** Pool reset/release and reclamation consume this same observation and rule. */
export function treeUsers(tree:string,options:TreeProcessOptions={}):TreeUser[]{
  let root:string;try{root=realpathSync(tree);}catch(error){if(missing(error))return [];throw error;}
  const reading=observeTreeProcesses([root],{self:process.pid,...options});
  // A known owner already refuses reset; missing observations never certify idle.
  if(!reading.users.length)complete(reading);
  return reading.users.map(({pid,command,where})=>({pid,command,where}));
}
export function assertNoProcessUsers(roots:readonly string[],options:TreeProcessOptions={}):string[]{
  const reading=observeTreeProcesses(roots,options);
  const owner=reading.users[0];if(owner)throw Error('process '+owner.pid+' owns '+owner.link+' in '+owner.path);
  complete(reading);return reading.ignored.map(row=>'ignored non-dumpable outside nts: pid '+row.pid+' '+row.command+'; birth '+row.birth+'; cgroup '+row.group);
}
export function describeUsers(users:readonly TreeUser[],most=3):string{
  const named=users.slice(0,most).map(user=>`pid ${user.pid} ${user.command} (${user.where})`);
  return users.length>most?`${named.join(', ')} and ${users.length-most} more`:named.join(', ');
}
