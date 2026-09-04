// The object node's tests see as `require('string_decoder')`.
export function shape(exports) {
  // This predates ES classes and Node still accepts both `new StringDecoder()`
  // and `StringDecoder.call(receiver)`. A compiled class is deliberately not
  // callable, so the legacy function-object convention stays at this JS
  // boundary. The decoder state remains an actual typed instance; a WeakMap
  // only associates that state with the arbitrary receiver of the legacy
  // `.call()` form.
  const CompiledStringDecoder = exports.StringDecoder;
  const states = new WeakMap();
  const compiledPrototype = CompiledStringDecoder.prototype;
  const compiledWrite = compiledPrototype.write;
  const compiledEnd = compiledPrototype.end;
  const compiledText = compiledPrototype.text;
  const compiledLastChar = Object.getOwnPropertyDescriptor(
    compiledPrototype,
    "lastChar",
  ).get;
  const compiledLastNeed = Object.getOwnPropertyDescriptor(
    compiledPrototype,
    "lastNeed",
  ).get;
  const compiledLastTotal = Object.getOwnPropertyDescriptor(
    compiledPrototype,
    "lastTotal",
  ).get;

  function stateFor(receiver) {
    // The bare compiled prototype is deliberately not a branded instance;
    // its method performs Node's ERR_INVALID_THIS check after handling the
    // string fast path. It is therefore the correct invalid-state sentinel.
    return states.get(receiver) ?? compiledPrototype;
  }

  function StringDecoder(encoding) {
    const initialized = new CompiledStringDecoder(encoding);
    if (new.target === undefined) {
      states.set(this, initialized);
      this.encoding = initialized.encoding;
      return undefined;
    }
    states.set(initialized, initialized);
    Object.setPrototypeOf(initialized, StringDecoder.prototype);
    return initialized;
  }

  const prototype = Object.create(compiledPrototype);
  Object.defineProperties(prototype, {
    constructor: {
      configurable: true,
      writable: true,
      value: StringDecoder,
    },
    write: {
      configurable: true,
      enumerable: true,
      writable: true,
      value(buf) {
        return compiledWrite.call(stateFor(this), buf);
      },
    },
    end: {
      configurable: true,
      enumerable: true,
      writable: true,
      value(buf) {
        return compiledEnd.call(stateFor(this), buf);
      },
    },
    text: {
      configurable: true,
      enumerable: true,
      writable: true,
      value(buf, offset) {
        return compiledText.call(stateFor(this), buf, offset);
      },
    },
    lastChar: {
      configurable: true,
      enumerable: true,
      get() {
        return compiledLastChar.call(stateFor(this));
      },
    },
    lastNeed: {
      configurable: true,
      enumerable: true,
      get() {
        return compiledLastNeed.call(stateFor(this));
      },
    },
    lastTotal: {
      configurable: true,
      enumerable: true,
      get() {
        return compiledLastTotal.call(stateFor(this));
      },
    },
  });
  StringDecoder.prototype = prototype;
  return { StringDecoder };
}
