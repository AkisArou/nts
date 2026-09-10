# React function constructors and prototype semantics

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The fixture mirrors `ReactBaseClasses`: a function uses its own `this`, then
receives methods and a class marker through `.prototype`. Native TypeScript
accepts it. NTS documents function expressions with their own `this` as a gap,
and dynamic prototype construction and mutation as explicit non-goals.

React's class API cannot lose subclassing, `instanceof`, the
`isReactComponent`/`isPureReactComponent` markers, `setState`, `forceUpdate`, or
method lookup. A candidate adaptation is a source-hash-guarded conversion of
`Component` and `PureComponent` into real TypeScript classes backed by static
NTS class layouts. It is acceptable only after differential tests cover those
observables. A native component descriptor can carry React-specific callable
metadata that upstream reads without introducing a general property map.

`FiberNode` is a narrower case. Upstream states that it has no instance methods,
must not be tested with `instanceof`, and should remain easy to port to a C
struct. Converting that constructor pattern to a fixed class or record can
therefore preserve its stated contract and improve allocation and field access,
but it still needs a source-hash guard and an oracle before adoption.
