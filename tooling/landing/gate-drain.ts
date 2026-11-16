// A dead runner's existing nonce/boot/process/cgroup owner certifies cleanup.
// Run this in a joined child so its bounded kernel drain cannot block the
// landing reservation's sampler or the service's withdrawal watch.
import {isAbsolute} from 'node:path';
import {reapGateRoot} from '../gate/scopes/step-scope.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';

runAsCommand(import.meta.url,()=>{
  const [owner,...extra]=process.argv.slice(2);
  if(!owner||!isAbsolute(owner)||extra.length)throw Error('gate drain needs one absolute run-owner receipt');
  reapGateRoot(owner);
});
