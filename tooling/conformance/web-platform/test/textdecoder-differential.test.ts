// `TextDecoder` against node's, across encodings, options and chunk boundaries.
//
// The pinned WPT fixtures cover the standard's cases. This covers the *combinations* —
// three encodings against `fatal` against `ignoreBOM` against arbitrary streaming splits
// — which is where a decoder with correct pieces still gets the interaction wrong, and
// which no fixture enumerates because the product is large and boring.
//
// UTF-16 landed today, so it is the newest code in this lane and the least exercised by
// anything other than the fixtures that motivated it. Node's `TextDecoder` is a genuine
// independent implementation rather than a reimplementation of the thing under test,
// which is the property that makes a differential worth running.
import assert from "node:assert/strict";
import test from "node:test";

import { TextDecoder } from "../../../../runtime/web-platform/src/index.ts";

const suite = (name, fn) => test(name, { timeout: 30000 }, fn);
const NativeTextDecoder = globalThis.TextDecoder;

const ENCODINGS = ["utf-8", "utf-16le", "utf-16be"];

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** Bytes with a deliberate bias towards the shapes that break decoders. */
function bytesFor(random) {
  const length = Math.floor(random() * 14);
  const out = [];
  for (let index = 0; index < length; index++) {
    const pick = random();
    if (pick < 0.3) out.push(Math.floor(random() * 0x80));
    else if (pick < 0.45) out.push(0x80 + Math.floor(random() * 0x40)); // continuations
    else if (pick < 0.6) out.push(0xc0 + Math.floor(random() * 0x40)); // lead bytes
    else if (pick < 0.7) out.push(0xd8 + Math.floor(random() * 0x08)); // UTF-16 surrogate halves
    else if (pick < 0.8) out.push(0xef, 0xbb, 0xbf); // a UTF-8 BOM, mid-stream too
    else if (pick < 0.9) out.push(0xff, 0xfe); // a UTF-16LE BOM
    else out.push(Math.floor(random() * 256));
  }
  return Uint8Array.from(out);
}

/** What a decoder did, as a value, so throwing and returning compare the same way. */
function outcome(decoder, chunks) {
  try {
    let text = "";
    for (let index = 0; index < chunks.length; index++) {
      text += decoder.decode(chunks[index], { stream: index < chunks.length - 1 });
    }
    return { text };
  } catch (error) {
    return { threw: error?.constructor?.name ?? "Error" };
  }
}

function split(bytes, random) {
  const pieces = [];
  let offset = 0;
  while (offset < bytes.length) {
    const take = 1 + Math.floor(random() * 4);
    pieces.push(bytes.subarray(offset, Math.min(offset + take, bytes.length)));
    offset += take;
  }
  return pieces.length === 0 ? [bytes] : pieces;
}

for (const encoding of ENCODINGS) {
  for (const fatal of [false, true]) {
    for (const ignoreBOM of [false, true]) {
      const label = `${encoding} fatal=${fatal} ignoreBOM=${ignoreBOM}`;

      suite(`whole-buffer decode matches node: ${label}`, () => {
        const random = generator(0x1234 + encoding.length * 7 + (fatal ? 1 : 0) * 31 + (ignoreBOM ? 1 : 0) * 71);
        for (let n = 0; n < 4000; n++) {
          const bytes = bytesFor(random);
          const mine = outcome(new TextDecoder(encoding, { fatal, ignoreBOM }), [bytes]);
          const theirs = outcome(new NativeTextDecoder(encoding, { fatal, ignoreBOM }), [bytes]);
          assert.deepEqual(mine, theirs, `${label} :: ${JSON.stringify([...bytes])}`);
        }
      });

      suite(`a split changes nothing about the result: ${label}`, () => {
        // A chunk boundary in the middle of a sequence is the whole difficulty of a
        // streaming decoder, and the split is where an implementation with correct
        // pieces still loses or duplicates a code point.
        //
        // The oracle here is **this decoder's own whole-buffer result**, not node's, and
        // that is a deliberate downgrade with a reason. Node's streamed and whole-buffer
        // results disagree with each other for a `EF BB BF` that arrives after a chunk
        // boundary but is not at the start of the stream: `[EA EF BB BF 41]` decoded in
        // one call gives `U+FFFD U+FEFF U+0041`, and split gives `U+FFFD U+0041`. A BOM
        // is removed only when the stream *starts* with one, so the first answer is the
        // standard's and the second drops a code point that is data. An oracle that
        // contradicts itself cannot arbitrate the case it disagrees on.
        //
        // What survives is stronger than it sounds: chunking must not be observable, and
        // that property catches every split-boundary defect without borrowing anyone's
        // opinion about the BOM.
        const random = generator(0x9abc + encoding.length * 13 + (fatal ? 1 : 0) * 17 + (ignoreBOM ? 1 : 0) * 53);
        for (let n = 0; n < 3000; n++) {
          const bytes = bytesFor(random);
          const chunks = split(bytes, random);
          const streamed = outcome(new TextDecoder(encoding, { fatal, ignoreBOM }), chunks);
          const whole = outcome(new TextDecoder(encoding, { fatal, ignoreBOM }), [bytes]);
          assert.deepEqual(
            streamed,
            whole,
            `${label} :: ${JSON.stringify([...bytes])} split ${chunks.map((c) => c.length).join("/")}`,
          );
        }
      });
    }
  }
}

