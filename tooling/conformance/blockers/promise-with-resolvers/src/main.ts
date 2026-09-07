// expect: NTS1001 a property `cap` of unrepresentable type
//         (`PromiseWithResolvers`)
//
// An object with function-valued members as a property type. 292 of `fs`'s
// 2,078 refusals are this one type -- 101 of them bare in
// `web-platform/src/streams/writable.ts` -- which makes it the largest single
// blocker in the module by a wide margin.
//
// The `| null` form is the same refusal wearing a union, and reads as
// "a union of `PromiseWithResolvers` | null". That similarity is what made a
// grouping key normalise the two together.
export class Holder {
  cap: PromiseWithResolvers<void> = Promise.withResolvers<void>();

  settle(): void {
    this.cap.resolve();
  }
}
