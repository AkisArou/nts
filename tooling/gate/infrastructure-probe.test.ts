import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {infrastructureProbes,INFRASTRUCTURE_PROBE_BOUND_MS,type ProbeResult,type ProbeRequest} from './infrastructure-probe.ts';
import {ToolingInstrumentError,readStepInstrument} from './step-result.ts';
import {testScratch} from './test-scratch.ts';
import {gateCapabilities} from './environment.ts';
import {commentsOnly} from './comment-changes.ts';
import {toolIdentity,artifactShadow} from './artifact-shadow.ts';
import {typecheck,precheckProgram} from '../census/generate/precheck.ts';
import {measurementGroup} from '../full-check/measure-command.ts';
import type {FunctionSpec} from '../census/generate/model.ts';

const result=(change:Partial<ProbeResult>={}):ProbeResult=>({pid:71,output:['','',''],stdout:'answer',stderr:'',status:0,signal:null,...change});
const timeout=()=>result({error:Object.assign(Error('controlled timeout'),{code:'ETIMEDOUT'})});
const request:ProbeRequest={purpose:'read a declared identity',command:'/owned/tool',args:['--version'],env:{}};
const named=(run:()=>unknown,word:string)=>assert.throws(run,(error:unknown)=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'&&error.message.includes(word));

test('one owner preserves input, environment and output bounds without timing a fixture',()=>{
  const input=Buffer.from('source bytes'),env={DECLARED:'value'};let calls=0,simulatedElapsed=0;
  const probe=infrastructureProbes((command,args,options)=>{
    calls++;simulatedElapsed+=120_000;
    assert.equal(command,request.command);assert.deepEqual(args,request.args);
    assert.equal(options.timeout,INFRASTRUCTURE_PROBE_BOUND_MS);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.encoding,'utf8');
    assert.equal(options.input,input);assert.equal(options.env,env);assert.equal(options.cwd,'/owned/tree');assert.equal(options.maxBuffer,12345);
    return result();
  });
  assert.equal(probe({...request,input,env,cwd:'/owned/tree',maxBuffer:12345}).stdout,'answer');
  assert.equal(calls,1);assert.equal(simulatedElapsed,120_000,'supplied slow completion remains an ordinary answer');
});

for(const [why,answer] of [
  ['wedged-probe',timeout()],['ENOENT',result({error:Object.assign(Error('ENOENT missing executable'),{code:'ENOENT'})})],
  ['SIGKILL',result({signal:'SIGKILL',status:null})],['exit status',result({status:null})],
  ['exited 7',result({status:7,stderr:'tool diagnostic'})],
] as const)test('infrastructure '+why+' is named before any verdict or fallback',()=>{
  const probe=infrastructureProbes(()=>answer);named(()=>probe(request),why);
});

test('ordinary source exits are declared; they never authorize a failed instrument',()=>{
  assert.equal(infrastructureProbes(()=>result({status:2}))({...request,exits:'classify'}).status,2);
  assert.equal(infrastructureProbes(()=>result({status:1}))({...request,exits:[0,1]}).status,1);
  named(()=>infrastructureProbes(timeout)({...request,exits:'classify'}),'read a declared identity');
  named(()=>infrastructureProbes(()=>{throw Error('runner launch failed');})(request),'runner launch failed');
});

test('a failed probe publishes tooling-setup with its purpose, never a test outcome',t=>{
  const root=testScratch(t,'probe-receipt'),file=join(root,'instrument.json');
  named(()=>infrastructureProbes(timeout)({...request,env:{NTS_GATE_STEP_RESULT:file,NTS_GATE_STEP:'tooling',NTS_GATE_STEP_ATTEMPT:'owned'}}),'wedged-probe');
  const record=readStepInstrument(file,'tooling','owned');assert.equal(record?.kind,'tooling-setup');assert.equal(record?.verdict,'INSTRUMENT');
  assert.match(record?.reason??'',/read a declared identity.*owned\/tool/);
});

