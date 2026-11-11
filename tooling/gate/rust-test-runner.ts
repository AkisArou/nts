// Cargo runner used by the inner loop, sharing the gate's after-binary check.
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {testScratchBase,TestScratch} from './test-scratch.ts';

const [binary,...args]=process.argv.slice(2);
if(!binary)throw new Error('rust-test-runner needs a test binary');
const scratch=new TestScratch(join(testScratchBase(),'rust-tests'),binary);
let status=1;
try {
  const child=spawn(binary,args,{env:scratch.environment(process.env),stdio:'inherit'});
  status=await new Promise<number>(resolve=>{
    child.on('error',error=>console.error(`${binary}: ${error.message}`));
    child.on('close',code=>resolve(code??1));
  });
} finally {
  const leftovers=scratch.finish();
  if(leftovers.length){
    console.error(`test scratch leaked by ${binary} (removed):\n${leftovers.join('\n')}`);
    status=1;
  }
}
process.exitCode=status;
