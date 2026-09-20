// Identifiers whose characters no C identifier may carry.
//
// `Class#method` is mangled to a C name, and every character outside
// `[A-Za-z0-9_]` used to become a single `_`. That is not injective: a class
// declaring `#$` and `#_` produced `C___` twice, and the program was refused
// with ``$` and `_` both need the C name `C___``.
//
// **14 files of the slice-1 `test/language` population, and all 14 now pass** —
// they are the generated tests for identifiers spelled with `$`, a Unicode
// escape and the like, which is exactly the population a lossy mangling
// collides.
//
// **The zero-width pair is now among them**, and it was a finding before it was
// a fixture. With `#ZW_\u200c_NJ` here, `d8` used to refuse the whole class --
//
//     Field name '$ZW_\u200c_NJ' cannot be represented in dex format.
//
// -- because `SimpleName` is a list of ranges rather than a rule, and
// `U+2010..U+2027` picks up after `U+00a1..U+1fff`: everything from `U+2000` to
// `U+200f` is outside it. ECMAScript reaches into that gap on purpose, since
// `IdentifierPart` is `ID_Continue` *plus* ZWNJ and ZWJ.
//
// Intersected over all 1.1 million codepoints, that is **exactly two
// characters** -- so `jvm_member_name` maps those two to `$` and leaves the rest
// of Unicode alone, which is what the general case still wants. The arms below
// are the two, and `℘` beside them is the control: a non-ASCII character
// `SimpleName` does admit, which must keep its spelling.
//
// Two reasons this lives here rather than in a JVM-only fixture. The characters
// are an identifier-spelling question, which is what this file is about on every
// backend; and `d8` is reached through the `dex` gate step, which dexes the whole
// corpus -- so an example is the only thing that puts a name in front of it.
//
// `_uXXXX_` is reversible by construction, so two different characters cannot
// arrive at one spelling. Two details are deliberate:
//
// The test is **ASCII** alphanumeric rather than `char::is_alphanumeric`, which
// is Unicode-aware. The previous version asked the Unicode question and then
// replaced the character anyway, so its two halves disagreed about what an
// identifier is — and a character `is_alphanumeric` accepts would have gone
// into a C identifier no compiler accepts.
//
// A raw `_` still passes through, which leaves every ordinary name unchanged.
// This function is on the path of every emitted method, and churning
// `Class__method` into something else would be a diff across the whole backend
// for nobody's benefit. What that costs: a source name containing the literal
// text `_u0024_` could still collide with an escaped `$` — which `emit.rs`
// detects and refuses by name, as it did before. The backstop is unchanged and
// only the need for it is rarer.

class Spellings {
  #$ = 1;
  #_ = 2;
  #\u{6f} = 3;
  #℘ = 4;
  #ZW_\u{200c}_NJ = 5;
  #ZW_\u{200d}_J = 6;

  dollar(): number {
    return this.#$;
  }

  underscore(): number {
    return this.#_;
  }

  escaped(): number {
    return this.#\u{6f};
  }

  weierstrass(): number {
    return this.#℘;
  }

  nonJoiner(): number {
    return this.#ZW_\u{200c}_NJ;
  }

  joiner(): number {
    return this.#ZW_\u{200d}_J;
  }


}

/**
 * Every field read back, and each answer distinct — a mangling that merged two
 * of them would either refuse the program or return one field for another, and
 * this arm separates those from a program that merely compiles.
 */
export function eachFieldIsItsOwn(n: number): number {
  const s = new Spellings();
  return (
    s.dollar() * 100000 +
    s.underscore() * 10000 +
    s.escaped() * 1000 +
    s.weierstrass() * 100 +
    s.nonJoiner() * 10 +
    s.joiner() +
    n * 0
  );
}

class Methods {
  $(n: number): number {
    return n + 1;
  }

  _(n: number): number {
    return n + 2;
  }

  \u{6f}(n: number): number {
    return n + 3;
  }
}

/** The same question for *methods*, which are emitted as `Class__name`. */
export function eachMethodIsItsOwn(n: number): number {
  const m = new Methods();
  return m.$(0) * 100 + m._(0) * 10 + m.\u{6f}(0) + n * 0;
}

/**
 * The control: ordinary names, which must keep the spelling they have. A
 * mangling that escaped everything would pass every arm above and churn every
 * emitted symbol in the compiler.
 */
class Ordinary {
  value = 7;

  twice(n: number): number {
    return n * 2;
  }
}

export function ordinaryNamesAreUntouched(n: number): number {
  const o = new Ordinary();
  return o.value * 10 + o.twice(n < 1 ? 1 : 1);
}
