import assert from 'node:assert/strict';

import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {wholeRow,mergeWhole} from '../records/recorder-format.ts';
import {acceptedChange,improves,type OutcomeTransition} from '../conformance/outcome-transition.ts';
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const label=(transition:Pick<OutcomeTransition,'word'>)=>improves(transition)?'improved':'refuses differently';
import {outcomeFixtures} from './outcomes-project.ts';
import {outcomeInventory,RECORD,judge} from './outcomes-verdict.ts';
import {outcomesRecord} from '../records/record-paths.ts';

export const outcomesFamily:RecordFamily={
pending:root=>{const directory=join(root,'tests/outcomes');return outcomeInventory(directory,outcomeFixtures(directory)).pending.map(name=>({name:`tests/outcomes/${name}`,record:outcomesRecord(name)}));},
 files:root=>outcomeFixtures(join(root,'tests/outcomes')).map(outcomesRecord),
 records:row=>/^tests\/outcomes\/[^/]+$/.test(row.case)?[outcomesRecord(row.case.slice('tests/outcomes/'.length))]:[],
 runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('./outcomes-check.ts',import.meta.url))),'--record-pending']],
 audit:(file,before,after,pending)=>{const fixture=file.slice(0,-`/${RECORD}`.length),now=JSON.parse(after);if(before===null){assert.ok(pending.has(fixture),`${file} was written for ${fixture}, which was not pending`);return [`${fixture} ${now.category} (pending)`];}const was=JSON.parse(before),change=judge(was,now);assert.ok('loud' in change&&acceptedChange(change),`${file} was rewritten, and the ratchet does not accept it`);return [`${fixture} ${was.category} -> ${now.category} (${label(change)})`];},
 rows:()=>null,validate:wholeRow,merge:mergeWhole,
 changes:(kind,file,before,after)=>{const name=file.slice(0,-`/${RECORD}`.length);return [{kind,record:file,case:name,key:name,before,after}];},
 sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:`${name}/${RECORD}`}))),

};
