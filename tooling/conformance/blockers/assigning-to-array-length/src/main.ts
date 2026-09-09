// expect: assigning to this property
//
// `items.length = n` truncates an array in JavaScript, and it is refused.
// Reading `.length` lowers, and assigning an ordinary field lowers, so it is
// this property and this direction:
//
//     items.length          -> lowers and crosses
//     box.size = n          -> lowers and crosses
//     items.length = n      -> REFUSED
//
// Both controls are needed. Without `readLength` the diagnostic reads as
// "`length` is not available"; without `assignField` it reads as "assignment is
// refused".
//
// **One site in `runtime/node`**, and the count is worth stating carefully.
// `assigning to this property` appears 1,300 times when the twenty-two per-
// module cone counts are summed, which is how it reached the top of a
// frequency list. Deduplicated by site it is **13**, and **1** of those is in
// this profile: `url/src/searchparams.ts:538`,
//
//     target.length = source.length;
//
// inside `replaceListContents`. The other twelve are in `web-platform`, which
// every module's cone contains, so this form inflates by roughly a hundred
// rather than by the profile's average of nine.
//
// It is filed anyway because `url` publishes nothing and `URLSearchParams` is
// one of its three classes without a constructor. One site can still be the
// site.

class Box {
  size: number;

  constructor(size: number) {
    this.size = size;
  }
}

export function readLength(items: string[]): number {
  return items.length;
}

export function assignField(size: number): number {
  const box = new Box(1);
  box.size = size;
  return box.size;
}

export function assignLength(count: number): number {
  const items: string[] = ["a", "b", "c"];
  items.length = count;
  return items.length;
}
