// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
export interface EsprimaError extends Error {
    name: string;
    message: string;
    index: number;
    lineNumber: number;
    column: number;
    description: string;
    // constructor(message: string);
}

export class ErrorHandler {
    readonly errors: EsprimaError[];
    tolerant: boolean;

    constructor() {
        this.errors = [];
        this.tolerant = false;
    }

    recordError(error: EsprimaError): void {
        this.errors.push(error);
    }

    tolerate(error: EsprimaError): void {
        if (this.tolerant) {
            this.recordError(error);
        } else {
            throw error;
        }
    }

    constructError(msg: string, column: number): Error {
        let error = new Error(msg);
        try {
            throw error;
        } catch (base) {
            /* istanbul ignore else */
            if (Object.create && Object.defineProperty) {
                if (!(base instanceof Error)) throw base;
                const created: unknown = Object.create(base);
                if (!(created instanceof Error)) throw new TypeError("Expected inherited Error");
                error = created;
                Object.defineProperty(error, 'column', { value: column });
            }
        }
        /* istanbul ignore next */
        return error;
    }

    createError(index: number, line: number, col: number, description: string): EsprimaError {
        const msg = 'Line ' + line + ': ' + description;
        const _error: Error & Partial<EsprimaError> = this.constructError(msg, col);
        _error.index = index;
        _error.lineNumber = line;
        _error.description = description;
        const error = esprimaError(_error)
        return error;
    }

    throwError(index: number, line: number, col: number, description: string): never {
        throw this.createError(index, line, col, description);
    }

    tolerateError(index: number, line: number, col: number, description: string) {
        const error = this.createError(index, line, col, description);
        if (this.tolerant) {
            this.recordError(error);
        } else {
            throw error;
        }
    }

}

function isEsprimaError(value: unknown): value is EsprimaError {
 return value instanceof Error && "index" in value && typeof value.index === "number" && "lineNumber" in value && typeof value.lineNumber === "number" && "column" in value && typeof value.column === "number" && "description" in value && typeof value.description === "string";
}
export function esprimaError(value: unknown): EsprimaError {
 if (!(value instanceof Error) || !("index" in value) || typeof value.index !== "number" || !("lineNumber" in value) || typeof value.lineNumber !== "number" || !("column" in value) || typeof value.column !== "number" || !("description" in value) || typeof value.description !== "string") throw value;
 if (isEsprimaError(value)) return value;
 throw value;
}
