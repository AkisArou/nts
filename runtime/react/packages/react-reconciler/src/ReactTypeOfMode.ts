// Properties of a fiber's subtree, inherited from its parent when the fiber
// is created and fixed afterwards.
export type TypeOfMode = number;

export const NoMode = 0b0000000;
// Only for the concurrent root; legacy mode is gone from the stable build.
export const ConcurrentMode = 0b0000001;
export const ProfileMode = 0b0000010;
export const StrictLegacyMode = 0b0001000;
export const StrictEffectsMode = 0b0010000;
export const SuspenseyImagesMode = 0b0100000;
