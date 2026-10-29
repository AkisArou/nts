// The original parser's mutable source coordinates and metadata fields.
import {isRecord} from '../../webpack.ts';
export interface SourcePosition { line: number; column: number; token?: number; }
export interface SourceLocation {
    start: SourcePosition;
    end: SourcePosition;
    tokens?: unknown[];
    lines?: unknown;
    indent?: number;
    source?: unknown;
}
export interface SourceToken { value?: unknown; loc: SourceLocation; }
export function sourcePosition(value: unknown): SourcePosition {
    if (isSourcePosition(value)) return value;
    throw new TypeError('Expected source position');
}
export function isSourcePosition(value: unknown): value is SourcePosition {
    return isRecord(value) && typeof value.line === 'number' && typeof value.column === 'number' &&
        (value.token === undefined || typeof value.token === 'number');
}
export function sourceLocation(value: unknown): SourceLocation {
    if (isSourceLocation(value)) return value;
    throw new TypeError('Expected source location');
}
export function isSourceLocation(value: unknown): value is SourceLocation {
    return isRecord(value) && isSourcePosition(value.start) && isSourcePosition(value.end) &&
        (value.tokens === undefined || Array.isArray(value.tokens)) &&
        (value.indent === undefined || typeof value.indent === 'number');
}
export function sourceToken(value: unknown): SourceToken {
    if (isSourceToken(value)) return value;
    throw new TypeError('Expected source token');
}
export function isSourceToken(value: unknown): value is SourceToken {
    return isRecord(value) && isSourceLocation(value.loc);
}
