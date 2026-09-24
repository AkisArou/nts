// Side effects a fiber carries into the commit, as bits. The values are
// upstream's, with the stable channel's feature flags applied
// (enableCreateEventHandleAPI off, enableEffectEventMutationPhase on).
export type Flags = number;

export const NoFlags = 0b0000000000000000000000000000000;
export const PerformedWork = 0b0000000000000000000000000000001;
export const Placement = 0b0000000000000000000000000000010;
export const DidCapture = 0b0000000000000000000000010000000;
export const Hydrating = 0b0000000000000000001000000000000;

// You can change the rest (and add more).
export const Update = 0b0000000000000000000000000000100;
// Set on a cloned host instance (persistent mode) to mean "not the current".
export const Cloned = 0b0000000000000000000000000001000;
export const ChildDeletion = 0b0000000000000000000000000010000;
export const ContentReset = 0b0000000000000000000000000100000;
export const Callback = 0b0000000000000000000000001000000;
// DidCapture is 0b0000000000000000000000010000000.
export const ForceClientRender = 0b0000000000000000000000100000000;
export const Ref = 0b0000000000000000000001000000000;
export const Snapshot = 0b0000000000000000000010000000000;
export const Passive = 0b0000000000000000000100000000000;
// Hydrating is 0b0000000000000000001000000000000.
export const Visibility = 0b0000000000000000010000000000000;
export const StoreConsistency = 0b0000000000000000100000000000000;

// Flags that mean different things on different fiber types.
export const Hydrate = Callback;
export const ScheduleRetry = StoreConsistency;
export const ShouldSuspendCommit = Visibility;
export const ViewTransitionNamedMount = ShouldSuspendCommit;
export const DidDefer = ContentReset;
export const FormReset = Snapshot;
export const AffectedParentLayout = ContentReset;

export const LifecycleEffectMask = Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

// Union of all commit flags (flags with the lifetime of a single commit).
export const HostEffectMask = 0b0000000000000000111111111111111;

// These are not really side effects, but we still reuse this field.
export const Incomplete = 0b0000000000000001000000000000000;
export const ShouldCapture = 0b0000000000000010000000000000000;
export const ForceUpdateForLegacySuspense = 0b0000000000000100000000000000000;
export const DidPropagateContext = 0b0000000000001000000000000000000;
export const NeedsPropagation = 0b0000000000010000000000000000000;
export const Forked = 0b0000000000100000000000000000000;

// Static flags describe properties of the fiber that last for its whole
// life, unlike the commit flags above. They are copied to clones.
export const SnapshotStatic = 0b0000000001000000000000000000000;
export const LayoutStatic = 0b0000000010000000000000000000000;
export const RefStatic = LayoutStatic;
export const PassiveStatic = 0b0000000100000000000000000000000;
export const MaySuspendCommit = 0b0000001000000000000000000000000;
// ViewTransitionNamedStatic tracks explicitly named ViewTransition
// components deeply that might need to be visited during clean up.
export const ViewTransitionNamedStatic = SnapshotStatic | MaySuspendCommit;
// ViewTransitionStatic tracks whether there are ViewTransition components
// from the nearest HostComponent down.
export const ViewTransitionStatic = 0b0000010000000000000000000000000;
// Tracks whether a ViewTransition has a parent ViewTransition above it.
export const ViewTransitionStaticParent = 0b1000000000000000000000000000000;
// Tracks whether a HostPortal is present in the tree.
export const PortalStatic = 0b0000100000000000000000000000000;

// Flag used to identify newly inserted fibers. It isn't reset after commit
// unlike `Placement`.
export const PlacementDEV = 0b0001000000000000000000000000000;
export const MountLayoutDev = 0b0010000000000000000000000000000;
export const MountPassiveDev = 0b0100000000000000000000000000000;

// Groups of flags used by the commit phase to skip subtrees.
export const BeforeMutationMask: number = Snapshot;
export const BeforeAndAfterMutationTransitionMask: number =
  Snapshot | Update | Placement | ChildDeletion | Visibility | ContentReset;
export const MutationMask = Placement | Update | ChildDeletion | ContentReset | Ref | Hydrating | Visibility | FormReset;
export const LayoutMask = Update | Callback | Ref | Visibility;
// TODO: Split into PassiveMountMask and PassiveUnmountMask.
export const PassiveMask = Passive | Visibility | ChildDeletion;
// For View Transition support we use the snapshot phase to scan the tree for
// potentially affected ViewTransition components.
export const PassiveTransitionMask: number = PassiveMask | Update | Placement;
// Union of tags that don't get reset on clones.
export const StaticMask =
  LayoutStatic |
  PassiveStatic |
  RefStatic |
  MaySuspendCommit |
  ViewTransitionStatic |
  ViewTransitionStaticParent |
  ViewTransitionNamedStatic |
  PortalStatic |
  Forked;
