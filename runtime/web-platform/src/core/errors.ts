/** DOMException's useful non-DOM surface. No host DOMException dependency. */
export class DOMException extends Error {
  static readonly INDEX_SIZE_ERR = 1;
  static readonly DOMSTRING_SIZE_ERR = 2;
  static readonly HIERARCHY_REQUEST_ERR = 3;
  static readonly WRONG_DOCUMENT_ERR = 4;
  static readonly INVALID_CHARACTER_ERR = 5;
  static readonly NO_DATA_ALLOWED_ERR = 6;
  static readonly NO_MODIFICATION_ALLOWED_ERR = 7;
  static readonly NOT_FOUND_ERR = 8;
  static readonly NOT_SUPPORTED_ERR = 9;
  static readonly INUSE_ATTRIBUTE_ERR = 10;
  static readonly INVALID_STATE_ERR = 11;
  static readonly SYNTAX_ERR = 12;
  static readonly INVALID_MODIFICATION_ERR = 13;
  static readonly NAMESPACE_ERR = 14;
  static readonly INVALID_ACCESS_ERR = 15;
  static readonly VALIDATION_ERR = 16;
  static readonly TYPE_MISMATCH_ERR = 17;
  static readonly SECURITY_ERR = 18;
  static readonly NETWORK_ERR = 19;
  static readonly ABORT_ERR = 20;
  static readonly URL_MISMATCH_ERR = 21;
  static readonly QUOTA_EXCEEDED_ERR = 22;
  static readonly TIMEOUT_ERR = 23;
  static readonly INVALID_NODE_TYPE_ERR = 24;
  static readonly DATA_CLONE_ERR = 25;

  constructor(message = "", name = "Error") {
    super(message);
    this.name = name;
  }

  get INDEX_SIZE_ERR(): number {
    return 1;
  }

  get DOMSTRING_SIZE_ERR(): number {
    return 2;
  }

  get HIERARCHY_REQUEST_ERR(): number {
    return 3;
  }

  get WRONG_DOCUMENT_ERR(): number {
    return 4;
  }

  get INVALID_CHARACTER_ERR(): number {
    return 5;
  }

  get NO_DATA_ALLOWED_ERR(): number {
    return 6;
  }

  get NO_MODIFICATION_ALLOWED_ERR(): number {
    return 7;
  }

  get NOT_FOUND_ERR(): number {
    return 8;
  }

  get NOT_SUPPORTED_ERR(): number {
    return 9;
  }

  get INUSE_ATTRIBUTE_ERR(): number {
    return 10;
  }

  get INVALID_STATE_ERR(): number {
    return 11;
  }

  get SYNTAX_ERR(): number {
    return 12;
  }

  get INVALID_MODIFICATION_ERR(): number {
    return 13;
  }

  get NAMESPACE_ERR(): number {
    return 14;
  }

  get INVALID_ACCESS_ERR(): number {
    return 15;
  }

  get VALIDATION_ERR(): number {
    return 16;
  }

  get TYPE_MISMATCH_ERR(): number {
    return 17;
  }

  get SECURITY_ERR(): number {
    return 18;
  }

  get NETWORK_ERR(): number {
    return 19;
  }

  get ABORT_ERR(): number {
    return 20;
  }

  get URL_MISMATCH_ERR(): number {
    return 21;
  }

  get QUOTA_EXCEEDED_ERR(): number {
    return 22;
  }

  get TIMEOUT_ERR(): number {
    return 23;
  }

  get INVALID_NODE_TYPE_ERR(): number {
    return 24;
  }

  get DATA_CLONE_ERR(): number {
    return 25;
  }

  get code(): number {
    switch (this.name) {
      case "IndexSizeError":
        return 1;
      case "HierarchyRequestError":
        return 3;
      case "WrongDocumentError":
        return 4;
      case "InvalidCharacterError":
        return 5;
      case "NoModificationAllowedError":
        return 7;
      case "NotFoundError":
        return 8;
      case "NotSupportedError":
        return 9;
      case "InUseAttributeError":
        return 10;
      case "InvalidStateError":
        return 11;
      case "SyntaxError":
        return 12;
      case "InvalidModificationError":
        return 13;
      case "NamespaceError":
        return 14;
      case "InvalidAccessError":
        return 15;
      case "TypeMismatchError":
        return 17;
      case "SecurityError":
        return 18;
      case "NetworkError":
        return 19;
      case "AbortError":
        return 20;
      case "URLMismatchError":
        return 21;
      case "QuotaExceededError":
        return 22;
      case "TimeoutError":
        return 23;
      case "InvalidNodeTypeError":
        return 24;
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
