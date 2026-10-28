// The MIT License

// Copyright (c) 2013 Dominic Tarr

// Permission is hereby granted, free of charge, 
// to any person obtaining a copy of this software and 
// associated documentation files (the "Software"), to 
// deal in the Software without restriction, including 
// without limitation the rights to use, copy, modify, 
// merge, publish, distribute, sublicense, and/or sell 
// copies of the Software, and to permit persons to whom 
// the Software is furnished to do so, 
// subject to the following conditions:

// The above copyright notice and this permission notice 
// shall be included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, 
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES 
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR 
// ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


// Source: WebKit/JetStream bigint/web-crypto-sham.js
// Revision: 3967678fa8ab98d847ab33cf3728dba726fa854b
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/web-crypto-sham.js

/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */

// Typed class for the numeric Buffer paths called by the bundled SHA routines.
// No native Buffer is used. Uint8Array subclassing replaces setup-only prototype mutation.
const K_MAX_LENGTH = 0x7fffffff;

function assertSize(size: number): void {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}
function checked(length: number): number {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}
function createBuffer(length: number): ByteBuffer {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new ByteBuffer(length)
  return buf
}
function checkOffset(offset: number, ext: number, length: number): void {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}
function checkInt(buf: ByteBuffer, value: number, offset: number, ext: number, max: number, min: number): void {
  if (!(buf instanceof ByteBuffer)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}
function alloc(size: number): ByteBuffer {
  assertSize(size)
  if (size <= 0) return createBuffer(size)
  return createBuffer(size)
}
function allocUnsafe(size: number): ByteBuffer {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

export class ByteBuffer extends Uint8Array {
  static alloc(size: number): ByteBuffer { return alloc(size) }
  static allocUnsafe(size: number): ByteBuffer { return allocUnsafe(size) }
  readInt32BE(offset: number, noAssert?: boolean): number {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}
  writeUInt32BE(value: number, offset: number, noAssert?: boolean): number {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}
  writeInt32BE(value: number, offset: number, noAssert?: boolean): number {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}
  // The original fill number branch, including its explicit loops and range checks.
  fill(val: number, start?: number, end?: number): this {
    if (typeof val === 'number') val = val & 255
    if (Number(start) < 0 || this.length < Number(start) || this.length < Number(end)) {
      throw new RangeError('Out of range index')
    }
    if (Number(end) <= Number(start)) return this
    start = Number(start) >>> 0
    end = end === undefined ? this.length : end >>> 0
    if (!val) val = 0
    var i
    for (i = start; i < end; ++i) this[i] = val
    return this
  }
}
