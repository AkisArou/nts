// The launcher is poisoned before the allowlist owner sees it. Test entries
// receive strict resource/cache grants; HOME and execution-policy identity stay
// with their canonical parent. Mutable child state still belongs to each fixture.
import {assignTestValues,testEnvironment} from './test-environment.ts';
import {HOST_OBSERVATION_ENVIRONMENT} from './host-observations.ts';
import {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {beforeEach} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function poisonedTestEnvironment(source:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  return testEnvironment({}, {...source,HOME:'/unowned/test-home',NODE_OPTIONS:'--nts-undeclared-test-environment',
    NODE_PATH:'/unowned/modules',NTS_UNDECLARED_TEST_ENVIRONMENT:'poison: ambient environment copied'});
}
export function installTestHost():void {
  const environment=poisonedTestEnvironment();
  const grants:NodeJS.ProcessEnv={NTS_MEMORY_RESERVATION:undefined,NTS_MEMORY_PRIORITY:undefined};
  for(const name of [...HOST_OBSERVATION_ENVIRONMENT,...CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT])grants[name]=environment[name];
  assignTestValues(process.env,grants);
  // process.env coerces assignment of undefined to the string 'undefined'.
  // The context revocation above is done; remove the native variables too.
  delete process.env.NTS_MEMORY_RESERVATION;delete process.env.NTS_MEMORY_PRIORITY;
  // This preload is test instrumentation, never an oracle execution option.
  // Preserve every caller-supplied flag; remove only our exact import pair.
  process.execArgv=process.execArgv.filter((flag,index,all)=>{
    const isBootstrap=(value:string|undefined)=>value!==undefined&&pathToFileURL(resolve(value)).href===import.meta.url;
    return !(flag==='--import'&&isBootstrap(all[index+1])||index>0&&all[index-1]==='--import'&&isBootstrap(flag));
  });
}
// node --test also preloads in the parent which forks its entry workers.
if(process.env.NODE_TEST_CONTEXT){
  installTestHost();
  // Child test events are serialized asynchronously. Flush completed reports
  // before a following synchronous body can block this worker's event loop.
  // Capture the scheduler before a test can replace timers with its own clock.
  const reportTurn=setImmediate;
  beforeEach(()=>reportTurn());
}
