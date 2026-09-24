# Intersection representation

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The fixture is ordinary strict TypeScript: two object records form one
`FiberRoot` intersection. NTS refuses the parameter even though
`docs/conformance/typescript.md` marks intersections as supported. The full
runtime has 115 occurrences of the plain intersection-parameter refusal,
mostly from React's statically known `FiberRoot` shape.

NTS should flatten compatible object intersections into one canonical static
layout. This needs no erased value and has no run-time tag or allocation cost.
Callable intersections such as a component function plus `displayName` are a
separate problem because NTS deliberately does not give functions JavaScript's
dynamic metadata object. Those should eventually cross React through a static
component descriptor rather than a property map.
