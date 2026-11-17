// Who holds the machine's memory now: each cgroup's resident charge, split
// into what admitted ledger jobs use and what nobody reserved. A request that
// waits says so (memory-ledger.ts), and so does `admit.ts --status`.
//
// **The rows** are the user's cgroups to a bounded depth: the children of the
// user's systemd manager (`user@<uid>.service`), a slice among them expanded
// one level (app.slice, nts.slice: each unit, run root or ranked scope is a
// row), and the manager's siblings in its user slice (a login session).
// An expanded slice keeps a row of its own for the charge its children do not
// hold. Each row's charge is the cgroup's resident charge in MemAvailable's
// currency (host-observations.ts's `cgroupCharge`). Everything not available
// that no row holds -- other users, system services, kernel memory outside
// these cgroups, caches MemAvailable cannot reclaim -- is one remainder.
//
// **Attribution.** An admitted job's measured use arrives as parts, each in
// the cgroup that holds it (memory-ledger.ts's measure: its cgroup's charge,
// and each process of its owner's tree outside that cgroup, in its own
// cgroup). A part belongs to the deepest row that contains its cgroup, so a
// run root inside nts.slice, or a borrower inside its ancestor's measure, is
// counted once, where it lives. The ledger already counts a borrower's
// processes in the borrower's measure only. What a row's charge holds beyond
// its parts is unledgered: processes no reservation counts.
import {CgroupDeparted,HostObservationError,type HostObservations} from './host-observations.ts';
import type {Priority} from './ranks.ts';

/** Bytes a job uses, in the cgroup that holds them; null when the ledger knows no cgroup for them. */
export type HeldPart = {group:string|null;bytes:number};
export type HeldJob = {id:string;what:string;priority:Priority;parts:readonly HeldPart[]};
export type HolderJob = {id:string;what:string;priority:Priority;bytes:number};
export type HolderRow = {cgroup:string;charge_bytes:number;ledgered_bytes:number;unledgered_bytes:number;jobs:HolderJob[]};
export type MemoryHolders = {
  /** The user slice the rows are listed under. */
  root:string;
  not_available_bytes:number;
  /** By charge, largest first. */
  rows:HolderRow[];
  /** Not available, and held by no row. */
  elsewhere_bytes:number;
  /** Ledgered use in no listed row. */
  unplaced:HolderJob[];
};

const MANAGER=/^(\/user\.slice\/user-\d+\.slice)\/(user@\d+\.service)(?:\/|$)/;
const within=(path:string,group:string)=>path===group||path.startsWith(`${group}/`);

/** The user slice and its manager for the cgroup this process runs in; a process outside any user's manager is a named failure. */
export function userManager(own:string):{slice:string;manager:string}{
  const match=MANAGER.exec(own);
  if(!match)throw new HostObservationError(`memory holders: own cgroup ${own} is under no user's systemd manager`);
  return {slice:match[1]!,manager:`${match[1]}/${match[2]}`};
}

/** A row's charge; a cgroup that ended since its listing holds nothing now. */
function chargeOf(host:HostObservations,group:string):number|null{
  try{return host.cgroupCharge(group);}catch(error){if(error instanceof CgroupDeparted)return null;throw error;}
}
function childrenOf(host:HostObservations,group:string):string[]{
  try{return host.cgroupChildren(group);}catch(error){if(error instanceof CgroupDeparted)return [];throw error;}
}

/** The bounded row set: [cgroup, its own charge] with an expanded slice's remainder as its own row. */
function listRows(host:HostObservations,slice:string,manager:string):[string,number][]{
  const rows:[string,number][]=[];
  const add=(group:string,charge:number|null)=>{if(charge!==null)rows.push([group,Math.max(0,charge)]);};
  for(const sibling of childrenOf(host,slice))if(sibling!==manager)add(sibling,chargeOf(host,sibling));
  for(const child of childrenOf(host,manager)){
    const charge=chargeOf(host,child);
    if(charge===null)continue;
    const inner=child.endsWith('.slice')?childrenOf(host,child):[];
    if(!inner.length){add(child,charge);continue;}
    let held=0;
    for(const grandchild of inner){const own=chargeOf(host,grandchild);if(own!==null){add(grandchild,own);held+=Math.max(0,own);}}
    add(child,charge-held);
  }
  return rows;
}

