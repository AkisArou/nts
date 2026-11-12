// Local OOM counters identify the boundary that fired, independently of the
// descendant in which the kernel found its victim. Values are observations.
export type AncestorMemory={group:string;limit:number;oom:number};
export function ancestorMemoryIncident(before:readonly AncestorMemory[],after:readonly AncestorMemory[]):AncestorMemory|undefined{
  const earlier=new Map(before.map(row=>[row.group,row]));
  for(const row of after){
    const previous=earlier.get(row.group);if(!previous)continue;
    if(row.oom<previous.oom)throw Error('resident cap: ancestor OOM counter went backwards: '+row.group);
    if(row.oom>previous.oom)return row;
  }
  return undefined;
}
/** Closest ancestor first, to attribute a smaller case boundary before a
 * more distant aggregate. The owner supplies its authenticated group. */
export function memoryAncestors(group:string,read:(group:string)=>{max:number;oom:number}):AncestorMemory[]{
  if(!group.startsWith('/')||group==='/'||group.split('/').includes('..'))throw Error('resident cap: invalid worker ancestry');
  const rows:AncestorMemory[]=[];
  for(let at=group.slice(0,group.lastIndexOf('/'))||'/';;at=at.slice(0,at.lastIndexOf('/'))||'/'){
    // The cgroup root has no memory.max and cannot impose an ancestor cap.
    if(at==='/')return rows;
    const value=read(at);rows.push({group:at,limit:value.max,oom:value.oom});
  }
}
