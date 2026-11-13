import assert from 'node:assert/strict';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {dataDirectory} from '../gate/reader-inputs/main.ts';
import {runMemberCatalogue} from './member-catalogue.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const DIRECTORIES=[
  dataDirectory(new URL('../../compiler/',import.meta.url)),
  dataDirectory(new URL('../../runtime/jvm/',import.meta.url)),
  dataDirectory(new URL('../../tooling/',import.meta.url)),
].map(url=>relative(ROOT,fileURLToPath(url)));

export function main(argv:readonly string[]=process.argv.slice(2)):number{
  assert(argv.every(arg=>arg==='--check')&&argv.length<=1,'usage: members.ts [--check]');
  return runMemberCatalogue({root:ROOT,check:argv.includes('--check'),directories:DIRECTORIES});
}
runAsCommand(import.meta.url,()=>main());
