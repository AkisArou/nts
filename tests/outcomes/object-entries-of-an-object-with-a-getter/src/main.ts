// `Object.entries` of a literal with a getter, and it agrees -- so this is a
// guard rather than a defect.
//
// It was the control for `object-entries-after-a-getter-deletes-a-later-key`,
// which crashed and differed in one statement: its getter ran `delete this.c`.
// That record named `Object.entries` as the cause and was wrong; the `delete`
// was, and it is now refused by name in
// `blockers/a-delete-of-a-property-that-is-not-optional`, whose header carries
// the mechanism and why nothing replaces the entries half.
//
// **Kept, with its control gone, because the pair's evidence ran one way.** This
// arm is what said the crash was *not* about `Object.entries` meeting a getter,
// and the only thing that still holds that sentence up is this program
// continuing to agree. A control whose subject is fixed becomes the regression
// test for the reasoning that fixed it.
const keeps = {
  a: "A",
  get b() {
    return "B";
  },
  c: "C",
};
observe("entries", Object.entries(keeps).map((e) => e[0] + "=" + e[1]).join(","));
done();
