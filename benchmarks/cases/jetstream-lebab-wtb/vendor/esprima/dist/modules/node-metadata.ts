// Erased metadata contracts for the original Esprima node augmentation phases.
import type {SourceLocation} from "./scanner.ts";
import type {AttachedComment} from "./comment-handler.ts";
export interface BaseNode {
    type: string;
    async?: boolean;
    range?: [number, number];
    loc?: SourceLocation;
    leadingComments?: AttachedComment[];
    trailingComments?: AttachedComment[];
    innerComments?: AttachedComment[];
}
export interface Metadata {
    start: {line: number; column: number; offset: number};
    end: {line: number; column: number; offset: number};
}
export type Delegate = (node: BaseNode, metadata: Metadata) => void;
export interface ParserOptions {
    range?: unknown;
    loc?: unknown;
    source?: unknown;
    tokens?: unknown;
    comment?: unknown;
    tolerant?: unknown;
    attachComment?: unknown;
    sourceType?: unknown;
    jsx?: unknown;
    locations?: unknown;
    onComment?: unknown;
}
