# Remaining TypeScript and JavaScript surface

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

Each source file in this strict fixture isolates one smaller category from the
full runtime report:

- `nullish.ts`: multiple absence values and a null-only return;
- `rest.ts`: a generic rest signature plus its ordinary spread call;
- `optional-presence.ts`: observable omission versus explicit `undefined`;
- `standard-library.ts`: JSON, Symbol and AggregateError wiring;
- `regex-and-for-in.ts`: two documented language/runtime gaps;
- `callable-metadata.ts`: a callable intersection with React-style metadata;
- `module-initializer.ts`: a refused initializer and its dependent global.

These cases must retain their idiomatic TypeScript forms when the conformance
ledger marks the feature as supported or wanted. Optional-property presence,
dynamic function metadata, coercion hooks and the prototype/property-map model
touch explicit NTS representation choices; React may adapt them only after
reachability or differential evidence proves the excluded behavior is not
observable. The report keeps secondary `NTS1005` module-evaluation diagnostics
separate from their original initializer refusal.

The current probe accepts the nullish tagged field and `Symbol.for` control,
while refusing a null-only return, the generic spread call, JSON and
AggregateError. This distinction matters: the full profile's Symbol diagnostic
is a contextual frontend/global-resolution defect, not evidence that symbols
need a React-local substitute.
