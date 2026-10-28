import type {AstNode} from "./ast.ts";
import type {namedTypes as N} from "./types/ast-types/gen/namedTypes.js";
import type {VisitorOptions} from "./vendor/esrecurse/esrecurse.ts";

export interface ScopeOptions extends VisitorOptions {
    optimistic?: boolean;
    directive?: boolean;
    ignoreEval?: boolean;
    nodejsScope?: boolean;
    impliedStrict?: boolean;
    sourceType?: string;
    ecmaVersion?: number;
}
export type AssignmentNode = N.AssignmentPattern | N.AssignmentExpression;
export interface PatternInfo {topLevel: boolean; rest: boolean; assignments: AssignmentNode[];}
export type PatternCallback = (pattern: N.Identifier, info: PatternInfo) => void;
export interface PatternOptions {processRightHandNodes: boolean;}
export interface ImplicitGlobal {pattern: N.Identifier; node: AstNode;}
export type FunctionNode = N.FunctionDeclaration | N.FunctionExpression | N.ArrowFunctionExpression;
export type LoopNode = N.ForInStatement | N.ForOfStatement;
export type ImportNode = N.ImportSpecifier | N.ImportDefaultSpecifier | N.ImportNamespaceSpecifier;
export type ScopeDeclarator = N.VariableDeclarator | ((N.Identifier | N.JSXIdentifier | N.TSTypeParameter) & {id?: undefined; init?: undefined});
export interface ScopeDescriptor {key: PropertyKey; value?: unknown; get?: () => unknown; set?: (value: unknown) => void; enumerable?: boolean; configurable?: boolean; writable?: boolean;}
export interface MutableScopeConstructor {prototype: object | null; __proto__?: unknown;}
