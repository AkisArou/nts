// Read-only process guard shared by explicit cleanup and post-landing upkeep.
import { readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
export type ProcessOptions = { procRoot?: string; readCwd?: (path: string) => string; onExemption?: (detail: Record<string, unknown>) => void };
function canonical(path: string): string { try { return realpathSync(path); } catch { return resolve(path); } }
function within(root: string, path: string): boolean { const r = relative(resolve(root), resolve(path)); return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r); }
export function processesInTree(path: string, options: ProcessOptions = {}): string[] {
  const found: string[] = [];
  // Dependency injection keeps isolated tests independent of unrelated host
  // sessions. The CLI always uses the real /proc and fails closed on EACCES.
  const proc = options.procRoot ?? "/proc";
  const readCwd = options.readCwd ?? readlinkSync;
  const managers = new Set<string>();
  const exemptManager = (pid: string): boolean => {
    if (managers.has(pid)) return true;
    try {
      if (readFileSync(join(proc, pid, "comm"), "utf8") !== "systemd\n" || readFileSync(join(proc, pid, "cmdline"), "utf8") !== "/usr/lib/systemd/systemd\0--user\0") return false;
      try { readCwd(join(proc, pid, "cwd")); return false; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EACCES") return false; }
    } catch { return false; }
    managers.add(pid);
    options.onExemption?.({ pid, comm: "systemd", cmdline: "/usr/lib/systemd/systemd\0--user\0", reason: "non-dumpable systemd user manager; cwd is outside worktrees" });
    return true;
  };
  for (const pid of readdirSync(proc).filter(s => /^\d+$/.test(s))) {
    try {
      const cwd = readCwd(join(proc, pid, "cwd"));
      const alternatives = [cwd, ...(cwd.endsWith(" (deleted)") ? [cwd.slice(0, -10)] : [])];
      if (alternatives.some(c => within(canonical(path), canonical(c)))) found.push(pid);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EACCES") {
        // MainClaude / user, Orcode 49111f12, 2026-10-23: these login
        // daemons are non-dumpable and chdir to the user's home, outside
        // candidate trees. No other unreadable process gets this exemption.
        let comm: string | undefined;
        try { comm = readFileSync(join(proc, pid, "comm"), "utf8").replace(/\n$/, ""); } catch {}
        // MainClaude / user, Orcode d523f4f9, 2026-10-23: only this
        // exact user-manager command is also known to live outside trees.
        if (comm === "systemd" && exemptManager(pid)) continue;
        // Orcode 56b10d2c: the exact PAM helper must also have a parent
        // independently verified and logged as an exempt user manager.
        let pamParent: string | undefined;
        if (comm === "(sd-pam)") try {
          const parent = /^PPid:\s*(\d+)$/m.exec(readFileSync(join(proc, pid, "status"), "utf8"))?.[1];
          if (parent && readFileSync(join(proc, pid, "cmdline"), "utf8") === "(sd-pam)\0" && exemptManager(parent)) pamParent = parent;
        } catch {}
        if (comm === "sshd-session" || comm === "sshd" || pamParent) {
          options.onExemption?.({ pid, comm, ...(pamParent ? { parent: pamParent, cmdline: "(sd-pam)\0" } : {}), reason: pamParent ? "PAM helper of the verified user manager; cwd is outside worktrees" : "non-dumpable SSH login daemon; cwd is the user's home" });
          continue;
        }
      }
      try { if (["EACCES", "EPERM"].includes((e as NodeJS.ErrnoException).code ?? "") && statSync(join(proc, pid)).uid === process.getuid?.()) throw new Error(`Cannot inspect own-user PID ${pid}`); }
      catch (inner) { if ((inner as Error).message.startsWith("Cannot inspect")) throw inner; }
    }
  }
  return found;
}
