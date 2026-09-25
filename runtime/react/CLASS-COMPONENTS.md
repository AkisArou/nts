# Class components in the native build

Class components are the only way to write an error boundary, so the native
runtime needs them. This is the plan: what upstream relies on, what nts
cannot give it, and the shape that keeps upstream's code while removing
that reliance.

## What upstream relies on

A class component's fiber holds the class itself as its `type`. The
reconciler relies on three things the JavaScript object model gives it:

1. **The class as a value.** `new ctor(props, context)` constructs an
   instance (ReactFiberClassComponent, and BeginWork's strict-mode double
   construction). `shouldConstruct(type)` reads `type.prototype.isReactComponent`.
2. **Statics read through that value.** `ctor.contextType`,
   `ctor.getDerivedStateFromProps`, `ctor.getDerivedStateFromError`,
   `ctor.defaultProps`, `ctor.prototype.isPureReactComponent`: 39 sites.
3. **Lifecycles by presence.** `typeof instance.componentDidMount === "function"`
   decides whether an effect is scheduled at all, and whether a class is an
   error boundary (`componentDidCatch`, `getDerivedStateFromError`): about
   50 sites across seven files.

## What nts gives

nts lays out every object at compile time, and there is no class object.
Measured on HEAD 009b48e9 (probes under ~/.cache/nts-react/probes):

- `new ctor()` through a value is refused: the constructor would be chosen
  from the declared type, not the value.
- A static read through a `typeof Base` value compiles and returns
  **Base's** static, not the class passed. That's silently wrong; reported to
  the compiler lane.
- An optional method (`componentDidMount?(): void`) is refused: a method
  needs a body.

None of the three is a gap to wait out: they follow from fixed layouts.
The design removes the reliance instead.

## The design

**A descriptor is the class's `type`.** `shared/ReactClassComponentType.ts`
declares `ClassComponentType`: a record of what the reconciler reads from a
class, under the names it reads them by, so upstream's `ctor.contextType`
and `ctor.prototype.isPureReactComponent` read a field unchanged. It adds:

- `create(props, context)`: the class's constructor, as a closure that
  names the class;
- `lifecycles`: a bitmask of the lifecycle methods the class defines,
  inherited ones included.

**The stage writes the descriptor.** The React stage (nts-react), which
already rewrites every TSX file an `nts build` reads, appends one static
field to each class component:

```ts
class Counter extends Component<Props, State> {
  // ...as written...
  static readonly $$type = new ClassComponentType<Props>(
    "Counter",
    (props, context) => new Counter(props, context),
    Lifecycle.DidMount | Lifecycle.DidUpdate,
    { contextType: Counter.contextType, getDerivedStateFromProps: Counter.getDerivedStateFromProps, ... },
  );
}
```

Every statics read in it names the class, which nts compiles. JSX
`<Counter />` lowers to `jsx(Counter.$$type, props)`, so an element's
`type` is the descriptor, and a module importing `Counter` reaches it the same
way. The stage finds class components with the checker: a class whose
heritage reaches `Component` or `PureComponent` from `react`. A class
extending another user class adds its own lifecycles to
`Parent.$$type.lifecycles`.

**The instance base declares every lifecycle.** The native `Component`
(react/ReactBaseClasses.native.ts) gives each lifecycle a body, so a call
compiles and dispatches to the override. Each body is upstream's behaviour
when the method is absent, wherever upstream has one (`shouldComponentUpdate`
returns true, and PureComponent's compares shallowly). The reconciler asks
the mask, not the method, whether a class defines it.

**One seam for the three reliances**, `ReactFiberClassComponentHost.ts` with
a `.native.ts` twin, bound like the other fork points:

| | JavaScript build | native build |
| --- | --- | --- |
| `construct(ctor, props, context)` | `new ctor(props, context)`, or `ctor.create` for a descriptor | `ctor.create(props, context)` |
| `defines(ctor, instance, Lifecycle.X)` | `typeof instance.x === "function"` | `(ctor.lifecycles & Lifecycle.X) !== 0` |
| `isClassComponent(type)` | `shouldConstruct(type)`, or a descriptor | `type instanceof ClassComponentType` |

The JavaScript build accepts both a class and a descriptor. That's what makes
the design testable before the native runtime renders: the staged probe
runs under node against our runtime, and `tools/probe-agree.ts` holds it to
the plain probe, which passes classes.

## Order

1. **Done.** `ClassComponentType`, the seam, and its JavaScript side, with every
   upstream `new ctor` and presence check routed through the seam. Oracle:
   the upstream suites unchanged (557/580 reconciler, 51/53 react); with
   `defines` answering false, 71 reconciler tests fail.
2. **Done.** The stage's descriptor and JSX lowering, and the seam's native
   twin. `tools/probe-agree.ts` runs three class scenarios (lifecycles in
   order, an error boundary, a PureComponent skipping equal props). The
   plain and written arms keep upstream's model, the class as the type,
   by substituting the JavaScript seam and base classes. The staged arm
   runs the native twin, so a class the stage did not describe fails there.
   The JSX oracle (`study/jsx-diff.cjs`) sets the descriptor aside only for
   names that are classes, and `fixtures/jsx-lowering/classes.tsx` holds a
   class, a subclass, a pure class and a function side by side.
3. **In progress.** The native base class gives every lifecycle a body
   (react/ReactBaseClasses.native.ts), which probe-agree's staged arm runs.
   Control: a native `defines` that ignores the mask breaks `pureSkip`.
   What remains is how the reconciler reaches those bodies. It holds an
   instance through six interface views (`ClassInstance`,
   `CommitClassInstance`, ...), and nts dispatches an interface call only to
   classes that declare it. `Component<P, S>` is monomorphised per `P, S`, so
   no single class is the one the reconciler names. The shape that fits is
   the one contexts use: a non-generic base the reconciler holds, whose
   lifecycles take erased parameters, which user classes override with
   typed ones. nts compiles that override and crashes when it reads the
   parameter (reported with a two-arm reduction), so this step waits on
   that fix.
   Measured with the three invalid-HIR defects worked around locally, the
   probe emits, with 215 root refusals. Those on this path: the lifecycle
   calls above, the state merge (`Object.assign` onto a record, still ours
   to design), and `ctor.prototype && ...` (an object's truthiness).

## Left out

- `createElement(Counter, props)` written by hand, without JSX: the stage
  does not rewrite a class used as a value. Write `createElement(Counter.$$type, props)`.
- A class extending a class component from another file is not recognised
  (the stage sees one file at a time). Its tag names a class with no
  `$$type`, which fails to typecheck. In a native build that
  element's `type` is the class, which has no representation, so it's
  refused at compile time, not wrong at run time.
- Legacy context (`contextTypes`, `childContextTypes`) and string refs, which
  upstream has already removed behind flags that are off.
