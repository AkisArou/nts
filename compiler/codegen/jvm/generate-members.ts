// The existing generation entry delegates to the strict catalogue owner.
import {runAsCommand} from '../../../tooling/differential/command-entry/main.ts';
import {main} from '../../../tooling/jvm/members.ts';
runAsCommand(import.meta.url,()=>main());
