import {runAsCommand} from "./command-entry/main.ts";
// Parent-only Node resolution service. It never evaluates a subject module.
import {createHash,randomBytes} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {registerHooks,createRequire} from 'node:module';
import {createConnection,createServer,type Socket} from 'node:net';
import {closeSync,constants,createReadStream,existsSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,statSync,unlinkSync,watch,writeFileSync,type FSWatcher} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {nodeExecutableIdentity,nodeProcessBirth,nodeProcessAlive,checkNodeResolutionSession,type NodeResolutionOptions,type NodeResolutionSession} from './oracle-runtime.ts';
export {nodeResolutionOptions,checkNodeResolutionSession} from './oracle-runtime.ts';
export type {NodeResolutionOptions,NodeExecutableIdentity,NodeResolutionSession} from './oracle-runtime.ts';

export type NodeResolutionQuery={specifier:string;parentURL:string;mode:'esm'|'cjs';conditions:string[];importAttributes:Record<string,string>};
export type NodeResolutionAnswer={ok:true;result:{url:string;format?:string;importAttributes?:Record<string,string|undefined>}}|{ok:false;error:{name:string;message:string;code?:string}};
type Batch={version:1;token:string;action:'query'|'close';queries:NodeResolutionQuery[]};
type Response={version:1;requestSha256:string;answers:NodeResolutionAnswer[];cost:{cpuUsec:number;wallMs:number;totalCpuUsec:number;queries:number;probeModuleLoads:number}};
const MAX_MESSAGE_BYTES=256*2**20;
const EMPTY_PROBE_MODULE='data:text/javascript,export%20%7B%7D';
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const atomic=(file:string,value:unknown)=>{const next=file+'.'+process.pid;writeFileSync(next,JSON.stringify(value)+'\n',{flag:'wx'});renameSync(next,file);};
async function executableHash(){
  const hash=createHash('sha256'),expected=statSync('/proc/self/exe').size;let bytes=0;
  for await(const chunk of createReadStream('/proc/self/exe')){hash.update(chunk);bytes+=chunk.length;}
  if(bytes!==expected)throw Error('oracle Node executable changed while hashing');
  return hash.digest('hex');
}
// A directory fd avoids Unix sun_path length limits. Both peers address the
// same directory/holder.sock, and the listener retains its fd until close.
function socketAddress(directory:string){
  const fd=openSync(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  return {path:'/proc/self/fd/'+fd+'/holder.sock',close:()=>closeSync(fd)};
}
function receive(socket:Socket):Promise<Buffer>{
  return new Promise((done,fail)=>{
    const chunks:Buffer[]=[];let bytes=0,complete=false;
    const error=(reason:unknown)=>{if(complete)return;complete=true;fail(reason);};
    socket.on('data',(chunk:Buffer)=>{
      if(complete)return;bytes+=chunk.length;
      if(bytes>MAX_MESSAGE_BYTES){error(Error('oracle Node resolution message exceeds its byte bound'));socket.destroy();return;}
      chunks.push(chunk);
    });
    socket.once('error',error);
    socket.once('end',()=>{
      if(complete)return;
      const value=Buffer.concat(chunks,bytes);
      if(!value.length||value.indexOf(10)!==value.length-1){error(Error('oracle Node resolution message has an invalid frame'));return;}
      complete=true;done(value);
    });
    socket.once('close',()=>{if(!complete)error(Error('oracle Node resolution connection closed before its response'));});
  });
}
type ResolutionAcquisition={ready?:(waiting:Promise<NodeResolutionSession>)=>Promise<NodeResolutionSession>;watch?:(directory:string,listener:()=>void)=>FSWatcher};
function readyFile(directory:string,watchDirectory:NonNullable<ResolutionAcquisition['watch']>=watch):{ready:Promise<NodeResolutionSession>;cancel:()=>void}{
  const file=join(directory,'holder.json');let cancel=()=>{};
  const ready=new Promise<NodeResolutionSession>((done,fail)=>{
    let complete=false;
    const finish=(error?:unknown,value?:NodeResolutionSession)=>{if(complete)return;complete=true;clearTimeout(timer);watcher.close();if(error)fail(error);else done(value!);};
    const check=()=>{try{if(existsSync(file))finish(undefined,JSON.parse(readFileSync(file,'utf8')));}catch(error){finish(error);}};
    const watcher=watchDirectory(directory,check),timer=setTimeout(()=>finish(Error('oracle Node resolution service did not start')),30_000);
    cancel=()=>finish(Error('oracle Node resolution service acquisition cancelled'));
    watcher.once('error',finish);check();
  });
  void ready.catch(()=>{});return {ready,cancel};
}
/** Async initialization is safe in a parent draining other children's pipes.
 * Other platforms retain the existing bounded live path, without using an
 * executable identity that they cannot authenticate through Linux /proc. */
export async function startNodeResolutionSession(directory:string,options:NodeResolutionOptions,env:NodeJS.ProcessEnv,ownerPid=process.pid,onStarted?:(session:NodeResolutionSession,closed:Promise<void>)=>void,acquisition:ResolutionAcquisition={}):Promise<NodeResolutionSession|null>{
  if(process.platform!=='linux')return null;
  mkdirSync(directory,{recursive:true,mode:0o700});
  const permissions=lstatSync(directory);
  if(!permissions.isDirectory()||permissions.isSymbolicLink()||(permissions.mode&0o077)!==0||permissions.uid!==process.getuid!())throw Error('oracle Node resolution session directory is not private');
  const ready=join(directory,'holder.json'),helper=fileURLToPath(import.meta.url),helperSha256=digest(readFileSync(helper));
  if(existsSync(ready)){
    const session=JSON.parse(readFileSync(ready,'utf8')) as NodeResolutionSession;
    if(session.directory!==directory||session.helperSha256!==helperSha256)throw Error('oracle Node resolution service identity changed');
    checkNodeResolutionSession(session,options);return session;
  }
  const waiting=readyFile(directory,acquisition.watch),claim=join(directory,'starting.json');
  let starter=false,child:ChildProcess|undefined,closed:Promise<void>|undefined;
  let exited:Promise<{code:number|null;signal:NodeJS.Signals|null;error?:Error}>|undefined;
  try{
    try{writeFileSync(claim,JSON.stringify({pid:process.pid})+'\n',{flag:'wx',mode:0o600});starter=true;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    if(starter){
      const owner={pid:ownerPid,birth:nodeProcessBirth(ownerPid)},expected=nodeExecutableIdentity(process.pid);
      const init={version:1,directory,token:randomBytes(24).toString('hex'),nodeVersion:process.versions.node,nodeSha256:await executableHash(),executable:expected,owner,options,helperSha256};
      atomic(join(directory,'start.json'),init);
      const log=openSync(join(directory,'holder.stderr'),'ax',0o600);
      // This starter owns completion immediately, before readiness or validation
      // can fail. A successful handoff may outlive the preparing process group.
      try{child=spawn(process.execPath,[...options.flags,helper,'--serve',directory],{env,detached:true,stdio:['ignore','ignore',log]});}
      finally{closeSync(log);}
      const acquired=child;
      exited=new Promise(done=>{
        let error:Error|undefined;
        acquired.once('error',value=>{error=value;});
        acquired.once('close',(code,signal)=>done({code,signal,...(error?{error}:{})}));
      });
      closed=exited.then(result=>{if(result.error||result.code!==0||result.signal)throw result.error??Error('oracle Node resolution holder stopped: '+(result.signal??result.code));});
      void closed.catch(()=>{});child.unref();
      if(!child.pid)throw Error('oracle Node resolution service launch failed');
    }
    const pending=acquisition.ready?acquisition.ready(waiting.ready):waiting.ready;
    const early=exited?.then(result=>{throw result.error??Error('oracle Node resolution holder stopped before readiness: '+(result.signal??result.code));});
    const session=await (early?Promise.race([pending,early]):pending);
    if(session.directory!==directory||session.helperSha256!==helperSha256)throw Error('oracle Node resolution service identity changed');
    checkNodeResolutionSession(session,options);
    if(starter&&closed)onStarted?.(session,closed);
    return session;
  }catch(primary){
    // Never signal a reused holder or discover a PID to stop. Only this call's
    // actual ChildProcess is acquired, and close is joined before throwing.
    if(child&&exited){
      child.ref();
      const errors:unknown[]=[primary];
      try{if(child.exitCode===null&&child.signalCode===null&&!child.kill('SIGTERM'))throw Error('oracle Node resolution holder termination failed');}
      catch(error){errors.push(error);}
      const result=await exited;if(result.error)errors.push(result.error);
      if(errors.length>1)throw new AggregateError(errors,'oracle Node resolution acquisition and cleanup failed',{cause:primary});
    }
    throw primary;
  }finally{waiting.cancel();}
}

async function exchange(session:NodeResolutionSession,action:Batch['action'],queries:NodeResolutionQuery[]):Promise<Response>{
  const request:Batch={version:1,token:session.token,action,queries},bytes=Buffer.from(JSON.stringify(request)+'\n'),sha256=digest(bytes),address=socketAddress(session.directory);
  const socket=createConnection(address.path),response=receive(socket);
  socket.once('connect',()=>socket.end(bytes));
  const timer=setTimeout(()=>socket.destroy(Error('oracle Node resolution service did not answer')),120_000);
  try{
    const value=JSON.parse((await response).toString('utf8')) as Response;
    if(value.version!==1||value.requestSha256!==sha256||!Array.isArray(value.answers)||value.answers.length!==queries.length)throw Error('oracle Node resolution response identity changed');
    return value;
  }finally{clearTimeout(timer);socket.destroy();address.close();}
}
/** One async transaction for the complete parent batch; no per-child RPC. */
export async function queryNodeResolutions(session:NodeResolutionSession,queries:NodeResolutionQuery[]):Promise<Response>{
  checkNodeResolutionSession(session,session.options);return exchange(session,'query',queries);
}
export async function closeNodeResolutionSession(session:NodeResolutionSession):Promise<void>{await exchange(session,'close',[]);}
async function serve(directory:string){
  const init=JSON.parse(readFileSync(join(directory,'start.json'),'utf8')) as Omit<NodeResolutionSession,'holder'|'conditions'>,self=nodeExecutableIdentity(process.pid);
  if(init.version!==1||init.directory!==directory||self.dev!==init.executable.dev||self.ino!==init.executable.ino||init.nodeVersion!==process.versions.node||!nodeProcessAlive(init.owner))throw Error('oracle Node resolution service launch identity changed');
  const conditions:NodeResolutionSession['conditions']={esm:[],cjs:[]};
  // Report the actual launch, independently of what the parent's request
  // claimed. Session validation compares these facts with intended options.
  const options:NodeResolutionOptions={flags:[...process.execArgv],nodeOptions:process.env.NODE_OPTIONS??''};
  const session:NodeResolutionSession={...init,options,conditions,holder:{pid:process.pid,birth:nodeProcessBirth(process.pid)}};
  const empty=join(directory,'probe-empty.cjs');writeFileSync(empty,'// Never evaluated.\n',{flag:'wx'});
  let active:NodeResolutionQuery|undefined,answer:NodeResolutionAnswer|undefined,sequence=0,totalQueries=0,probeModuleLoads=0;
  registerHooks({resolve(specifier,context,next){
    if(!specifier.startsWith('nts-oracle-probe:'))return next(specifier,context);
    if(!active)throw Error('oracle Node resolution probe has no request');
    conditions[active.mode]=[...context.conditions];
    try{const result=next(active.specifier,{...context,parentURL:active.parentURL,conditions:active.conditions.length?active.conditions:context.conditions,importAttributes:active.importAttributes});answer={ok:true,result:{url:result.url,...(typeof result.format==='string'?{format:result.format}:{}),...(result.importAttributes?{importAttributes:result.importAttributes}:{})}};}
    catch(error){const value=error as NodeJS.ErrnoException;answer={ok:false,error:{name:value.name,message:value.message,...(typeof value.code==='string'?{code:value.code}:{})}};}
    // New probe specifiers invoke this hook; one constant returned module URL
    // prevents a permanent holder module-map entry for every query.
    return active.mode==='cjs'?{url:pathToFileURL(empty).href,format:'commonjs',shortCircuit:true}:{url:EMPTY_PROBE_MODULE,format:'module',shortCircuit:true};
  },load(url,context,next){if(url===EMPTY_PROBE_MODULE)probeModuleLoads++;return next(url,context);}});
  // Obtain both default condition sets from Node's hooks, never a copied
  // table. The only evaluated module is the same empty ESM probe.
  active={specifier:'node:fs',parentURL:import.meta.url,mode:'esm',conditions:[],importAttributes:{}};
  const initialProbe='nts-oracle-probe:conditions';await import(initialProbe);
  active={...active,mode:'cjs'};createRequire(import.meta.url).resolve('nts-oracle-probe:conditions');active=undefined;
  let serial=Promise.resolve(),closing=false;
  const address=socketAddress(directory),connections=new Set<Socket>();
  const server=createServer({allowHalfOpen:true},socket=>{
    connections.add(socket);socket.once('close',()=>connections.delete(socket));
    socket.setTimeout(120_000,()=>socket.destroy(Error('oracle Node resolution request did not complete')));
    void receive(socket).then(bytes=>{
    serial=serial.then(async()=>{
      const request=JSON.parse(bytes.toString('utf8')) as Batch,requestSha256=digest(bytes);
      if(request.version!==1||request.token!==init.token||!['query','close'].includes(request.action)||!Array.isArray(request.queries)||request.queries.length>100_000||closing)throw Error('oracle Node resolution request identity changed');
      const cpu=process.cpuUsage(),wall=performance.now(),answers:NodeResolutionAnswer[]=[];
      for(const query of request.queries){
        if(!query||typeof query.specifier!=='string'||!query.parentURL?.startsWith('file:')||!['esm','cjs'].includes(query.mode)||!Array.isArray(query.conditions)||query.conditions.some(value=>typeof value!=='string')||!query.importAttributes||Object.values(query.importAttributes).some(value=>typeof value!=='string'))throw Error('oracle Node resolution query is invalid');
        active=query;answer=undefined;const token='nts-oracle-probe:'+(++sequence);
        if(query.mode==='cjs')createRequire(query.parentURL).resolve(token);else await import(token);
        if(!answer)throw Error('oracle Node resolution query did not run');answers.push(answer);totalQueries++;
      }
      active=undefined;const use=process.cpuUsage(cpu),total=process.cpuUsage();
      const response:Response={version:1,requestSha256,answers,cost:{cpuUsec:use.user+use.system,wallMs:performance.now()-wall,totalCpuUsec:total.user+total.system,queries:totalQueries,probeModuleLoads}};
      socket.end(JSON.stringify(response)+'\n');
      if(request.action==='close'){closing=true;server.close();}
    }).catch(error=>{active=undefined;socket.destroy(error instanceof Error?error:Error(String(error)));});
    }).catch(error=>socket.destroy(error instanceof Error?error:Error(String(error))));
  });
  await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(address.path,done);});
  atomic(join(directory,'holder.json'),session);
  const ownerTimer=setInterval(()=>{if(!nodeProcessAlive(init.owner)||!existsSync(directory)){closing=true;for(const socket of connections)socket.destroy();server.close();}},1000);ownerTimer.unref();
  await new Promise<void>(done=>server.once('close',done));clearInterval(ownerTimer);address.close();
  try{unlinkSync(join(directory,'holder.sock'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const total=process.cpuUsage();if(existsSync(directory))atomic(join(directory,'holder-finished.json'),{version:1,cpuUsec:total.user+total.system,queries:totalQueries});
}
runAsCommand(import.meta.url,async()=>{
  if(process.argv[2]==='--serve')await serve(resolve(process.argv[3]!));
});
