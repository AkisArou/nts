// Existing collisions are named, never allowed by count: fixing one cannot
// spend its allowance on a new collision. This list only shrinks.
export const KNOWN_DUPLICATE_RECORDS=["0099","0102","0116","0120"] as const;

export function recordNumbers(names:readonly string[],known:readonly string[]=KNOWN_DUPLICATE_RECORDS) {
  const files=new Map<string,string[]>();
  for(const name of [...names].sort()) {
    const number=/^[0-9]{4}/.exec(name)?.[0];
    if(number)files.set(number,[...(files.get(number)??[]),name]);
  }
  const duplicates=[...files].filter(([,names])=>names.length>1);
  return {
    count:[...files.values()].reduce((count,names)=>count+names.length,0),
    unexpected:duplicates.filter(([number])=>!known.includes(number)),
    stale:known.filter(number=>!duplicates.some(([duplicate])=>duplicate===number)),
  };
}

