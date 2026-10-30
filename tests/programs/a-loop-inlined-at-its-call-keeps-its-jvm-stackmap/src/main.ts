// This code is derived from the SOM benchmark, which is itself based on the
// Java version.
//
// Copyright (c) 2015-2016 Stefan Marr <git@stefan-marr.de>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Reduced from AWFY Json, upstream 74306fec151070fd07157cefeacf19e7e0bcdc89.
// The control changes only the skipWhiteSpace call to its inline loop.
class Parser {
  declare input: string;
  declare index: number;
  declare line: number;
  declare column: number;
  declare current: string | null;
  constructor(string: string) {
    this.input = string;
    this.index = -1;
    this.line = 1;
    this.column = 0;
    this.current = null;
  }
  skipWhiteSpace(): void {
    while (this.isWhiteSpace()) {
      this.read();
    }
  }

  read(): void {
    if ("\n" === this.current) {
      this.line += 1;
      this.column = 0;
    }
    this.index += 1;
    if (this.index < this.input.length) {
      this.current = this.input.substring(this.index, this.index + 1);
    } else {
      this.current = null;
    }
  }

  isWhiteSpace(): boolean {
    return " " === this.current || "\t" === this.current
      || "\n" === this.current || "\r" === this.current;
  }

}
export function work(text: string): number {
  const parser = new Parser(text);
  parser.read();
  while (parser.isWhiteSpace()) { parser.read(); }
  return parser.index;
}
