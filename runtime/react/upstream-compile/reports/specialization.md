# Typed specialization boundary

The experiments support one specific split: preserve erased storage at React's
real existential boundaries, then project once into a component-specific typed
region. Generics help inside that region; they do not make the upstream Fiber
and hook lists homogeneous.

## Component descriptor and props

A production AOT component should have a link-time descriptor conceptually
equivalent to:

```ts
interface ComponentDescriptor<Props, HookFrame> {
  readonly propsToken: TypeToken<Props>;
  readonly frameToken: TypeToken<HookFrame>;
  render(props: Props, frame: HookFrame): ReactNode;
}
```

A general React element and Fiber store an erased reference to the descriptor
and packed props because either may name any component. At invocation, React
checks the descriptor once, projects the props and frame, and calls the
monomorphized render function. Property access inside the component is then a
normal field load. Lazy, dynamically registered or separately linked
components use the same checked descriptor path and may retain an erased frame.

For intrinsic elements, JSX lowering knows the platform element descriptor. It
constructs its typed prop record, preserves key/ref separately, and packs only
the value handed to the general React element. The recording host's ordered
`HostProp[]` and the finite JavaScript oracle projection exercise the two sides
of this adapter boundary.

## Hook frame and update queue

The general upstream hook list must carry state hooks, effects, refs, memo
caches and custom-hook expansions in one linked representation. A `Hook<T>`
would assign one false `T` to that heterogeneous list. Its compatible fallback
therefore keeps checked erased `memoizedState`, `baseState` and queue fields.

For a compiler-verified component, a generated frame gives each stable hook
site its own field. A state site can use:

```ts
interface StateQueue<State, Action> {
  pending: Update<State, Action> | null;
  lastRenderedState: State;
  lastRenderedReducer(state: State, action: Action): State;
}
```

`StateQueue<number, Increment>` is monomorphized through dispatch, eager update
and reduction. The Fiber retains an erased frame reference because different
Fibers have different frames. Mount, render-phase rerender, suspended work and
commit must create or select the work-in-progress frame at the same moments as
the upstream hook list. Development hot reload and components whose hook shape
cannot be proven stay on the list representation.

## Memo-cache frame

The real recovered Counter demonstrates the strongest specialization case.
Its `_c(6)` cache lowers in HIR to a six-field object with concrete number,
closure, string, closure, number and element fields. Every literal cache index
is a direct `field.get` or `field.set`; there is no cache-slot tag operation.

The current C layout for that object is 72 bytes including its 24-byte header.
Six current 16-byte erased fields would require 120 bytes with the same header,
so the typed layout saves 48 bytes, or 40%, for this cache. This erased size is
calculated from the measured ABI rather than emitted as a second Counter build.
The separate hook probe measures 32 bytes for two typed numeric fields and 56
bytes for two erased fields.

Memo-cache ownership remains upstream behavior. `useMemoCache` stores a list of
cache frames and a render-local index in `FunctionComponentUpdateQueue`. On an
update, the selected profile clones the committed frames for the new render
attempt because `enableNoCloningMemoCache` is false. An interrupted attempt
cannot publish partial data. A future profile enabling shared frames may reuse
atomic compiler writes across attempts, matching the guarded upstream mode.

## Fallback rule

Specialization is per boundary and per field. A cache slot with incompatible
reaching representations becomes checked erased storage without widening the
other slots. A component whose descriptor cannot be resolved uses erased props
and the upstream hook list without changing hook order, bailout, error or
Suspense behavior. Differential recording-host output decides correctness;
source-level resemblance is not sufficient.
