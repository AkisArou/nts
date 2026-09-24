type RootIdentity = {
  readonly id: number;
};

type RootScheduling = {
  pendingLanes: number;
};

type FiberRoot = RootIdentity & RootScheduling;

export function markPending(root: FiberRoot, lane: number): number {
  root.pendingLanes |= lane;
  return root.id;
}
