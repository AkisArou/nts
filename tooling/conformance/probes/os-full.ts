// The rest of `os`'s native half that can currently cross the boundary.
//
// `probes/os.ts` covers two of eighteen. This adds ten more. Three are absent
// and named here rather than silently skipped: `nts_os_cpus`,
// `nts_os_constants` and `nts_os_network_interfaces` all return a *heterogeneous*
// tuple, which the compiler gives a `NtsObj_TupleNN *` return type while their C
// returns `NtsArray *` -- see `blockers/heterogeneous-tuple-return`. They cannot
// be probed until that is settled, and they are the three that make `os` fail
// three of its seven compiled tests.
//
// Declarations here are copied from `runtime/node/os/src/main.ts` verbatim. An
// earlier draft of this file spelled `nts_os_static_information` as
// `[string[], string[]]` when it is seven scalars, which is exactly the
// declaration-vs-implementation mismatch these probes exist to catch -- a probe
// that declares its own contract measures its own contract.
//
// Exports are `probe`-prefixed because an exported symbol sharing a libc name is
// silently replaced by libc's.
declare function nts_os_static_information(): [
  string,
  string,
  string,
  string,
  string,
  string,
  "BE" | "LE",
];
declare function nts_os_homedir(): string;
declare function nts_os_uptime(): number;
declare function nts_os_totalmem(): number;
declare function nts_os_freemem(): number;
declare function nts_os_available_parallelism(): number;
declare function nts_os_loadavg(): [number, number, number];
declare function nts_os_user_info(): [number[], number[], number[], number[]];
declare function nts_os_udp_reuseaddr(): number;
declare function nts_os_get_priority(pid: number): number;

export function probeHomedir(): string {
  return nts_os_homedir();
}

export function probeUptime(): number {
  return nts_os_uptime();
}

export function probeTotalmem(): number {
  return nts_os_totalmem();
}

export function probeFreemem(): number {
  return nts_os_freemem();
}

export function probeParallelism(): number {
  return nts_os_available_parallelism();
}

/** All three figures, so a probe cannot pass on one and hide two. */
export function probeLoadavgShape(): string {
  const load = nts_os_loadavg();
  return `${load.length}:${load[0] >= 0}:${load[1] >= 0}:${load[2] >= 0}`;
}

export function probeLoadavgFirst(): number {
  return nts_os_loadavg()[0];
}

// `[identity, usernameBytes, homedirBytes, shellBytes]`, and `identity` is
// `[uid, gid, hasShell]` -- read off os/src/main.ts:412 rather than guessed. The
// first draft took column 1 for the gid and got 97, which is ASCII `a` for
// "akisarou": the first byte of the username, a plausible small integer where a
// gid belongs. Nothing about the value said it was the wrong column.
export function probeUserUid(): number {
  return nts_os_user_info()[0][0] ?? -1;
}

export function probeUserGid(): number {
  return nts_os_user_info()[0][1] ?? -1;
}

/** The username, decoded from the byte column node returns as a string. */
export function probeUsernameFirstByte(): number {
  return nts_os_user_info()[1][0] ?? -1;
}

export function probeUdpReuseaddr(): number {
  return nts_os_udp_reuseaddr();
}

export function probeGetPriority(pid: number): number {
  return nts_os_get_priority(pid);
}

// The seven scalars joined, so a wrong column cannot hide behind a right one.
// The order is the *binding's*, which is not node's documented order for the
// equivalent calls: type, **version, release**, machine, arch, platform,
// endianness. The first draft compared against node's order, reported two
// columns swapped, and was wrong -- the shipped addon answers all seven
// correctly because the TypeScript reads them in the binding's order. A probe
// that assumes an order is testing its own assumption.
export function probeStaticJoined(): string {
  const info = nts_os_static_information();
  return `${info[0]}|${info[1]}|${info[2]}|${info[3]}|${info[4]}|${info[5]}|${info[6]}`;
}
