# Object literal methods and function fields

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

The fixture contains both `{then() {}}` and `{then: () => {}}` under explicit
interfaces. NTS currently reports both as object-literal methods. The
conformance ledger documents method syntax as a gap caused by the lack of a
canonical name for anonymous structural shapes, while function-valued fields
are marked supported.

React uses both forms for thenables, dispatchers and updater records. Rewriting
methods into arrow fields is not a valid general conversion: it can change
`this` and adds closure storage and indirect calls. NTS should canonicalize
structural layouts program-wide and retain the checker's distinction between a
method-table entry and a stored function field.
