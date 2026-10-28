// Esprima-next 6.0.3, BSD-2-Clause; original notice in esprima.ts and ../LICENSE-jetstream.
// Strict TypeScript transcription of the source embedded in the pinned JetStream bundle.
import { JSXSyntax } from './jsx-syntax.ts';
import type * as Node from './nodes.ts';

export type JSXAttributeName = JSXIdentifier | JSXNamespacedName;
export type JSXAttributeValue = Node.Literal | JSXElement | JSXSpreadAttribute | JSXExpressionContainer;
export type JSXChild = JSXElement | JSXExpressionContainer | JSXText;
export type JSXElementAttribute = JSXAttribute | JSXSpreadAttribute;
export type JSXElementName = JSXIdentifier | JSXNamespacedName | JSXMemberExpression;

export class JSXClosingElement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXClosingElement;
    readonly name: JSXElementName;
    constructor(name: JSXElementName) {
        this.type = JSXSyntax.JSXClosingElement;
        this.name = name;
    }
}

export class JSXClosingFragment {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXClosingFragment;
    constructor() {
        this.type = JSXSyntax.JSXClosingFragment;
    }
}

export class JSXElement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXElement;
    readonly openingElement: JSXOpeningElement | JSXOpeningFragment;
    readonly children: JSXChild[];
    readonly closingElement: JSXClosingElement | JSXClosingFragment | null;
    constructor(
        openingElement: JSXOpeningElement | JSXOpeningFragment,
        children: JSXChild[],
        closingElement: JSXClosingElement | JSXClosingFragment | null
    ) {
        this.type = JSXSyntax.JSXElement;
        this.openingElement = openingElement;
        this.children = children;
        this.closingElement = closingElement;
    }
}

export class JSXEmptyExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXEmptyExpression;
    constructor() {
        this.type = JSXSyntax.JSXEmptyExpression;
    }
}

export class JSXExpressionContainer {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXExpressionContainer;
    readonly expression: Node.Expression | JSXEmptyExpression;
    constructor(expression: Node.Expression | JSXEmptyExpression) {
        this.type = JSXSyntax.JSXExpressionContainer;
        this.expression = expression;
    }
}

export class JSXIdentifier {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXIdentifier;
    readonly name: string;
    constructor(name: string) {
        this.type = JSXSyntax.JSXIdentifier;
        this.name = name;
    }
}

export class JSXMemberExpression {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXMemberExpression;
    readonly object: JSXMemberExpression | JSXIdentifier;
    readonly property: JSXIdentifier;
    constructor(object: JSXMemberExpression | JSXIdentifier, property: JSXIdentifier) {
        this.type = JSXSyntax.JSXMemberExpression;
        this.object = object;
        this.property = property;
    }
}

export class JSXAttribute {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXAttribute;
    readonly name: JSXAttributeName;
    readonly value: JSXAttributeValue | null;
    constructor(name: JSXAttributeName, value: JSXAttributeValue | null) {
        this.type = JSXSyntax.JSXAttribute;
        this.name = name;
        this.value = value;
    }
}

export class JSXNamespacedName {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXNamespacedName;
    readonly namespace: JSXIdentifier;
    readonly name: JSXIdentifier;
    constructor(namespace: JSXIdentifier, name: JSXIdentifier) {
        this.type = JSXSyntax.JSXNamespacedName;
        this.namespace = namespace;
        this.name = name;
    }
}

export class JSXOpeningElement {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXOpeningElement;
    readonly name: JSXElementName;
    readonly selfClosing: boolean;
    readonly attributes: JSXElementAttribute[];
    constructor(name: JSXElementName, selfClosing: boolean, attributes: JSXElementAttribute[]) {
        this.type = JSXSyntax.JSXOpeningElement;
        this.name = name;
        this.selfClosing = selfClosing;
        this.attributes = attributes;
    }
}

export class JSXOpeningFragment {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXOpeningFragment;
    readonly selfClosing: boolean;
    constructor(selfClosing: boolean) {
        this.type = JSXSyntax.JSXOpeningFragment;
        this.selfClosing = selfClosing;
    }
}

export class JSXSpreadAttribute {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXSpreadAttribute;
    readonly argument: Node.Expression;
    constructor(argument: Node.Expression) {
        this.type = JSXSyntax.JSXSpreadAttribute;
        this.argument = argument;
    }
}

export class JSXText {
    declare range?: [number, number];
    declare loc?: import("./scanner.ts").SourceLocation;
    declare leadingComments?: import("./comment-handler.ts").Comment[];
    declare trailingComments?: import("./comment-handler.ts").Comment[];
    declare innerComments?: import("./comment-handler.ts").Comment[];

    readonly type: typeof JSXSyntax.JSXText;
    readonly value: string;
    readonly raw: string;
    constructor(value: string, raw: string) {
        this.type = JSXSyntax.JSXText;
        this.value = value;
        this.raw = raw;
    }
}
