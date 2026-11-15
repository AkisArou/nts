// Parser-free indexed executable population. It performs no status or content read.
import {execFileSync} from 'node:child_process';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {toolingModuleName} from '../gate/tooling-module-name.ts';
export function dependencySourceCandidates(repo:string):string[]{
  return execFileSync('git',gitArguments(['ls-files','-z','--cached']),{cwd:repo,encoding:'utf8',maxBuffer:Infinity,stdio:['ignore','pipe','pipe']}).split('\0').filter(toolingModuleName);
}
