// The shell command is independent of the library imported by runner scopes.
import {spawnSync} from 'node:child_process';
import {runAsCommand} from '../../differential/command-entry/main.ts';
import {cpuList,defaultCpus,gateCpus,gateScope,inheritedCpus,scopeArgs,verifyCeiling} from '../affinity.ts';
// pinned.sh changes its own mask before starting any build, so every child
// inherits the reservation, including a hand-started full run.
runAsCommand(import.meta.url,()=>{
  const argument = (index: number): string => {
    const value = process.argv[index];
    if (value === undefined || value === "") throw new Error(`affinity: missing argument ${index - 2}`);
    return value;
  };
  if (process.argv[2] === "--gate-cpus") {
    if (process.platform === "linux") console.log(gateCpus(inheritedCpus(Number(argument(3)))));
  } else if (process.argv[2] === "--default-cpus") {
    const preferred = argument(3);
    console.log(process.platform === "linux" ? defaultCpus(preferred, inheritedCpus(Number(argument(4)))) : preferred);
  } else if (process.argv[2] === "--scope-mechanism") {
    const scope = gateScope(argument(3), Number(argument(4)));
    console.log(`${scope.kind}:${scope.reason}`);
  } else if (process.argv[2] === "--verify-ceiling") {
    if (!verifyCeiling(argument(3), Number(argument(4)))) {
      console.error("gate: requested cpuset ceiling is absent on scope entry");
      process.exitCode = 75;
    }
  } else if (process.argv[2] === "--launch-scope") {
    const cpus = argument(3);
    cpuList(cpus);
    // A caller can hold pinned.sh's tree lock across setup and execution.
    // Preserve that open description when entering the cpuset scope.
    const child = spawnSync("systemd-run", [...scopeArgs(cpus), "taskset", "-c", cpus, ...process.argv.slice(4)], {
      stdio: process.env.NTS_GATE_LOCK_FD === "8" ? ["inherit","inherit","inherit",null,null,null,null,null,8] : "inherit",
    });
    // This is the actual command, not a capability probe. Never retry it.
    if (child.error) console.error(`gate: scope launch failed: ${child.error.message}`);
    process.exitCode = child.status ?? 1;
  } else {
    throw new Error("usage: affinity/main.ts --gate-cpus <pid> | --default-cpus <preferred> <pid> | --scope-mechanism <cpus> <pid> | --verify-ceiling <cpus> <pid> | --launch-scope <cpus> <command...>");
  }
});