/** The census: a pure reading of supplied observations and the ledger's own measured parts. */
export function memoryHolders(host:HostObservations,jobs:readonly HeldJob[]):MemoryHolders{
  const {slice,manager}=userManager(host.ownCgroup());
  const {availableBytes,totalBytes}=host.memory();
  const listed=listRows(host,slice,manager);
  const rows=new Map<string,HolderRow>(listed.map(([cgroup,charge])=>[cgroup,{cgroup,charge_bytes:charge,ledgered_bytes:0,unledgered_bytes:0,jobs:[]}]));
  // Deepest first: a row that contains another's cgroup only takes what the inner one does not.
  const deepest=[...rows.keys()].sort((a,b)=>b.length-a.length);
  const unplaced=new Map<string,HolderJob>();
  const credit=(into:Map<string,HolderJob>,job:HeldJob,bytes:number)=>{
    const held=into.get(job.id)??{id:job.id,what:job.what,priority:job.priority,bytes:0};held.bytes+=bytes;into.set(job.id,held);
  };
  const byRow=new Map<string,Map<string,HolderJob>>();
  for(const job of jobs)for(const part of job.parts){
    if(!(part.bytes>0))continue;
    const row=part.group===null?undefined:deepest.find(group=>within(part.group!,group));
    if(row===undefined){credit(unplaced,job,part.bytes);continue;}
    const into=byRow.get(row)??new Map<string,HolderJob>();byRow.set(row,into);credit(into,job,part.bytes);
  }
  for(const [cgroup,held] of byRow){
    const row=rows.get(cgroup)!;
    row.jobs=[...held.values()].sort((a,b)=>b.bytes-a.bytes);
    row.ledgered_bytes=row.jobs.reduce((sum,job)=>sum+job.bytes,0);
  }
  for(const row of rows.values())row.unledgered_bytes=Math.max(0,row.charge_bytes-row.ledgered_bytes);
  const ordered=[...rows.values()].sort((a,b)=>b.charge_bytes-a.charge_bytes||a.cgroup.localeCompare(b.cgroup));
  const notAvailable=Math.max(0,totalBytes-availableBytes);
  const charged=ordered.reduce((sum,row)=>sum+row.charge_bytes,0);
  return {root:slice,not_available_bytes:notAvailable,rows:ordered,elsewhere_bytes:Math.max(0,notAvailable-charged),
    unplaced:[...unplaced.values()].sort((a,b)=>b.bytes-a.bytes)};
}

const gib=(bytes:number)=>bytes>=2**30?`${(bytes/2**30).toFixed(1)} GiB`:`${(bytes/2**20).toFixed(1)} MiB`;
const label=(job:HolderJob)=>{const what=job.what.length>60?`${job.what.slice(0,59)}…`:job.what;return `${job.priority} ${what}`;};

/** A row's cgroup as people read it: beneath the user's manager, or beneath its user slice. */
function rowName(holders:MemoryHolders,cgroup:string):string{
  const manager=MANAGER.exec(cgroup);
  return manager&&cgroup.length>manager[0].length?cgroup.slice(manager[0].length).replace(/^\//,''):cgroup.startsWith(`${holders.root}/`)?cgroup.slice(holders.root.length+1):cgroup;
}
/** What a row holds: unledgered, or its ledgered jobs and what is left beside them. */
function rowHeld(row:HolderRow):string{
  if(row.ledgered_bytes===0)return 'unledgered';
  return `ledgered ${row.jobs.map(job=>`${gib(job.bytes)} ${label(job)}`).join(', ')}`+(row.unledgered_bytes>0?`; ${gib(row.unledgered_bytes)} unledgered`:'');
}

/** One line: the `top` rows by charge, each marked ledgered (with its jobs) or unledgered, and the remainder. */
export function describeHolders(holders:MemoryHolders,top=6):string{
  const shown=holders.rows.filter(row=>row.charge_bytes>0).slice(0,top)
    .map(row=>`${rowName(holders,row.cgroup)} ${gib(row.charge_bytes)}${row.ledgered_bytes===0?' unledgered':`: ${rowHeld(row)}`}`);
  const unplaced=holders.unplaced.map(job=>`${gib(job.bytes)} ${label(job)}`).join(', ');
  return `memory: held now, of ${gib(holders.not_available_bytes)} not available: ${shown.join(' | ')||'no cgroup holds any'}`
    +(unplaced?` | ledgered in no listed cgroup: ${unplaced}`:'')
    +`; ${gib(holders.elsewhere_bytes)} outside these cgroups (system, kernel, caches)`;
}

/** The same census as a status table: one row per line, largest first. */
export function describeHolderRows(holders:MemoryHolders,top=12):string[]{
  const rows=holders.rows.filter(row=>row.charge_bytes>0).slice(0,top)
    .map(row=>`    ${gib(row.charge_bytes).padStart(10)}  ${rowName(holders,row.cgroup)}  ${rowHeld(row)}`);
  return [`  held now, of ${gib(holders.not_available_bytes)} not available:`,...rows,
    ...holders.unplaced.map(job=>`    ${gib(job.bytes).padStart(10)}  (no listed cgroup)  ledgered ${label(job)}`),
    `    ${gib(holders.elsewhere_bytes).padStart(10)}  outside these cgroups (system, kernel, caches)`];
}
