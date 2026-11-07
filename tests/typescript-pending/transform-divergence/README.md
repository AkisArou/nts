# Whole-program TypeScript emit

This family waits for enrollment with whole-program emit and `isolatedModules`
off. TypeScript's emitter defines the answer, including where native type
stripping would produce different JavaScript.

- An unqualified reference to another block of a merged namespace
  (`namespace-*-across-blocks.ts`) resolves to that block's exported member.
  TypeScript emits the qualified reference, such as `Units.base`.
- A `declare const enum` (`declare-const-enum-is-inlined.ts`) needs whole-program
  checking so TypeScript can inline each member's value without a runtime enum
  object.

The oracle carries the owner's options and uses its pinned runtime target,
just as it does for the selected suite.
