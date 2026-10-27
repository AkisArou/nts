// The existing pinned.sh tree lock, held across setup and gate execution.
// Acquire this before the landing lock. A snapshot only tries the latter:
// an older lander may hold it while waiting for pinned.sh's tree lock.
import { spawnSync, type StdioOptions } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const HANDOFF = 8;
export function supportsResourceHandoff(root: string): boolean {
  return readFileSync(join(root,"tooling/gate/pinned.sh"),"utf8").includes("\n# nts-gate-tree-lock-handoff: 8\n");
}
export class GateResource {
  readonly fd: number;
  private constructor(fd: number) { this.fd = fd; }
  static tryAcquire(path: string): GateResource | null {
    mkdirSync(dirname(path), {recursive:true});
    const resource = new GateResource(openSync(path,"a"));
    const locked = spawnSync("flock",["-n","-E","75",String(HANDOFF)],{stdio:resource.stdio("pipe")});
    if (locked.status === 0) return resource;
    resource.close();
    if (locked.status === 75) return null;
    throw new Error(`cannot lock gate resource ${path}: ${locked.error?.message ?? locked.stderr?.toString()}`);
  }
  static inherited(path: string): GateResource | null {
    if (process.env.NTS_GATE_LOCK_FD !== String(HANDOFF)) return null;
    const descriptor=fstatSync(HANDOFF), file=statSync(path);
    if (descriptor.dev !== file.dev || descriptor.ino !== file.ino) throw new Error("gate lock descriptor names another file");
    const resource=new GateResource(HANDOFF);
    const locked=spawnSync("flock",["-n","-E","75",String(HANDOFF)],{stdio:resource.stdio("pipe")});
    if (locked.status !== 0) throw new Error("gate lock descriptor is not held");
    return resource;
  }
  stdio(output: "pipe" | "inherit"): StdioOptions {
    const descriptors: StdioOptions = ["ignore",output,output,null,null,null,null,null,this.fd];
    return descriptors;
  }
  env(): NodeJS.ProcessEnv { return {...process.env,NTS_GATE_LOCK_FD:String(HANDOFF)}; }
  close(): void { closeSync(this.fd); }
}
