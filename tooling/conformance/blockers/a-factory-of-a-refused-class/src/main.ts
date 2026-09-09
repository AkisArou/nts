// expect: `createServer`, a declaration outside every walk
//
// An exported function returning a class whose own body was refused. The
// function is reported as **unwalked** rather than as cascaded, and it is the
// largest single obstacle measured anywhere in this profile.
//
// # What it is standing in front of
//
// `next-pass.mjs` against the compiled addons, grouping each module's failures
// by the reason they stop at:
//
//     http    405 failing, 241 stop at `http.createServer is not a function`
//     net     148 failing,  91 stop at `net.createServer is not a function`
//     dgram    77 failing,  68 stop at `dgram.createSocket is not a function`
//
// `http/src/server.ts:930` carries exactly this message for `createServer`.
// (`net`'s is an NTS1003 cascade off `Server#constructor` and `dgram`'s is
// something else again -- three modules, one symptom at the wrapper, and not
// one cause. That is why this fixture claims only the one it reduced.)
//
// # Two controls
//
//     a factory of a class with a refused field    reported unwalked
//     a factory of a class that compiles           compiles
//
// So it is the *returned class* being refused, and nothing about factories.
//
// # It is an effect, and the message says otherwise
//
// The whole output for the file below:
//
//     main.ts:2:34  a `new` of unrepresentable type (`Map<any, any>`)
//     main.ts:4:2   `createServer`, a declaration outside every walk
//     no wrapper for createServer: is exported and no function of that name was compiled
//
// The first line is the cause. The second describes `createServer` as never
// having been reached, which reads as a gap in the walk -- something to fix in
// the traversal. It is not: the walk stopped because the class it would have
// reached through was refused, and clearing the `Map` clears all three lines.
//
// **A cascade with an NTS1001 code and no mention of what it cascaded from.**
// `internal/errors.ts` has the same shape under a different message, and
// `an-empty-object-literal` records a third. The census classifies a cascade on
// the words "was refused above", which this does not contain, so it is counted
// as a root -- 19 distinct things across 16 modules -- and that count is an
// overstatement by however many of them are this.
//
// Left counted as a root deliberately. One reduction shows this path exists; it
// does not show that all nineteen are it. In the `http` build, 20 of the 23
// sites sit in a file that also carries another root, which is suggestive and
// not evidence -- a file with 260 roots has one near everything.

class Server {
  #handles: Map<string, number> = new Map();
  count(): number {
    return this.#handles.size;
  }
}

export function createServer(): Server {
  return new Server();
}
