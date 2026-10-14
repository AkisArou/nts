// A class this program declares, used as a **value**.
//
//     this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;
//
// node's documented `createServer({ IncomingMessage, ServerResponse })` option:
// a caller substituting the message class, stored in a field so it can be
// `new`ed later. It is the single `NTS1001` in `http.Server`'s constructor,
// which `createServer` waits on, which the Node lane ranks at **274 failing
// test files** — the largest item on the compiled axis.
//
// The mechanism already existed for the classes this compiler *provides*.
// `err.constructor === TypeError` is how a program asks which error it caught,
// and `runtime/node` writes it 88 times, so a token for the built-in error
// classes was already built: one immortal object per class, the same one
// wherever the name is written, `typeof` `"function"`, comparable. All that was
// missing for a user class was where the token's index comes from — a provided
// error's is its position in a compile-time list, and a user class needs one
// decided once for the whole program, because a builder is made fresh per
// function and every one of them must produce the same object.
//
// # The merge that would have made this a silent wrong answer
//
// A token is an **empty** layout, so `Layout::same_shape` cannot tell two of
// them apart, and `collect_layouts` would have merged `Ctor_Message` with
// `Ctor_Other` — making `M === Message` and `M === Other` both true, with
// nothing emitted to say so. `nominal_name` already states the rule for exactly
// this ("a layout whose name is its identity does not merge with a
// differently-named one"), and record 0096 predicted the family; the token
// arm's guard just had to stop asking whether the name was an *error's*.
//
// `distinctTokens` below is the control for that, and it is the case this
// fixture exists for. The others would pass with one merged token.
//
// # What still refuses, which is two other things wearing one message
//
// `new this.#Message(n)` is **a computed constructor** and refuses. Producing
// the class object and constructing through one are different features: the
// second needs the token to carry something that allocates and runs a
// constructor, which is record 0096's closure-base dispatch with a different
// member. Both refusals show on one probe, so this is half of a known two
// rather than a cleared root revealing a new one.
//
// `Event.AT_TARGET` — a static member read through a class name — also reports
// "a class used as a value" and is untouched by this. It is the commonest of
// the three in the corpus, about ten per module, and it is not this: the token
// is not what such a read wants. The Node lane established the split by
// measuring that a static *method call* through a class name already lowers,
// which says the lowering can resolve a member through a class name when the
// result is immediately consumed. `blockers/a-static-field-read` carries it.

class Message {
  constructor(public n: number) {}
  value(): number {
    return this.n;
  }
}

class Other {
  constructor(public n: number) {}
  value(): number {
    return this.n * 2;
  }
}

class Server {
  #Message: typeof Message;
  constructor(M?: typeof Message) {
    this.#Message = M ?? Message;
  }
  usesDefault(): boolean {
    return this.#Message === Message;
  }
}

/** Under test: the class taken as the default, and compared back. */
export function defaulted(n: number): number {
  return new Server().usesDefault() ? 1 + n * 0 : 2;
}

/** Under test: a caller substituting a different class. */
export function substituted(n: number): number {
  return new Server(Other).usesDefault() ? 1 : 2 + n * 0;
}

/**
 * The control: two tokens that must not be one.
 *
 * **Measured, not predicted.** Reverting `is_constructor_name` to accept only a
 * provided error's name -- which is what it said before this change -- gives:
 *
 *     nts  distinctTokens  405bc00000000000    (111)
 *     node distinctTokens  405b800000000000    (110)
 *     85 case(s) disagree
 *
 * So the merge is reachable and this is what catches it. `defaulted` and
 * `substituted` both still agree under that sabotage, which is the point of
 * having this one: they compare a token against *itself*, and one merged token
 * is still equal to itself.
 */
export function distinctTokens(n: number): number {
  const a: unknown = Message;
  const b: unknown = Other;
  return (
    (a === b ? 1 : 0) +
    (a === Message ? 10 : 0) +
    (typeof a === "function" ? 100 : 0) +
    n * 0
  );
}

/** Control: a token passed through a parameter keeps its identity. */
export function throughAParameter(n: number): number {
  const pick = (M: typeof Message): number => (M === Other ? 5 : 7);
  return pick(Other) + pick(Message) + n * 0;
}
