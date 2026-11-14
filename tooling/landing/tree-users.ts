// The processes that use a tree: their working directory, their executable or
// one of their open files is the tree or under it. Read from /proc and never
// signalled. A landing gives a task's pool tree back only once nothing uses it
// (pool.ts's release): a tree reset under a process still running in it
// changes the files that process reads, and its results look like defects.
import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** A process that uses a tree, and how: "its working directory", "its executable <path>", "an open file <path>". */
export type TreeUser = { pid: number; command: string; where: string };

/**
 * Every process this user can read whose working directory, executable or an
 * open file is `tree` or under it, by pid; never the process that asks. A
 * process another user owns, or one that ends while it is read, is skipped.
 */
export function treeUsers(tree: string, { proc = "/proc", self = process.pid }: { proc?: string; self?: number } = {}): TreeUser[] {
  let root: string;
  try { root = realpathSync(tree); } catch { return []; }
  // A file deleted while open reads as "<path> (deleted)": it was still in the tree.
  const under = (target: string) => { const path = target.replace(/ \(deleted\)$/, ""); return path === root || path.startsWith(root + sep) ? path : null; };
  const shown = (path: string) => relative(root, path) || ".";
  const link = (pid: string, name: string) => { try { return readlinkSync(join(proc, pid, name)); } catch { return null; } };
  let pids: string[];
  try { pids = readdirSync(proc).filter(name => /^[1-9][0-9]*$/.test(name)); } catch { return []; }
  const users: TreeUser[] = [];
  for (const pid of pids) {
    if (Number(pid) === self) continue;
    let where: string | null = null;
    const cwd = link(pid, "cwd");
    if (cwd !== null && under(cwd) !== null) where = "its working directory";
    const exe = where === null ? link(pid, "exe") : null;
    const ran = exe === null ? null : under(exe);
    if (ran !== null) where = `its executable ${shown(ran)}`;
    if (where === null) {
      let fds: string[] = [];
      try { fds = readdirSync(join(proc, pid, "fd")); } catch { continue; }
      for (const fd of fds) {
        const target = link(pid, join("fd", fd)), open = target === null ? null : under(target);
        if (open !== null) { where = `an open file ${shown(open)}`; break; }
      }
    }
    if (where === null) continue;
    let command = "?";
    try { command = readFileSync(join(proc, pid, "comm"), "utf8").trim() || "?"; } catch { /* it ended */ }
    users.push({ pid: Number(pid), command, where });
  }
  return users.sort((a, b) => a.pid - b.pid);
}

/** The users in words: "pid 123 zsh (its working directory), pid 456 node (an open file target/x)", the first `most` and how many more. */
export function describeUsers(users: readonly TreeUser[], most = 3): string {
  const named = users.slice(0, most).map(user => `pid ${user.pid} ${user.command} (${user.where})`);
  return users.length > most ? `${named.join(", ")} and ${users.length - most} more` : named.join(", ");
}

const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const under=(root:string,path:string)=>path===root||path.startsWith(root+sep);
/** Read-only cgroup provenance; it carries no signalling or membership authority. */
export function processCgroup(pid:number,proc='/proc'):string{return readFileSync(join(proc,String(pid),'cgroup'),'utf8');}

class ProcessUse extends Error{}
/** Readable owners always count. Non-dumpable processes outside nts cannot be
 * tool owners; their readable cgroup provenance is retained in the audit.
 * Unreadable nts processes or cgroups refuse. This grants no signal authority. */
export function assertNoProcessUsers(roots:readonly string[],proc='/proc'):string[]{
  const uid=process.getuid?.();
  const ignored:string[]=[],unreadable:Error[]=[];
  for(const pid of readdirSync(proc).filter(name=>/^[1-9][0-9]*$/.test(name))){
    const dir=join(proc,pid);
    let birth:string;
    try{
      // A non-dumpable process may expose root-owned /proc inodes despite
      // retaining this user's real UID. The readable status owns that answer.
      const status=readFileSync(join(dir,'status'),'utf8'),owner=/^Uid:\s+(\d+)\s+\d+\s+\d+\s+\d+$/m.exec(status);
      if(!owner)throw Error('process has no UID observation');
      if(Number(owner[1])!==uid)continue;
      const fields=readFileSync(join(dir,'stat'),'utf8').split(') ').at(-1)!.split(' ');
      if(fields[0]==='Z'||fields[0]==='X')continue;
      birth=fields[19]!;
    }catch(error){if(missing(error))continue;unreadable.push(Error('unreadable process ownership '+dir,{cause:error}));continue;}
    try{
      const links=['cwd','exe',...readdirSync(join(dir,'fd')).map(fd=>'fd/'+fd)];
      for(const link of links){
        let path:string;
        try{path=readlinkSync(join(dir,link)).replace(/ \(deleted\)$/,'');}
        catch(error){if(missing(error)&&link.startsWith('fd/'))continue;throw error;}
        if(roots.some(root=>under(resolve(root),path)))throw new ProcessUse('process '+pid+' owns '+link+' in '+path);
      }
    }catch(error){
      if(error instanceof ProcessUse)throw error;
      let current:string;
      try{const fields=readFileSync(join(dir,'stat'),'utf8').split(') ').at(-1)!.split(' ');if(fields[0]==='Z'||fields[0]==='X')continue;current=fields[19]!;}
      catch(again){if(missing(again))continue;unreadable.push(Error('unreadable process ownership '+dir,{cause:error}));continue;}
      if(current!==birth)continue;
      try{
        const cgroup=readFileSync(join(dir,'cgroup'),'utf8');
        const lines=cgroup.trim().split('\n'),group=lines.length===1&&/^0::(\/.*)$/.exec(lines[0]!)?.[1];
        if(!group||group.split('/').some(part=>part==='.'||part==='..'))throw Error('invalid unified cgroup identity');
        const denied=['EACCES','EPERM'].includes((error as NodeJS.ErrnoException).code??'');
        if(denied&&!group.split('/').some(part=>/^nts(?:[.-]|$)/.test(part))){
          const command=readFileSync(join(dir,'comm'),'utf8').trim();
          ignored.push('ignored non-dumpable outside nts: pid '+pid+' '+command+'; birth '+birth+'; cgroup '+group);
          continue;
        }
        throw Error('live unreadable tool process '+pid+'; cgroup '+group+': '+errorText(error));
      }catch(reason){unreadable.push(Error('disk reclamation keeps unreadable process '+pid+': '+errorText(reason),{cause:error}));}
    }
  }
  if(unreadable.length)throw new AggregateError(unreadable,'disk reclamation keeps root: '+unreadable.map(error=>error.message).join('; '));
  return ignored;
}

