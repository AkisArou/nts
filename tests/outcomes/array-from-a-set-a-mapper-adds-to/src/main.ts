// Array.from applies its mapper while consuming the iterator. An element
// added on the first callback is therefore visited by the same collection.
// The current lowering collects first and maps the intermediate array, so
// the subject stops after the two original elements even though its source
// Set has three. This is separate from the callback-free bounds optimization.
//
// The control differs only in whether the mapper adds the third element.
// Both loops are bounded: the addition happens once, at output index zero.
function listed(addDuringMapping: boolean): string {
  const source = new Set<number>();
  source.add(1);
  source.add(2);
  const result = Array.from(source, (value, index) => {
    if (addDuringMapping && index === 0) source.add(3);
    return value * 10 + index;
  });
  return result.join(",") + ":" + source.size;
}

observe("control", listed(false));
observe("subject", listed(true));
done();
