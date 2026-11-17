// A slice bound to the unit that owns its run, so it stops when that unit
// stops and never outlives it: the gate's step slices bind to their run's
// root, that root and a census's aggregate to the unit their process runs
// in, and a census's worker slices to their aggregate (#633). Before this,
// a census's slices bound to nothing and a census killed mid-run left them
// loaded for ever.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkedUnitName, childSlice, toolingSliceArgs, unitComponent } from "../tooling-slice.ts";
import { ToolingInstrumentError } from "../step-result.ts";
import { CPU_WEIGHT, RANK_SLICE, type Priority } from "../ranks.ts";

/**
 * The user-manager unit this process runs in, from its cgroup: the last
 * component below `user@<uid>.service`, when it names a scope or service.
 * `undefined` outside a user manager's subtree, or directly in a slice:
 * there is no user-manager unit to bind to. Owned tooling setup refuses
 * that result and names the user-scope command to run instead.
 */
/** This process's own cgroup line, as the kernel lists it: the one place this module reads it. */
function selfCgroup(): string {
  return readFileSync("/proc/self/cgroup", "utf8");
}

export function ownUnit(cgroup: string = selfCgroup()): string | undefined {
  const parts = cgroup.trim().replace(/^0::/, "").split("/").filter(Boolean);
  const manager = parts.findIndex(part => /^user@\d+\.service$/.test(part));
  if (manager < 0) return undefined;
  const own = parts.at(-1)!;
  return manager < parts.length - 1 && /^[a-zA-Z0-9_.:@-]+\.(?:scope|service)$/.test(own) ? own : undefined;
}

/** A library cannot re-execute its caller safely; give a shell the exact route. */
export function requireOwnUnit(cgroup?:string):string{
  const unit=ownUnit(cgroup);
  if(unit)return unit;
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  const command=[process.execPath,...process.execArgv,...process.argv.slice(1)].map(quote).join(' ');
  throw new ToolingInstrumentError('tooling-setup','tooling slice requires a user-manager scope or service; rerun the same command in one: systemd-run --user --scope --unit=nts-tooling-'+unitComponent('r')+' -- '+command);
}

/** Whether a process's cgroup (`/proc/<pid>/cgroup`'s text) lies under `nts.slice`, among every rank's work. */
export function underRankSlice(cgroup: string = selfCgroup()): boolean {
  return cgroup.trim().replace(/^0::/, "").split("/").includes(RANK_SLICE);
}

/**
 * The `systemd-run` arguments, up to and including `--`, that run a job's
 * command in a scope of its own among every rank's work, at `rank`'s CPU
 * weight (tooling-slice.ts's `toolingSliceArgs`), bound to the unit this
 * process runs in, so stopping that unit stops the job as before. systemd-run
 * moves itself into the scope and then becomes the command: its pid, its
 * descriptors and its signals are the command's own. `memoryMax` caps the
 * scope (and allows no swap). Null when nothing needs a scope: no cap, and
 * this process already runs under `nts.slice`, inside a run that carries its
 * rank. Outside a user-manager unit there is nothing to bind to, and it
 * refuses with the command to run instead (`requireOwnUnit`).
 */
export function rankedScopeArgs(rank: Priority, env: NodeJS.ProcessEnv = process.env,
  options: { memoryMax?: string; cgroup?: string } = {}): string[] | null {
  const cgroup = options.cgroup ?? selfCgroup();
  if (options.memoryMax === undefined && underRankSlice(cgroup)) return null;
  const owner = requireOwnUnit(cgroup);
  const memory = options.memoryMax === undefined ? [] : [`--property=MemoryMax=${options.memoryMax}`, "--property=MemorySwapMax=0"];
  return ["--user", "--scope", "--quiet", "--collect", ...toolingSliceArgs(env, rank),
    `--property=BindsTo=${owner}`, `--property=After=${owner}`, ...memory, "--"];
}

const SLICE_SETUP_HANG_MS=30_000;
const checked=(command:string,args:string[]):string=>{
  const result=spawnSync(command,args,{encoding:'utf8',timeout:SLICE_SETUP_HANG_MS});
  if(result.error||result.signal||result.status!==0)throw Error(`${command} ${args[0]}: ${result.stderr||result.error?.message||result.signal||result.status}`);
  return result.stdout.trim();
};

/** Whether systemd places `slice` directly under `nts.slice`, where every
 * rank's runs compete: its name has one component after `nts-`. */
export function rankRoot(slice:string):boolean{
  return /^nts-[^-]+\.slice$/.test(slice);
}

/**
 * The `StartTransientUnit` property, as busctl `(sv)` elements, that gives a
 * root slice its rank's CPU weight (ranks.ts): none for a slice nested in a
 * run, which shares its run's root's. Every root carries one, so no root is
 * left at a weight its rank does not have.
 */
export function rankProperties(slice:string,rank:Priority):string[]{
  return rankRoot(slice)?['CPUWeight','t',String(CPU_WEIGHT[rank])]:[];
}

/** Create the policy before any member starts. The owner keeps an empty
 * start alive; systemd stops the whole hierarchy when that owner unit ends.
 * A root, under `nts.slice` beside every rank's runs, takes the CPU weight of
 * the `rank` its launcher's code names; a root without one is refused before
 * anything is created, so no run competes at a rank nobody chose. A slice
 * nested in a run shares its root's weight. */
export function startBoundSlice(slice:string,boundTo:string,policy:{max?:number;rank?:Priority}={}):string{
  if(!boundTo)throw new ToolingInstrumentError('tooling-setup','tooling slice requires a bound owner');
  checkedUnitName(slice);checkedUnitName(boundTo);
  if(rankRoot(slice)&&policy.rank===undefined)throw new ToolingInstrumentError('tooling-setup',`root slice ${slice} names no rank: a run under nts.slice competes at its rank's CPU weight (ranks.ts)`);
  let created=false;
  const memory=policy.max!==undefined?['MemoryMax','t',String(policy.max),'MemorySwapMax','t','0']:[];
  const cpu=policy.rank===undefined?[]:rankProperties(slice,policy.rank);
  const binds=bindsToProperties(boundTo);
  const control=(...args:string[])=>checked('systemctl',['--user',...args]);
  try{
    checked('busctl',['--user','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager',
      'StartTransientUnit','ssa(sv)a(sa(sv))',slice,'fail',String(3+memory.length/3+cpu.length/3+binds.length/4),'Description','s','nts owned tooling run',
      'StopWhenUnneeded','b','false','CollectMode','s','inactive-or-failed',...binds,...memory,...cpu,'0']);
    created=true;
    control('start',slice);
    const group=control('show',slice,'--property=ControlGroup','--value');
    if(!group.startsWith('/')||!group.endsWith('/'+slice)||group.split('/').includes('..'))throw Error('step slice has no exact cgroup identity');
    return group;
  }catch(error){
    if(created)try{control('stop',slice);}catch(cleanup){throw new AggregateError([error,cleanup],`step slice setup and cleanup failed: ${slice}`);}
    throw error;
  }
}

/**
 * The `StartTransientUnit` properties that bind a slice to `unit`, as
 * busctl `(sv)` elements, four per property: `BindsTo` (the slice stops
 * when the unit does) with the `After` that orders that stop after the
 * unit's. None when there is no unit to bind to.
 */
export function bindsToProperties(unit: string | undefined): string[] {
  return unit ? ["BindsTo", "as", "1", unit, "After", "as", "1", unit] : [];
}

/** The retained worker boundary is a sibling of the step's supervisor. */
export function stepWorkersSlice(stepSlice: string): string {
  return childSlice(stepSlice, "w");
}
