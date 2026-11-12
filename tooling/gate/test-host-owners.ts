// Authority belongs to a module, never to a line copied into an exception list.
// These are live adapters with an explicit observation/environment interface.
import type {HostReadKind} from './test-host-audit.ts';
export const HOST_READ_OWNERS: Readonly<Record<string,{reason:string;kinds:readonly HostReadKind[];generatedKinds?:readonly HostReadKind[]}>> = {
  'tooling/gate/host-observations.ts':{reason:'Complete resource capability; fixtures cannot fill a missing field from the host.',kinds:['disk','machine','kernel','clock']},
  'tooling/gate/active-process.ts':{reason:'Command observations and process-group birth identity; fixture observations replace the entire sampler.',kinds:['kernel']},
  'tooling/gate/scopes/memory-limits.ts':{reason:'Only memory.max, memory.high, memory.swap.max, memory.events and memory.events.local of created or named worker scopes and their enclosing limits, for physical verification and kill attribution; never admission or unrelated host state.',kinds:['kernel']},
  'tooling/gate/measurement.ts':{reason:'MeasurementIO owns CPU quietness observations; controls supply the complete IO.',kinds:['kernel','clock']},
  'tooling/gate/canonical-environment.ts':{reason:'Canonical environment construction and named production capabilities.',kinds:['environment','clock']},
  'tooling/differential/oracle-seal.ts':{reason:'Immutable run-seal authentication and its hit telemetry; no clock value decides a seal verdict.',kinds:['clock']},
  'tooling/gate/test-host-bootstrap.ts':{reason:'Adversarial launcher input goes through the allowlist before grants enter a test worker.',kinds:['environment']},
  'tooling/gate/test-environment.ts':{reason:'Fixture allowlist, private state and named handoffs.',kinds:['environment']},
  'tooling/gate/cache-capabilities.ts':{reason:'A named cache grant is required before any production resolver.',kinds:[]},
  'tooling/gate/cache-environment.ts':{reason:'Production account cache locations; fixture nesting copies declared names only.',kinds:[]},
  'tooling/gate/test-wait.ts':{reason:'Readiness barrier hang guards report an unfinished measurement, never an assertion result.',kinds:['clock']},
  'tooling/gate/test-host-audit.test.ts':{reason:'Unsafe source strings are mutation inputs to the audit, never executed.',kinds:[],generatedKinds:['disk','machine','kernel','clock','environment']},
};
