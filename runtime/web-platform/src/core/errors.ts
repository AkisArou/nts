/** DOMException's useful non-DOM surface. No host DOMException dependency. */
export class DOMException extends Error {

  constructor(message = "", name = "Error") {
    super(message);
    this.name = name;
  }

  get code(): number {
    switch (this.name) {
      case "IndexSizeError":
        return 1;
      case "InvalidCharacterError":
        return 5;
      case "NotFoundError":
        return 8;
      case "NotSupportedError":
        return 9;
      case "InvalidStateError":
        return 11;
      case "SyntaxError":
        return 12;
      case "SecurityError":
        return 18;
      case "NetworkError":
        return 19;
      case "AbortError":
        return 20;
      case "TimeoutError":
        return 23;
      case "DataCloneError":
        return 25;
      default:
        return 0;
    }
  }
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

export function networkError(cause: unknown): TypeError {
  return new TypeError("Network request failed", { cause });
}

export class ProtocolError extends Error {

  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class LimitError extends RangeError {

  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}

export function invariant(value: boolean, message: string): asserts value {

  if (!value) throw new Error(message);
}