test('capability and system-manager questions use supplied answers and propagate named failures',()=>{
  const answer=infrastructureProbes((command,args)=>{
    if(command==='systemctl'){assert.ok(args.includes('ControlGroup'));return result({stdout:'/owned/group\n'});}
    assert.ok(args.includes('--capabilities'));return result({stdout:JSON.stringify({format:[]})});
  });
  assert.deepEqual(gateCapabilities('/owned/tree',['format'],null,answer),[{step:'format',capabilities:[]}]);
  assert.equal(measurementGroup('owned.slice',answer),'/owned/group');
  named(()=>gateCapabilities('/owned/tree',['format'],null,infrastructureProbes(timeout)),'gate capability declarations');
  named(()=>measurementGroup('owned.slice',infrastructureProbes(timeout)),'measurement cgroup');
});

test('a lexer answer may retain the ordinary gate, while its broken instrument cannot silently fall back',()=>{
  assert.equal(commentsOnly('x.c','// before\n','// after\n',infrastructureProbes(()=>result({status:1}))),false);
  named(()=>commentsOnly('x.c','// before\n','// after\n',infrastructureProbes(timeout)),'C comment tokens');
});

test('tool location and version use the owner and a failed identity is not a missing shadow observation',t=>{
  const root=testScratch(t,'probe-tool'),tool=join(root,'declared-tool');writeFileSync(tool,'owned bytes '+root);
  const calls:string[]=[];
  const probe=infrastructureProbes(command=>{calls.push(command);return result({stdout:command==='sh'?tool+'\n':'fixture version\n'});});
  named(()=>toolIdentity(tool,{},infrastructureProbes(timeout)),'identify tool');
  const identity=toolIdentity('declared-tool',{},probe) as {version:string};assert.equal(identity.version,'fixture version\n');assert.deepEqual(calls,['sh',tool]);
  const bad=infrastructureProbes(timeout),env={NTS_GATE_SHADOW_DIR:root,NTS_GATE_CASE_COSTS_DIR:root,NTS_GATE_STEP:'tooling'};
  named(()=>artifactShadow('probe',()=>({files:[],values:toolIdentity('absent-tool',{},bad)}),env),'locate tool');
});

test('prechecks classify completed source errors but never turn a probe failure into waste',()=>{
  assert.equal(typecheck('/owned/program',infrastructureProbes(()=>result({status:2,stdout:'source type error'}))).ok,false);
  named(()=>typecheck('/owned/program',infrastructureProbes(timeout)),'typecheck a generated program');
  const functions:FunctionSpec[]=[{name:'subject',role:'subject',parameters:[],inputs:[[]],counterpart:'control'},
    {name:'control',role:'control',parameters:[],inputs:[[]]}];
  const observations=functions.map((fn,index)=>({name:fn.name,inputs:fn.inputs,values:[{kind:'number',value:index===0?1:0}]}));
  let calls=0;
  const success=infrastructureProbes((_command,args,options)=>{
    calls++;if(args.includes('--project'))return result({stdout:''});
    assert.equal(options.input,JSON.stringify(functions));return result({stdout:JSON.stringify({version:1,runs:[observations,observations]})});
  });
  assert.equal(precheckProgram('/owned/program',functions,success).ok,true);assert.equal(calls,3);
  const noAnswer=infrastructureProbes((_command,args)=>args.includes('--project')?result({stdout:''}):timeout());
  named(()=>precheckProgram('/owned/program',functions,noAnswer),'observe a generated program');
});

test('the wedged-probe guard stops a child that ignores SIGTERM',()=>{
  let stopped=false;
  const probe=infrastructureProbes((_command,_args,options)=>{
    if(options.killSignal==='SIGKILL'){stopped=true;return timeout();}
    return result({stdout:'the child ignored termination and remains live'});
  });
  named(()=>probe(request),'wedged-probe');assert.equal(stopped,true);
});
