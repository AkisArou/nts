// An error placed in the frame, thrown, caught, and its computed message read
// back out.
//
// The subject is a release that used to happen too early. A frame object's
// header is immortal, so the retain that would keep it alive returns
// immediately; what keeps its fields alive is the frame, and `rc::release_value`
// gives them back where the object's live range ends. Ordinary liveness ended
// that range at the `Erase` that packs the reference for the throw -- so the
// message string was released while the handler was still about to read it, and
// the next allocation reused the buffer.
//
// It is a wrong answer rather than a leak, which is why it belongs here as well
// as in `examples/code-points`: the harness checks that the answer under
// counting matches the answer without it, and this case's answer is the
// message's length.
export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    total = (total + caught(i)) | 0;
  }
  return total;
}

function caught(i: number): number {
  try {
    throw new RangeError("Invalid code point " + i);
  } catch (error) {
    return error instanceof Error ? ("range:" + (error as Error).message).length : -1;
  }
}
