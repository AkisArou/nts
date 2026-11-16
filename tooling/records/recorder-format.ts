import assert from 'node:assert/strict';
import type {DeltaRow} from './delta.ts';
export type RecordRow={name:string;line:string};
export function lineRows(text:string,key:(name:string,value:string)=>string=(name)=>name):{header:string;rows:Map<string,RecordRow>}{
 const [header='',...lines]=text.split('\n');const rows=new Map<string,RecordRow>();
 for(const line of lines){if(line===''||line.startsWith('#'))continue;const [name,value]=line.split('\t') as [string,string];rows.set(key(name,value),{name,line});}
 return {header,rows};
}
export function auditLines(file:string,before:string|null,after:string,pending:ReadonlySet<string>,options:{rows:(text:string)=>ReturnType<typeof lineRows>;accepted:(before:string,after:string)=>string|null;allowCreate?:boolean;fixedComments?:boolean}):string[]{
 if(options.fixedComments&&before!==null){const header=(text:string)=>text.split('\n').filter(line=>line.startsWith('#'));assert.deepEqual(header(after),header(before),`${file}: the header changed`);}
 if(before===null&&options.allowCreate){const now=options.rows(after);for(const row of now.rows.values())assert.ok(pending.has(row.name),`${file}: a row was added for ${row.name}, which was not pending`);return [...now.rows.values()].map(row=>`${row.name} ${row.line.split('\t')[1]} (pending)`);}
 assert.ok(before!==null,`${file} was created; a line record is written by a full --record`);
 const was=options.rows(before),now=options.rows(after);assert.equal(now.header,was.header,`${file}: the header changed`);const recorded:string[]=[];
 for(const [key,row]of was.rows){const next=now.rows.get(key);assert.ok(next,`${file}: the row of ${row.name} was removed`);if(next.line===row.line)continue;const change=options.accepted(row.line,next.line);assert.ok(change,`${file}: the row of ${row.name} was rewritten, and the ratchet does not accept it`);recorded.push(`${row.name} ${change}`);}
 for(const [key,row]of now.rows){if(was.rows.has(key))continue;assert.ok(pending.has(row.name),`${file}: a row was added for ${row.name}, which was not pending`);recorded.push(`${row.name} ${row.line.split('\t')[1]} (pending)`);}return recorded;
}
export function changedLines(kind:string,file:string,before:string|null,after:string,rows:(text:string)=>ReturnType<typeof lineRows>):Omit<DeltaRow,'sources'>[]{const was=before===null?new Map<string,RecordRow>():rows(before).rows;return [...rows(after).rows].filter(([key,row])=>was.get(key)?.line!==row.line).map(([key,row])=>({kind,record:file,case:row.name,key,before:was.get(key)?.line??null,after:row.line}));}
export function validateLine(row:DeltaRow,rows:(text:string)=>ReturnType<typeof lineRows>,bad:(row:DeltaRow,why:string)=>never):void{
 for(const line of [row.before,row.after]){if(line===null)continue;let keys:string[]=[];try{keys=[...rows(`\n${line}\n`).rows.keys()];}catch{/* not a row */}if(line.includes('\n')||!line.startsWith(`${row.case}\t`)||keys.length!==1||keys[0]!==row.key)bad(row,'it is not one row of its case');}
}
export function wholeRow(row:DeltaRow,bad:(row:DeltaRow,why:string)=>never):void{if(row.key!==row.case)bad(row,'its key is not its case');}
export function mergeWhole(_file:string,_text:string|null,rows:readonly DeltaRow[]):string{assert.equal(rows.length,1,'a file-per-case record has one row');return rows[0]!.after;}
export function mergeLines(text:string|null,rows:readonly DeltaRow[],header:string|undefined,merge:(text:string,updates:{path:string;value:any}[])=>string):string{
 if(text===null){assert.ok(header!==undefined,'there is no such record, and the delta has no header for one');text=`${header}\n${rows[0]!.after}\n`;}
 return merge(text,rows.map(row=>{const tab=row.after.indexOf('\t');return {path:row.after.slice(0,tab),value:JSON.parse(row.after.slice(tab+1))};}));
}
