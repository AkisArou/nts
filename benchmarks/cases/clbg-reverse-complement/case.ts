/*
 * The Computer Language Benchmarks Game — BSD-3-Clause.
 * Copyright (c) 2004-2008 Brent Fulgham, 2005-2025 Isaac Gouy.
 * All rights reserved. See ../LICENSE-benchmarks-game for the licence.
 *
 * Contributed by Joe Farro; parts from Jos Hirth's solution, modified by 10iii.
 * https://benchmarksgame-team.pages.debian.net/benchmarksgame/program/revcomp-node-2.html
 */

import { renderFasta } from "../../common/clbg-fasta.ts";

// The source's linked arrays of 16000-byte chunks and backward traversal stay
// intact. Uint8Array/subarray replace Buffer/slice. The synchronous reader
// drains an in-memory FASTA file, so the stream's readable-event retries become
// one explicit final reverse. Every invocation starts with fresh stream state.
const READ_SIZE = 16000;
const LA_LEN = 30;

class LinkedArray {
  prev: LinkedArray | undefined;
  next: LinkedArray | undefined;
  pos: number;
  data: Uint8Array[];

  constructor(prev: LinkedArray | undefined = undefined) {
    this.prev = prev;
    this.next = undefined;
    this.pos = 0;
    this.data = [];
  }
}

function ascii(bytes: string | Uint8Array): string {
  return typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
}

function getCompChar(code: number): number | undefined {
  switch (code) {
    case 65:
    case 97: return 84;
    case 66:
    case 98: return 86;
    case 67:
    case 99: return 71;
    case 68:
    case 100: return 72;
    case 71:
    case 103: return 67;
    case 72:
    case 104: return 68;
    case 75:
    case 107: return 77;
    case 77:
    case 109: return 75;
    case 78:
    case 110: return 78;
    case 82:
    case 114: return 89;
    case 83:
    case 115: return 83;
    case 84:
    case 85: return 65;
    case 86:
    case 118: return 66;
    case 87:
    case 119: return 87;
    case 116:
    case 117: return 65;
    case 89:
    case 121: return 82;
  }
  return undefined;
}

export function render(n: number): string {
  const fasta = renderFasta(n);
  const input = new Uint8Array(fasta.length);
  for (let i = 0; i < fasta.length; ++i) {
    input[i] = fasta.charCodeAt(i);
  }
  let readPosition = 0;
  function readChunk(): Uint8Array | undefined {
    if (readPosition === input.length) return undefined;
    const end = Math.min(readPosition + READ_SIZE, input.length);
    const chunk = input.subarray(readPosition, end);
    readPosition = end;
    return chunk;
  }

  const writeBuffer = new Uint8Array(READ_SIZE + READ_SIZE / 61 | 0);
  let metaI = 0;
  let numLines = 0;
  let output = "";

  function reverseCompPrint(line: Uint8Array): void {
    const _metaI = metaI;
    let _numLines = numLines;
    let count = 0;
    const target = writeBuffer;
    const len = line.length;
    const right = line.length - 1;

    let ileft = 0;
    let iright = 0;
    let c: number;
    while (iright < len) {
      c = line[right - iright];
      iright++;
      if (c === 10) {
        if (iright === len) {
          break;
        }
        c = line[right - iright];
        iright++;
      }
      // FASTA's alphabet has a complement for every non-newline byte.
      target[ileft] = getCompChar(c)!;
      ileft++;
      count++;
      if ((count + _metaI - _numLines) % 60 === 0) {
        target[ileft] = 10;
        ileft++;
        count++;
        _numLines++;
      }
    }
    metaI = _metaI + count;
    numLines = _numLines;
    output += ascii(target.subarray(0, count));
  }

  function reverse(la_: LinkedArray): void {
    metaI = 0;
    numLines = 0;

    let la: LinkedArray | undefined = la_;
    let lines = la.data;
    let lnIdx = la.pos - 1;
    let line = lines[lnIdx];

    while (true) {
      reverseCompPrint(line);
      lnIdx--;
      line = lines[lnIdx];
      if (line) {
        continue;
      }
      la = la.prev;
      if (la === undefined) {
        break;
      }
      lines = la.data;
      lnIdx = la.pos;
      lnIdx--;
      line = lines[lnIdx];
    }
    if ((metaI - numLines) % 60 !== 0) {
      output += "\n";
    }
  }

  const headLA = new LinkedArray();
  let la = headLA;
  let lnIdx = 0;
  let lines = la.data;
  let needHeader = true;
  let headerPartial: string | Uint8Array = "";

  let chunk = readChunk();
  while (chunk) {
    while (true) {
      if (needHeader) {
        const headerEnds = chunk.indexOf(10);
        output += ascii(headerPartial) + ascii(chunk.subarray(0, headerEnds)) + "\n";
        headerPartial = "";
        chunk = chunk.subarray(headerEnds);
        needHeader = false;
      }
      const caretIdx = chunk.indexOf(62);
      if (caretIdx > -1) {
        lines[lnIdx] = chunk.subarray(0, caretIdx);
        chunk = chunk.subarray(caretIdx);
        la.pos = lnIdx + 1;
        reverse(la);

        la = headLA;
        lines = la.data;
        la.pos = 0;
        lnIdx = 0;
        const headerEnds = chunk.indexOf(10);
        if (headerEnds < 0) {
          needHeader = true;
          headerPartial = chunk;
          break;
        } else {
          output += ascii(chunk.subarray(0, headerEnds)) + "\n";
          chunk = chunk.subarray(headerEnds);
        }
      } else {
        if (lnIdx === LA_LEN) {
          la.pos = LA_LEN;
          la = la.next || (la.next = new LinkedArray(la));
          lines = la.data;
          lines[0] = chunk;
          lnIdx = la.pos = 1;
        } else {
          lines[lnIdx] = chunk;
          lnIdx++;
        }
        break;
      }
    }
    chunk = readChunk();
  }
  la.pos = lnIdx;
  reverse(la);
  return output;
}

export function work(n: number): number {
  const output = render(n);
  let hash = 0;
  for (let i = 0; i < output.length; ++i) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// The harness supplies this as an opaque argument rather than a closed-over size.
export const seed = 10000;
