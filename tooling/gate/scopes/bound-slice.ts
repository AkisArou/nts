// A slice bound to the unit that owns its run, so it stops when that unit
// stops and never outlives it: the gate's step slices bind to their run's
// root, that root and a census's aggregate to the unit their process runs
// in, and a census's worker slices to their aggregate (#633). Before this,
// a census's slices bound to nothing and a census killed mid-run left them
// loaded for ever.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkedUnitName, childSlice, unitComponent } from "../tooling-slice.ts";
import { ToolingInstrumentError } from "../step-result.ts";

/**
 * The user-manager unit this process runs in, from its cgroup: the last
 * component below `user@<uid>.service`, when it names a scope or service.
 * `undefined` outside a user manager's subtree, or directly in a slice:
 * there is no user-manager unit to bind to. Owned tooling setup refuses
 * that result and names the user-scope command to run instead.
 */
export function ownUnit(cgroup: string = readFileSync("/proc/self/cgroup", "utf8")): string | undefined {
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

const SLICE_SETUP_HANG_MS=30_000;
const checked=(command:string,args:string[]):string=>{
  const result=spawnSync(command,args,{encoding:'utf8',timeout:SLICE_SETUP_HANG_MS});
  if(result.error||result.signal||result.status!==0)throw Error(`${command} ${args[0]}: ${result.stderr||result.error?.message||result.signal||result.status}`);
  return result.stdout.trim();
};

/** Create the policy before any member starts. The owner keeps an empty
 * start alive; systemd stops the whole hierarchy when that owner unit ends. */
export function startBoundSlice(slice:string,boundTo:string,limits?:{max:number}):string{
  if(!boundTo)throw new ToolingInstrumentError('tooling-setup','tooling slice requires a bound owner');
  checkedUnitName(slice);checkedUnitName(boundTo);
  let created=false;
  const memory=limits?['MemoryMax','t',String(limits.max),'MemorySwapMax','t','0']:[];
  const binds=bindsToProperties(boundTo);
  const control=(...args:string[])=>checked('systemctl',['--user',...args]);
  try{
    checked('busctl',['--user','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager',
      'StartTransientUnit','ssa(sv)a(sa(sv))',slice,'fail',String(3+memory.length/3+binds.length/4),'Description','s','nts owned tooling run',
      'StopWhenUnneeded','b','false','CollectMode','s','inactive-or-failed',...binds,...memory,'0']);
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
