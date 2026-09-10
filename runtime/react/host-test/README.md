# Recording mutation host

This is the renderer-independent mutation kernel and semantic oracle for the
first React profile. It uses stable discriminated records and ordered prop
pairs, so its implementation does not depend on JavaScript property bags or
unchecked values.

The kernel tests cover initial children, container append, same-parent moves,
insert-before, prop and text commits, visibility, removal, reparent rejection
and container clearing. A materialized `ReactFiberConfig` now links it to the
mechanically generated upstream runtime. The JavaScript oracle adds a finite
props projection because upstream `createElement` produces property objects;
native JSX lowering is expected to construct the ordered prop records directly.

```sh
npm run --prefix runtime/react host:test
npm run --prefix runtime/react host:native-test
```

The second command emits C through NTS, links the generated runtime and checks
the same tree operations through an exported native function.
