// A complete private proc observation; never a live-process scanner.
import {mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {testScratch} from '../gate/test-scratch.ts';

export function treeProcessFixture(t:TestContext){
  const root=testScratch(t,'tree-process-observation'),tree=join(root,'tree'),proc=join(root,'proc'),task=join(proc,'42');
  mkdirSync(tree);mkdirSync(join(task,'fd'),{recursive:true});
  writeFileSync(join(task,'comm'),'worker\n');
  writeFileSync(join(task,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(task,'stat'),'42 (worker) '+['S',...Array<string>(18).fill('0'),'99'].join(' '));
  writeFileSync(join(task,'cgroup'),'0::/user.slice/nts-agent-private.service\n');
  symlinkSync('/outside',join(task,'cwd'));symlinkSync('/outside/program',join(task,'exe'));
  return {root,tree,proc,task,options:{proc}};
}
