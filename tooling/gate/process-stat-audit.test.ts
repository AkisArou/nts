import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectHostSource} from './test-host-audit.ts';
import {processStatPathProblems,PROCESS_STAT_PATH_OWNERS} from './process-stat-audit.ts';

const paths=(source:string,file='tooling/new-reader.ts')=>inspectHostSource(file,source).processStatPaths;

test('every construction of a process or task stat path outside the owner is refused, embedded child scripts included',()=>{
  for(const source of [
    'import {readFileSync} from "node:fs";const stat=readFileSync(`/proc/${pid}/stat`,"utf8");',
    'import {readFileSync as read} from "node:fs";read("/proc/"+pid+"/stat","utf8");',
    'const base="/proc/",tail="/stat";readFileSync(base+pid+tail);',
    'readFileSync("/proc/self/stat","utf8").split(" ");',
    'execFileSync("sh",["-c","cut -d\\" \\" -f22 /proc/$PID/stat"]);',
    'readFileSync(`/proc/${pid}/task/${tid}/stat`,"utf8");',
    'import {join} from "node:path";readFileSync(join("/proc",String(pid),"stat"));',
    'const text=readFileSync(("/proc/"+(pid))+"/stat");',
    'spawn(node,["-e",`const fs=require("node:fs");const s=fs.readFileSync("/proc/self/stat","utf8");process.stdout.write(s);`]);',
  ]){
    const rows=paths(source);
    // An embedded script is found both as the launcher's text and as parsed code.
    assert.equal(rows.length,source.startsWith('spawn(')?2:1,source);
    assert.match(processStatPathProblems(rows).join('\n'),/tooling\/new-reader\.ts:1: process stat path outside tooling\/differential\/process-stat\/main\.ts/,source);
  }
});

test('other process records, the machine-wide CPU record and non-path text are not stat paths',()=>{
  for(const source of [
    'readFileSync(`/proc/${pid}/status`,"utf8");',
    'readFileSync(`/proc/${pid}/statm`,"utf8");',
    'readFileSync("/proc/stat","utf8");',
    'readFileSync(`/proc/${pid}/cgroup`);readFileSync("/proc/"+pid+"/exe");',
    'readFileSync(`${proc}/${pid}/stat`,"utf8");',
    'const label="process "+pid+" stat";',
    // A supplied proc tree in a fixture directory is not the host's.
    'const proc=join(dir,"proc"),pid=join(proc,"42");writeFileSync(join(pid,"stat"),record);',
    'writeFileSync(`${root}/proc/42/stat`,record);',
  ])assert.deepEqual(paths(source),[],source);
});

test('only the declared owners may name the path, and the owner names its reason',()=>{
  const source='const live=pid=>readText(`/proc/${pid}/stat`,"utf8");';
  assert.deepEqual(processStatPathProblems(paths(source,'tooling/differential/process-stat/main.ts')),[]);
  assert.equal(processStatPathProblems(paths(source,'tooling/differential/oracle-runtime.ts')).length,1);
  assert.deepEqual(Object.keys(PROCESS_STAT_PATH_OWNERS).sort(),['tooling/differential/process-stat/main.ts','tooling/gate/process-stat-audit.test.ts']);
});
