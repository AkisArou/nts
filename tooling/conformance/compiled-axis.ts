// Drain both arms as structured file observations before deciding the axis.
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {activeCommand,CommandNotMeasuredError} from "../gate/active-command.ts";
import {Admission} from "../gate/admission.ts";
import {ToolingInstrumentError,PressureError} from "../gate/step-result.ts";
import {memoryEvents} from "../census/worker-memory.ts";
import {reportCheckFailure,checkFailurePolicy} from "../differential/check-report.ts";
import {AXIS_PREFIX,axisRow,axisFailure,nodeFiles,commandObservation} from "./compiled-axis-rows.mjs";
import {nodeEnvironment} from "./node-environment.ts";

const root=resolve(import.meta.dirname,"../.."),out=resolve(process.env.NTS_ADDON_OUT??join(root,"target/node"));
mkdirSync(out,{recursive:true});
const selected=process.argv.slice(2);
const modules=selected.length?selected:readdirSync(join(root,"runtime/node")).filter(name=>existsSync(join(root,"runtime/node",name,"tsconfig.json"))).sort();
const admission=new Admission({report:message=>process.stderr.write(message+"\n")});
const env=nodeEnvironment(process.env,{NTS_ADDON_OUT:out});
writeFileSync(join(out,"axis.environment.json"),JSON.stringify(env,null,2)+"\n");
const incomplete:unknown[]=[];
let total=0,hollow=0,unmeasured=0,artifactFailures=0,completedFailures=0;
let partialReal=0,partialHollow=0,undetermined=0;

async function command(module:string,phase:string,executable:string,args:string[],extra:NodeJS.ProcessEnv={}){
  while(!admission.open())await new Promise(resolve=>setTimeout(resolve,2000));
  const group=/^0::(.+)$/m.exec(readFileSync("/proc/self/cgroup","utf8"))?.[1];
  if(!group||group==="/"||group.split("/").includes(".."))throw new ToolingInstrumentError("tooling-setup","command has no observable owned cgroup");
  const before=memoryEvents(group),aggregateBefore=memoryEvents(dirname(group),true).oom;
  const result=await activeCommand(executable,args,{cwd:root,env:{...env,...extra},maxBuffer:64*1024*1024,
    onActivity:event=>process.stderr.write(`node:${module} ${phase} activity: ${event.cpu} CPU ticks\n`)});
  writeFileSync(join(out,`${module}.${phase}.log`),result.out);
  const after=memoryEvents(group),aggregateAfter=memoryEvents(dirname(group),true).oom;
  return commandObservation(result,before,after,aggregateBefore,aggregateAfter,`${module} ${phase}`);
}
function emit(record:object){
  const row=axisRow(record);
  process.stdout.write(AXIS_PREFIX+JSON.stringify(record)+"\n");
  if("failed" in row){
    artifactFailures++;completedFailures++;
    process.stdout.write(`${(record as {module:string}).module.padEnd(20)} ${row.phase==='build'?'BUILD FAILED':'WILL NOT LOAD'} -- ${row.failed}\n`);
  }else if("unmeasured" in row){
    unmeasured++;completedFailures+=row.completedFailures;
    const observed=row.observations;
    partialReal+=observed?.real??0;partialHollow+=observed?.hollow??0;undetermined+=observed?.undetermined??0;
    process.stdout.write(`${(record as {module:string}).module.padEnd(20)} NOT MEASURED -- ${observed?.real??0} real, ${observed?.hollow??0} hollow, ${observed?.undetermined??0} undetermined; ${row.unmeasured}\n`);
    incomplete.push(axisFailure(row));
  }else{
    total+=row.real;hollow+=row.hollow;
    process.stdout.write(`${(record as {module:string}).module.padEnd(20)} ${row.real} real, ${row.hollow} hollow, 0 undetermined, ${row.tally.fail} failed\n`);
  }
}
for(const module of modules){
  try{
    if(!/^[a-z_]+$/.test(module)||!existsSync(join(root,"runtime/node",module,"tsconfig.json")))throw new ToolingInstrumentError("tooling-setup",`not a Node module: ${module}`);
    const built=await command(module,"build","bash",[join(root,"tooling/conformance/build.sh"),module]);
    if(built.status!==0){
      emit({version:1,module,kind:"artifact-failure",phase:"build",status:built.status,signal:built.signal,reason:`build ${built.signal??`exit ${built.status}`}; see ${out}/${module}.build.log`});continue;
    }
    // Linking succeeds with unresolved symbols: building is not loading.
    const addon=join(out,module+".node");
    const loaded=await command(module,"load",process.execPath,["-e","require(process.argv[1])",addon]);
    if(loaded.status!==0){
      emit({version:1,module,kind:"artifact-failure",phase:"load",status:loaded.status,signal:loaded.signal,reason:`load ${loaded.signal??`exit ${loaded.status}`}; see ${out}/${module}.load.log`});continue;
    }
    const arms=[];
    // Every module gets both arms, including an empty shaped surface: local
    // tests can reach a separately substituted internal export. A pass is
    // hollow if it survives emptying and never contributes to the real count.
    for(const phase of ["intact","empty"]){
      const result=await command(module,phase,process.execPath,[join(root,"tooling/conformance/run.mjs"),"--module",module,"--addon",addon,"--json",...(phase==="empty"?["--empty-exports"]:[])],{
        NTS_CONFORMANCE_TIMEOUT_MS:process.env.NTS_CONFORMANCE_TIMEOUT_MS??"20000",NTS_CONFORMANCE_ALLOW_EMPTY_SURFACE:"1",
      });
      // A missing or truncated arm is not an arm that found no passes.
      if(result.signal)throw new ToolingInstrumentError("tooling-setup",`${module} ${phase}: ${result.signal}`);
      const raw=JSON.parse(result.stdout),report=nodeFiles(raw);
      writeFileSync(join(out,`${module}.${phase}.json`),JSON.stringify(raw,null,2)+"\n");
      arms.push(report);
    }
    emit({version:1,module,kind:"files",intact:arms[0],empty:arms[1]});
  }catch(error){
    const failure=error instanceof CommandNotMeasuredError||error instanceof ToolingInstrumentError||error instanceof PressureError?error:new ToolingInstrumentError("tooling-setup",`${module}: ${String(error)}`);
    emit({version:1,module,kind:"unmeasured",cause:{kind:failure instanceof PressureError?"memory-pressure":failure.kind,reason:failure.message}});
  }
}
process.stdout.write(`\nTOTAL                ${total} real, ${hollow} hollow, ${artifactFailures} artifact failures, ${unmeasured} not measured across ${modules.length} modules\n`);
if(unmeasured)process.stdout.write(`Incomplete modules, observations only: ${partialReal} real, ${partialHollow} hollow, ${undetermined} undetermined; no incomplete module contributes to the floor\n`);
if(incomplete.length){
  const failure=incomplete.find(error=>checkFailurePolicy(error,completedFailures).disposition==="operator-hold")
    ??incomplete.find(error=>checkFailurePolicy(error,completedFailures).disposition!=="verdict")??incomplete[0];
  process.exitCode=reportCheckFailure(failure,process.env,completedFailures);
}else process.exitCode=artifactFailures?1:0;
