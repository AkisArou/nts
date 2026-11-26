// Authority belongs to a module, never to a line copied into an exception list.
// These are live adapters with an explicit observation/environment interface.
import type {HostReadKind} from './test-host-audit.ts';
export const HOST_READ_OWNERS: Readonly<Record<string,{reason:string;kinds:readonly HostReadKind[];generatedKinds?:readonly HostReadKind[]}>> = {
  'tooling/gate/host-observations.ts':{reason:'Complete resource capability; fixtures cannot fill a missing field from the host.',kinds:['disk','machine','kernel','clock']},
  'tooling/gate/cgroup-read-audit.ts':{reason:'Cgroup path-prefix matching in source data, with no native reads. The separate fs-read rule still checks this module.',kinds:['kernel']},
  'tooling/gate/check-stream.ts':{reason:'Unix socket binding through the runner-owned temporary directory descriptor at /proc/<self>/fd/<acquired-fd>; no process discovery, host sampling or admission facts.',kinds:['kernel']},
  'tooling/gate/cgroup-files-fixture.ts':{reason:'Complete supplied cgroup file adapter for the admission CLI race. Only the synthetic scope is substituted; unrelated native ownership paths retain live safety observations.',kinds:[],generatedKinds:['kernel']},
  'tooling/gate/rust-child-loader.ts':{reason:'Only the stopped image executable through /proc/<tid>/exe after the native task mount/root fence. Captured exec environment supplies loader facts; the explicit canonical launch environment supplies host tools. One owned persistent helper, never analysis-time lookup or admission.',kinds:['kernel','environment']},
  'tooling/gate/active-process.ts':{reason:'Command observations and process-group birth identity; fixture observations replace the entire sampler.',kinds:['kernel']},
  'tooling/differential/process-stat/main.ts':{reason:'The one reader and strict parser of process and task stat records, with fs captured at load for the sealed oracle child; callers choose their unreadable-record policy explicitly.',kinds:['kernel']},
  'tooling/gate/process-group.ts':{reason:'Birth identity and signalling for a detached child captured directly at spawn; no discovered process gains signal authority.',kinds:['kernel']},
  'tooling/landing/tree-users.ts':{reason:'Read-only tree ownership by process UID, birth, cgroup, cwd, executable and open descriptors. Controls supply a complete proc tree or explicitly select live kernel ownership; no signalling authority.',kinds:['kernel']},
  'tooling/gate/scopes/memory-limits.ts':{reason:'Only memory.max, memory.high, memory.swap.max, memory.events and memory.events.local of created or named worker scopes and their enclosing limits, for physical verification and kill attribution; never admission or unrelated host state.',kinds:['kernel']},
  'tooling/gate/scopes/cpu-limits.ts':{reason:'Identity-fenced cpu.max, cpu.stat and cpu.weight of one acquired cgroup (an experiment scope, or a ranked unit under a kernel control); a complete supplied observation replaces every read and identity, with no fallback. Never gate admission or verdict policy.',kinds:['kernel']},
  'tooling/gate/measurement.ts':{reason:'MeasurementIO owns CPU quietness observations; controls supply the complete IO.',kinds:['kernel','clock']},
  'tooling/gate/affinity/main.ts':{reason:'Affinity command forwards the explicitly owned gate tree-lock descriptor across scope entry.',kinds:['environment']},
  'tooling/gate/host-environment.ts':{reason:'Canonical host capability selection and owned child temporary handoffs; no image preparation.',kinds:['environment']},
  'tooling/gate/canonical-environment.ts':{reason:'Canonical environment construction and named production capabilities.',kinds:['environment','clock']},
  'tooling/differential/oracle-seal/main.ts':{reason:'Immutable run-seal authentication and its hit telemetry; no clock value decides a seal verdict.',kinds:['clock']},
  'tooling/gate/test-host-bootstrap.ts':{reason:'Adversarial launcher input goes through the allowlist before grants enter a test worker.',kinds:['environment']},
  'tooling/gate/test-environment.ts':{reason:'Fixture allowlist, private state and named handoffs.',kinds:['environment']},
  'tooling/gate/cache-capabilities.ts':{reason:'A named cache grant is required before any production resolver.',kinds:[]},
  'tooling/gate/cache-environment.ts':{reason:'Production account cache locations; fixture nesting copies declared names only.',kinds:[]},
  'tooling/gate/cargo.ts':{reason:'Cargo configuration discovery and before/after refusal; the declared complete cache remains shared.',kinds:['environment']},
  'tooling/gate/test-wait.ts':{reason:'Readiness barrier hang guards report an unfinished measurement, never an assertion result.',kinds:['clock']},
  'tooling/gate/process-stat-audit.test.ts':{reason:'Process stat path strings are mutation inputs to the audit, never executed.',kinds:[],generatedKinds:['kernel']},
  'tooling/gate/test-host-audit.test.ts':{reason:'Unsafe source strings are mutation inputs to the audit, never executed.',kinds:[],generatedKinds:['disk','machine','kernel','clock','environment']},
};
