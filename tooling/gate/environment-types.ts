// Canonical handoff data has no preparation or runtime acquisition edge.
import type {NodeResolutionRun} from '../differential/oracle-runtime.ts';
import type {RunTemporary} from './run-temporary.ts';
import type {JdkChoice} from './jdk.ts';
import type {HostObservations} from './host-observations.ts';
export type EnvironmentReport = {
  version: 1; canonical: boolean; host: Record<string, string | null>;
  ambient: Record<string, string | null>; dropped: string[];
  experiments: { name: string; value: string }[];
  /** The JDK the run uses, when its tree declares one (jdk.ts). */
  jdk?: JdkChoice;
};
export type Context = { report: EnvironmentReport; owned: Record<string, string>; temporary:RunTemporary;resolutionOwner?:NodeResolutionRun };
export type {Context as GateEnvironmentContext};
/** In-process ownership; the observation object never enters Context's wire. */
export type GateEnvironment = { env: NodeJS.ProcessEnv; report: EnvironmentReport; temporary:RunTemporary; observations:HostObservations };

