// A class member and a module-scope function with the same name, refused for
// different reasons -- and the same pair where only the member is refused.
//
// `Program::uncompiled` is one flat namespace of names, and a member used to
// record its bare member name beside its qualified one. So `Holder#names` and
// `function names` were one key, first writer wins, and the cascade prints what
// it finds there as the cause of a call it has nothing to do with.

// -- the lost cause ---------------------------------------------------------

class Holder {
  names(): number {
    const pattern = /a+/;
    return pattern.source.length;
  }
}

/// Refused for its own, different reason. Before the fix this reason was never
/// recorded at all: `Holder#names` had already taken the key `names`.
function names(): number {
  return Object.getOwnPropertyNames({ a: 1 }).length;
}

/// Reads the cascade, which is where the wrong cause was printed: "it calls
/// `names`, and a regular expression literal", about a function containing no
/// regular expression.
export function caller(): number {
  return names();
}

export function holds(): number {
  return new Holder().names();
}

// -- the phantom ------------------------------------------------------------

class Tagger {
  tag(): number {
    const pattern = /b+/;
    return pattern.source.length;
  }
}

/// Compiles. Before the fix `uncompiled` claimed it anyway, with `Tagger#tag`'s
/// reason, while the function was present in the emitted C -- so a reader asking
/// why an export was dropped got an answer about one that was not.
function tag(): number {
  return 7;
}

export function usesTag(): number {
  return tag();
}

export function tags(): number {
  return new Tagger().tag();
}

// -- the static, whose key is the one a cascade asks with -------------------

class Statics {
  /// Emitted as `Statics.named`, so its refusal has to be recorded under that
  /// name. Recorded as `Statics#named` it was one character from findable, and
  /// the caller below read "which was refused above" with nothing above.
  static named(): number {
    const pattern = /c+/;
    return pattern.source.length;
  }
}

export function viaStatic(): number {
  return Statics.named();
}

// -- the accessor, whose emitted name carries the keyword -------------------

class Reader {
  /// Emitted as `Reader#get size`, so `size` is not the key anything asks with
  /// -- and it is a key a module-scope `function size` would also own.
  get size(): number {
    const pattern = /d+/;
    return pattern.source.length;
  }
}

export function readsSize(): number {
  return new Reader().size;
}
