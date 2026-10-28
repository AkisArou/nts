// Shared structural AST types from the exact bundled ast-types declarations.
import type * as K from "./types/ast-types/gen/kinds.js";
export type AstNode = K.NodeKind;
export interface Warning { line: number; msg: string; type: string; }
export interface LoggerLike { warn(node: AstNode, msg: string, type: string): void; getWarnings(): Warning[]; }
export type Transform = (program: AstNode, logger: LoggerLike) => void;

export type VariableKind = "var" | "let" | "const";
export interface VariableLike {
  node: AstNode; group: VariableGroupLike | undefined; declared: boolean; hoisted: boolean; modified: boolean;
  markDeclared(): void; isDeclared(): boolean; markHoisted(): void; markModified(): void;
  getKind(): VariableKind; getNode(): AstNode; getGroup(): VariableGroupLike | undefined;
}
export interface VariableGroupLike {
  node: K.VariableDeclarationKind; parentNode: AstNode | null; variables: VariableLike[];
  add(variable: VariableLike): void; getVariables(): VariableLike[];
  getCommonKind(): VariableKind | undefined; getMostRestrictiveKind(): VariableKind;
  getNode(): K.VariableDeclarationKind; getParentNode(): AstNode | null;
}
export type ScopeEntry = VariableLike | ScopeEntry[];
export interface ScopeLike {
  parent: ScopeLike | undefined; vars: Record<PropertyKey, ScopeEntry[]>;
  register(name: unknown, variable: ScopeEntry): void;
  getParent(): ScopeLike | undefined; getVariables(): ScopeEntry[];
  findFunctionScoped(name: unknown): ScopeEntry[]; findBlockScoped(name: unknown): ScopeEntry[];
}
export interface ScopeManagerLike {
  scope: ScopeLike | undefined; enterFunction(): void; enterBlock(): void; leaveScope(): void; getScope(): ScopeLike | undefined;
}
function isTransformList(value: unknown): value is Transform[] { return Array.isArray(value) && value.every((fn: unknown) => typeof fn === "function"); }
export function transformList(value: unknown): Transform[] { if (!isTransformList(value)) throw new TypeError("Expected the configured transform functions"); return value; }

export function scopeVariable(value: ScopeEntry): VariableLike {
  if (Array.isArray(value)) throw new TypeError("Expected the original variable entry at a variable method access");
  return value;
}
