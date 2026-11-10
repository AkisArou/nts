// One population allowance, consumed by both execution entry points.
export const ORACLE_EXECUTION_POLICY={
  version:2,
  cpuSeconds:15,
  benchmarkCpuSeconds:60,
  residentBytes:2147483648,
  // V8's JavaScript heap limit in every oracle child. oracle-toolchain.json's
  // execution flags set an old space of half the resident bound and a 16 MiB
  // semi-space, and V8 sizes the heap as the old space and three semi-spaces:
  // 1,072 MiB, the limit node chose itself in that scope. Set, not derived,
  // so neither the cgroup nor an inherited NODE_OPTIONS moves it.
  heapBytes:1124073472,
} as const;
