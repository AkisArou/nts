// These are semi-public constants exposed to any third-party renderers.
// Only expose the minimal subset necessary to implement a host config.
export {
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  IdleEventPriority,
  NoEventPriority,
} from "./ReactEventPriorities.ts";
export { ConcurrentRoot, LegacyRoot } from "./ReactRootTags.ts";
