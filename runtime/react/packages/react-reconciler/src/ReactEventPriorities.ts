import type { Lane, Lanes } from "./ReactFiberLane.ts";
import {
  DefaultLane,
  getHighestPriorityLane,
  IdleLane,
  includesNonIdleWork,
  InputContinuousLane,
  NoLane,
  SyncLane,
} from "./ReactFiberLane.ts";

// An event priority is a lane: the one an update scheduled during that event
// gets.
export type EventPriority = Lane;

export const NoEventPriority: EventPriority = NoLane;
export const DiscreteEventPriority: EventPriority = SyncLane;
export const ContinuousEventPriority: EventPriority = InputContinuousLane;
export const DefaultEventPriority: EventPriority = DefaultLane;
export const IdleEventPriority: EventPriority = IdleLane;

export function higherEventPriority(a: EventPriority, b: EventPriority): EventPriority {
  return a !== 0 && a < b ? a : b;
}

export function lowerEventPriority(a: EventPriority, b: EventPriority): EventPriority {
  return a === 0 || a > b ? a : b;
}

export function isHigherEventPriority(a: EventPriority, b: EventPriority): boolean {
  return a !== 0 && a < b;
}

export function eventPriorityToLane(updatePriority: EventPriority): Lane {
  return updatePriority;
}

export function lanesToEventPriority(lanes: Lanes): EventPriority {
  const lane = getHighestPriorityLane(lanes);
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority;
  }
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority;
  }
  if (includesNonIdleWork(lane)) {
    return DefaultEventPriority;
  }
  return IdleEventPriority;
}
