// A built-in component's props as its element carries them: a record, keyed by
// name, held in a fiber's `pendingProps` and `memoizedProps` as `unknown`.
//
// The reconciler declares each built-in's props as an interface
// (SuspenseProps, ViewTransitionProps, ...), and each is read out of the record
// field by field (the `...PropsOf` readers beside those interfaces). A native
// build lays an interface out at fixed offsets and a record out by key, so an
// interface read straight through the erased slot would read a record's memory
// at the interface's offsets. When the compiler reads a record through an
// interface by key, each reader becomes a cast.

/** Field `key` of a props record held as `unknown`. */
export function propOf(props: unknown, key: string): unknown {
  return (props as { readonly [key: string]: unknown })[key];
}
