// Observability only: this data never grants record reuse or narrows checks.
export type RustRecordDecision={record:'trusted'|'stale-live'|'absent-live';reason:string;blob:string|null};
export type RustRecordDecisionAtRevision={revision:string;decision:RustRecordDecision};
const objectId=(value:unknown):value is string=>typeof value==='string'&&/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export function readRustRecordDecision(value:unknown):RustRecordDecision{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid Rust selector record decision');
  const row=value as RustRecordDecision;
  if(Object.keys(row).some(key=>!['record','reason','blob'].includes(key))||!['trusted','stale-live','absent-live'].includes(row.record)
    ||typeof row.reason!=='string'||!row.reason.trim()||row.blob!==null&&!objectId(row.blob)||row.record==='trusted'&&row.blob===null)
    throw Error('invalid Rust selector record decision');
  return {record:row.record,reason:row.reason,blob:row.blob};
}
export function readRustRecordDecisions(value:unknown):RustRecordDecisionAtRevision[]{
  if(!Array.isArray(value))throw Error('invalid Rust selector revision decisions');
  return value.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>key!=='revision'&&key!=='decision')||!objectId(row.revision))
      throw Error('invalid Rust selector revision decision');
    return {revision:row.revision,decision:readRustRecordDecision(row.decision)};
  });
}
export function reportRustRecordDecisions(rows:readonly RustRecordDecisionAtRevision[]|undefined,report:(line:string)=>void):void{
  for(const {revision,decision}of rows??[])report(`Rust selector ${revision.slice(0,12)}: ${decision.record}; ${decision.reason}; accepted blob ${decision.blob??'none'}`);
}
