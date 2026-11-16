import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type RecordFamily} from '../records/recorder-core.ts';
import {wholeRow,mergeWhole} from '../records/recorder-format.ts';

const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
import {RUST_SELECTOR_CASE,rustSelectorPending,rustSelectorSourceKey} from './rust-selector-write.ts';
import {RUST_SELECTOR_RECORD,parseRustSelectorRecord,MAX_RUST_SELECTOR_RECORD_BYTES} from './rust-selector-record.ts';

export const rustSelectorFamily:RecordFamily={
pending:root=>rustSelectorPending(root)?[{name:RUST_SELECTOR_CASE,record:RUST_SELECTOR_RECORD}]:[],
 files:()=>[RUST_SELECTOR_RECORD],records:row=>row.case===RUST_SELECTOR_CASE?[RUST_SELECTOR_RECORD]:[],
 runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('./rust-selector-write.ts',import.meta.url))),'--write']],
 audit:(file,_before,after,pending)=>{assert.equal(file,RUST_SELECTOR_RECORD);assert.ok(pending.has(RUST_SELECTOR_CASE),'Rust selector refresh was not pending');assert.ok(Buffer.byteLength(after)<=MAX_RUST_SELECTOR_RECORD_BYTES,'Rust selector record exceeds committed size budget');parseRustSelectorRecord(JSON.parse(after) as unknown);return [RUST_SELECTOR_CASE+' (pending projection)'];},
 rows:()=>null,validate:wholeRow,merge:mergeWhole,
 changes:(kind,file,before,after)=>[{kind,record:file,case:RUST_SELECTOR_CASE,key:RUST_SELECTOR_CASE,before,after}],
 sourceDigests:(root)=>{const path=join(root,RUST_SELECTOR_RECORD);return new Map([[RUST_SELECTOR_CASE,existsSync(path)?rustSelectorSourceKey(root,readFileSync(path,'utf8'))??null:null]]);},
 sourceAtApply:(root,row)=>rustSelectorSourceKey(root,row.after),

};
