// Direct libuv clients pass argv rather than reconstructing a system -luv link.
import {spawnSync} from 'node:child_process';
import {bundledDependencies} from './node-deps.mjs';
import {check} from '../gate/node-deps-elf.ts';

const [compiler,driver,...args]=process.argv.slice(2);
if(!compiler||!driver||!args.length)throw Error('usage: native-link.mjs <nts> <driver> <argv...>');
const artifacts=bundledDependencies(compiler,['uv'],[driver]);
const result=spawnSync(driver,[...artifacts.include_flags,...args,...artifacts.link_flags],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
const at=args.lastIndexOf('-o');
check(at>=0?args[at+1]:'a.out');