suite("node's answer depends on where the chunk boundary falls; this one does not", () => {
  // The case that cost node its role as a streaming oracle, pinned so the claim is
  // checked rather than asserted -- and pinned in the sharper form the NodeJS lane
  // established when they verified it, because the weaker form has a charitable reading
  // this one removes.
  //
  // A `EF BB BF` that is not at the start of the stream is U+FEFF and is data. Node
  // agrees when the bytes arrive whole, one at a time, or straddling a boundary. It
  // drops the code point only when a *complete* `EF BB BF` begins at the head of a
  // decode call that follows a call which emitted nothing.
  //
  // That rules out "streaming is allowed to differ": there is no rule under which
  // 1/1/1/1/1 and 4/1 are right and 1/3/1 is wrong. The answer depends on where the
  // boundary falls, which no reading of the standard makes defensible.
  const bytes = [0xea, 0xef, 0xbb, 0xbf, 0x41];
  const chunksOf = (sizes) => {
    const out = [];
    let offset = 0;
    for (const size of sizes) {
      out.push(Uint8Array.from(bytes.slice(offset, offset + size)));
      offset += size;
    }
    return out;
  };
  // Nine splits, built in three passes by two lanes each verifying the last. `1/2/2` is
  // the row that does the work: same empty first chunk as the two failures, but an
  // incomplete `EF BB` at the head, and node gets it right -- so the trigger needs both
  // halves and neither alone.
  const splits = [
    [5],
    [1, 3, 1],
    [1, 1, 1, 1, 1],
    [4, 1],
    [2, 3],
    [1, 4],
    [3, 2],
    [1, 2, 2],
    [2, 2, 1],
  ];
  const correct = "\uFFFD\uFEFF\u0041";

  const nodeAnswers = new Set();
  for (const sizes of splits) {
    const mine = outcome(new TextDecoder("utf-8"), chunksOf(sizes));
    assert.deepEqual(mine, { text: correct }, `this decoder, split ${sizes.join("/")}`);
    nodeAnswers.add(outcome(new NativeTextDecoder("utf-8"), chunksOf(sizes)).text);
  }

  // If node ever becomes self-consistent here, this fails and the workaround above --
  // comparing streamed output against this decoder's own whole-buffer output rather than
  // against node's -- can be reconsidered. A workaround whose reason has quietly expired
  // is worse than the bug it was for.
  assert.equal(
    nodeAnswers.size,
    2,
    `node gave ${nodeAnswers.size} distinct answers for one byte sequence: ${[...nodeAnswers]
      .map((text) => JSON.stringify(text))
      .join(" and ")}`,
  );
  // The two node answers it does give: the standard's, and the one missing U+FEFF.
  assert.ok(nodeAnswers.has(correct));
  assert.ok(nodeAnswers.has("\uFFFD\u0041"));
});

suite("the encoding name reported is the one the standard names", () => {
  // `utf-16` is a label for UTF-16LE, which reads as a mistake and is not one.
  for (const [label, expected] of [
    ["utf-8", "utf-8"],
    ["UTF-8", "utf-8"],
    ["utf-16", "utf-16le"],
    ["utf-16le", "utf-16le"],
    ["ucs-2", "utf-16le"],
    ["unicodefeff", "utf-16le"],
    ["utf-16be", "utf-16be"],
    ["unicodefffe", "utf-16be"],
  ]) {
    assert.equal(new TextDecoder(label).encoding, expected, label);
    assert.equal(new NativeTextDecoder(label).encoding, expected, `${label} (node)`);
  }
});
