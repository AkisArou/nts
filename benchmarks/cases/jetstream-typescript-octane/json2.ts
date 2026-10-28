/* *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

// Retained JSON2.stringify from Octane/typescript-compiler.js, JetStream
// 3967678fa8ab98d847ab33cf3728dba726fa854b. This is the compiler's own compatibility
// serializer, used by its source-map path. Its eval-based parse entry point and
// dormant Date/String/Number/Boolean prototype bootstrap are not imported.

interface JSON2Object {
    [key: string]: unknown;
    [key: number]: unknown;
}
function isJSON2Object(value: unknown): value is JSON2Object {
    return value !== null && (typeof value === "object" || typeof value === "function");
}
function objectValue(value: unknown): JSON2Object {
    if (isJSON2Object(value)) return value;
    throw new TypeError("Expected JSON2 holder object");
}
function numberValue(value: unknown): number {
    if (typeof value === "number") return value;
    throw new TypeError("Expected JSON2 array-like length");
}
function stringValue(value: unknown): string {
    if (typeof value === "string") return value;
    throw new TypeError("Expected JSON2 string");
}
// Keep the upstream, unreachable case 'null' in the typeof switch. The wider
// return annotation expresses that dispatch spelling without an assertion.
function typeName(value: unknown): string { return typeof value; }

var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
var gap: string, indent: string;
var meta: Record<string, string | undefined> = {
    '\b': '\\b',
    '\t': '\\t',
    '\n': '\\n',
    '\f': '\\f',
    '\r': '\\r',
    '"': '\\"',
    '\\': '\\\\'
};
var rep: unknown;
function quote(string: string): string {
    escapable.lastIndex = 0;
    return escapable.test(string) ? '"' + string.replace(escapable, function (a: string) {
        var c = meta[a];
        return typeof c === 'string' ? c : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
    }) + '"' : '"' + string + '"';
}
function str(key: string | number, holder: JSON2Object): string | undefined {
    var i: number, k: string | null = null, v: string | undefined, length: number, mind = gap, partial: string[], value: unknown = holder[key];
    if (value && typeof value === 'object' && typeof objectValue(value).toJSON === 'function') {
        const method: unknown = objectValue(value).toJSON;
        if (typeof method !== 'function') throw new TypeError("Expected JSON2 toJSON method");
        value = method.call(value, key);
    }
    if (typeof rep === 'function') {
        value = rep.call(holder, key, value);
    }
    switch (typeName(value)) {
        case 'string': {
            return quote(stringValue(value));
        }
        case 'number': {
            return isFinite(numberValue(value)) ? String(value) : 'null';
        }
        case 'boolean':
        case 'null': {
            return String(value);
        }
        case 'object': {
            if (!value) {
                return 'null';
            }
            gap += indent;
            partial = [];
            if (Object.prototype.toString.apply(value, []) === '[object Array]') {
                length = numberValue(objectValue(value).length);
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, objectValue(value)) || 'null';
                }
                v = partial.length === 0 ? '[]' : gap ? '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']' : '[' + partial.join(',') + ']';
                gap = mind;
                return v;
            }
            if (rep && typeof rep === 'object') {
                length = numberValue(objectValue(rep).length);
                for (i = 0; i < length; i += 1) {
                    if (typeof objectValue(rep)[i] === 'string') {
                        k = stringValue(objectValue(rep)[i]);
                        v = str(k, objectValue(value));
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            } else {
                for (k in objectValue(value)) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, objectValue(value));
                        if (v) {
                            partial.push(quote(k) + (gap ? ': ' : ':') + v);
                        }
                    }
                }
            }
            v = partial.length === 0 ? '{}' : gap ? '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}' : '{' + partial.join(',') + '}';
            gap = mind;
            return v;
        }
    }
}
function stringify(value: unknown, replacer?: unknown, space?: unknown): string | undefined {
    var i: number;
    gap = '';
    indent = '';
    if (typeof space === 'number') {
        for (i = 0; i < space; i += 1) {
            indent += ' ';
        }
    } else {
        if (typeof space === 'string') {
            indent = space;
        }
    }
    rep = replacer;
    if (replacer && typeof replacer !== 'function' && (typeof replacer !== 'object' || typeof objectValue(replacer).length !== 'number')) {
        throw new Error('JSON.stringify');
    }
    return str('', {
        '': value
    });
}

export const JSON2 = { stringify };
