// Ancestry decides stack order; submission time only orders unrelated tips.
export type QueuedTip={id:string;sha:string;at:number};
export type Composed<T>={entry:T;prerequisites:T[];from?:string};
export function compose<T extends QueuedTip>(entries:readonly T[],isAncestor:(a:string,b:string)=>boolean):Composed<T>[] {
 const ordered:T[]=[],pending=[...entries].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 if(new Set(pending.map(e=>e.id)).size!==pending.length)throw new Error("duplicate submission identity");
 const cache=new Map<string,boolean>();
 const before=(a:T,b:T)=>{if(a.sha===b.sha)return false;const key=a.sha+":"+b.sha;if(!cache.has(key))cache.set(key,isAncestor(a.sha,b.sha));return cache.get(key)!;};
 while(pending.length) {
  const index=pending.findIndex(tip=>!pending.some(other=>before(other,tip)));
  if(index<0)throw new Error("submission ancestry is cyclic or inconsistent");
  ordered.push(pending.splice(index,1)[0]);
 }
 return ordered.map(entry=>{
  const prerequisites=ordered.filter(other=>before(other,entry));
  const nearest=prerequisites.filter(ancestor=>!prerequisites.some(other=>before(ancestor,other)));
  // Equal queued tips are aliases. Converging merge parents retain the
  // existing merge replay path; a linear stack has one own-range boundary.
  const boundaries=[...new Set(nearest.map(e=>e.sha))];
  return {entry,prerequisites,...(boundaries.length===1?{from:boundaries[0]}:{})};
 });
}
