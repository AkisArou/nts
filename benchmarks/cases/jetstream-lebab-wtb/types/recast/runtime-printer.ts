// Checked layouts for the complete pinned Recast printer. Every printer case remains in printer.ts.
import {isRecord} from "../../webpack.ts";
import {load as loadLines} from "../../vendor/recast/lib/lines.ts";
import {load as loadAstTypes} from "../../vendor/ast-types/lib/main.ts";
import type {namedTypes as NT} from "../ast-types/gen/namedTypes.js";
import type {RuntimeFastPath} from "./runtime-fast-path.ts";
import type {Lines} from "./lib/lines.js";

export type LinePart = string | Lines;
export interface PrintOptions { includeComments?: boolean; avoidRootParens?: boolean; }
export type PrintFunction = (path: RuntimeFastPath) => Lines;
export type RawLiteral = NT.Literal | NT.NumericLiteral | NT.StringLiteral | NT.RegExpLiteral | NT.BigIntLiteral | NT.DecimalLiteral | NT.BooleanLiteral | NT.DirectiveLiteral;
type LegacyPrinterKind = "Path" | "ModuleDeclaration" | "ModuleSpecifier" | "TypeAnnotatedIdentifier" | "Node" | "Printable" | "SourceLocation" | "Position" | "Statement" | "Function" | "Pattern" | "Expression" | "Declaration" | "Specifier" | "NamedSpecifier" | "Comment" | "Flow" | "FlowType" | "FlowPredicate" | "Type" | "TSHasOptionalTypeParameterInstantiation" | "TSHasOptionalTypeParameters" | "TSHasOptionalTypeAnnotation" | "ChainElement" | "TSType" | "ClassHeritage" | "Glob" | "LetStatement" | "LetExpression" | "GraphExpression" | "GraphIndexExpression" | "XMLDefaultDeclaration" | "XMLAnyName" | "XMLQualifiedIdentifier" | "XMLFunctionQualifiedIdentifier" | "XMLAttributeSelector" | "XMLFilterExpression" | "XML" | "XMLElement" | "XMLList" | "XMLEscape" | "XMLText" | "XMLStartTag" | "XMLEndTag" | "XMLPointTag" | "XMLName" | "XMLAttribute" | "XMLCdata" | "XMLComment" | "XMLProcessingInstruction";
interface LegacyPrinterNode extends Record<PropertyKey, unknown> { type: LegacyPrinterKind; }
export type PrinterNode = (NT.ASTNode | LegacyPrinterNode) & Record<PropertyKey, unknown>;
function isLegacyPrinterNode(value: Record<PropertyKey, unknown>): value is LegacyPrinterNode {
    switch (value.type) {
        case "Path":
        case "ModuleDeclaration":
        case "ModuleSpecifier":
        case "TypeAnnotatedIdentifier":
        case "Node":
        case "Printable":
        case "SourceLocation":
        case "Position":
        case "Statement":
        case "Function":
        case "Pattern":
        case "Expression":
        case "Declaration":
        case "Specifier":
        case "NamedSpecifier":
        case "Comment":
        case "Flow":
        case "FlowType":
        case "FlowPredicate":
        case "Type":
        case "TSHasOptionalTypeParameterInstantiation":
        case "TSHasOptionalTypeParameters":
        case "TSHasOptionalTypeAnnotation":
        case "ChainElement":
        case "TSType":
        case "ClassHeritage":
        case "Glob":
        case "LetStatement":
        case "LetExpression":
        case "GraphExpression":
        case "GraphIndexExpression":
        case "XMLDefaultDeclaration":
        case "XMLAnyName":
        case "XMLQualifiedIdentifier":
        case "XMLFunctionQualifiedIdentifier":
        case "XMLAttributeSelector":
        case "XMLFilterExpression":
        case "XML":
        case "XMLElement":
        case "XMLList":
        case "XMLEscape":
        case "XMLText":
        case "XMLStartTag":
        case "XMLEndTag":
        case "XMLPointTag":
        case "XMLName":
        case "XMLAttribute":
        case "XMLCdata":
        case "XMLComment":
        case "XMLProcessingInstruction":
            return true;
        default: return false;
    }
}
export function printerNode(value: unknown): PrinterNode {
    if (!isRecord(value)) throw new TypeError("Expected an original Recast printer node");
    const n = loadAstTypes().namedTypes;
    if (n.Printable.check(value) || n.EnumBooleanBody.check(value) || n.EnumNumberBody.check(value) || n.EnumStringBody.check(value) || n.EnumSymbolBody.check(value) || n.EnumBooleanMember.check(value) || n.EnumNumberMember.check(value) || n.EnumStringMember.check(value) || n.EnumDefaultedMember.check(value) || isLegacyPrinterNode(value)) return value;
    throw new TypeError("Expected a known Recast printer node kind");
}

export function printerArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new TypeError("Expected an original printer array");
    return value;
}
export function printerIndex(value: unknown): number {
    if (typeof value !== "number") throw new TypeError("Expected a printer array-path index");
    return value;
}
export function printerPresent<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new TypeError("Expected a present printer value");
    return value;
}
export function printerString(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected a printer string");
    return value;
}

export function printerLines(value: unknown): Lines {
    if (!(value instanceof loadLines().Lines)) throw new TypeError("Expected the original Recast Lines instance");
    return value;
}

interface PrinterPosition { line: number; column: number; }
interface PrinterLocation { start: PrinterPosition; end: PrinterPosition; }
function isPrinterPosition(value: unknown): value is PrinterPosition {
    return isRecord(value) && typeof value.line === "number" && typeof value.column === "number";
}
function isPrinterLocation(value: unknown): value is PrinterLocation {
    return isRecord(value) && isPrinterPosition(value.start) && isPrinterPosition(value.end);
}
export function printerLocation(value: unknown): PrinterLocation {
    if (!isPrinterLocation(value)) throw new TypeError("Expected a printer source location");
    return value;
}
