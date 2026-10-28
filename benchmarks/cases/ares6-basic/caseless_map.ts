/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */
"use strict";

// Transcribed from WebKit ARES-6, revision b64265f153b3178bfb4ca9f51736289f57982fce:
// https://github.com/WebKit/WebKit/blob/b64265f153b3178bfb4ca9f51736289f57982fce/PerformanceTests/ARES-6/Basic/caseless_map.js
// Original license retained above; shared notices: ../LICENSE-ares6.

import type { Name } from "./types.ts";

export class CaselessMap<T> {
    declare _map: Map<string, T>;
    constructor(otherMap?: CaselessMap<T>)
    {
        if (otherMap == null)
            this._map = new Map<string, T>();
        else
            this._map = new Map(otherMap._map);
    }
    
    set(key: Name, value: T): void
    {
        this._map.set(lowerCaseName(key), value);
    }
    
    has(key: Name): boolean
    {
        return this._map.has(lowerCaseName(key));
    }
    
    get(key: Name): T | undefined
    {
        return this._map.get(lowerCaseName(key));
    }

    [Symbol.iterator](): MapIterator<[string, T]>
    {
        return this._map[Symbol.iterator]();
    }
}


// DEF supplies a token instead of a name in the upstream interpreter. Retain
// its TypeError while narrowing the key before the ordinary string operation.
function lowerCaseName(key: Name): string
{
    if (typeof key !== "string")
        throw new TypeError("key.toLowerCase is not a function");
    return key.toLowerCase();
}
