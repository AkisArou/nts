// The detached sampler's command-independent flush lifetime.
import {spawnSync} from 'node:child_process';
import {ToolingInstrumentError} from './step-result.ts';
import {checkedUnitName,toolingSlice} from './tooling-slice.ts';
import {ownUnit} from './scopes/bound-slice.ts';

// A history lock waits at most 10 s. A minute leaves startup and disk headroom,
// while a wedged final write cannot retain its scope and output pipe forever.
// Only the post-command flush enters this bounded scope. A healthy long job
// remains in its run's sampling scope until its owner ends.
export const WATCH_FLUSH_SECONDS=60;
export function peakWatcherScope(id:string):string {
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw new TypeError('memory watcher reservation identity is not unit-safe');
  return checkedUnitName(`nts-peak-${id}.scope`);
}
export function peakWatcherFlushScope(unit:string):string {
  if(!/^nts-peak-[A-Za-z0-9_-]+\.scope$/.test(unit))throw new TypeError('memory watcher flush has no owned sampling scope');
  return checkedUnitName(`${unit.slice(0,-6)}-flush.scope`);
}
/** Move only this watcher to a new phase, whose bound begins at creation. */
export function enterWatcherFlush(unit:string,env:NodeJS.ProcessEnv):string {
  const flush=peakWatcherFlushScope(unit),slice=toolingSlice(env);
  const properties=['Description','s','nts memory peak flush','CollectMode','s','inactive-or-failed',
    'PIDs','au','1',String(process.pid),'RuntimeMaxUSec','t',String(WATCH_FLUSH_SECONDS*1e6),
    ...(slice?['Slice','s',slice]:[])];
  const created=spawnSync('busctl',['--user','call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager',
    'StartTransientUnit','ssa(sv)a(sa(sv))',flush,'fail',String(4+(slice?1:0)),...properties,'0'],{env,encoding:'utf8'});
  if(created.error||created.status!==0)throw new ToolingInstrumentError('tooling-setup',
    `memory watcher ${unit} cannot create its flush scope: ${created.error?.message??created.stderr.trim()}`);
  // StartTransientUnit returns before its queued start job completes. This
  // waits for that same job, before any history writer can start.
  const started=spawnSync('systemctl',['--user','start',flush],{env,encoding:'utf8'});
  if(started.error||started.status!==0||ownUnit()!==flush)throw new ToolingInstrumentError('tooling-setup',
    `memory watcher ${unit} did not enter its flush scope ${flush}: ${started.error?.message??started.stderr.trim()}`);
  return flush;
}
