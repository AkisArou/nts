// Address arithmetic shared by `node:os` and `node:net`.

/**
 * Population count. Node `lib/internal/util.js:807`, and the comment there is
 * the reason it is written this way: counting bits in parallel beats a loop.
 */
function countBinaryOnes(n: number): number {
  n = n - ((n >>> 1) & 0x5555_5555);
  n = (n & 0x3333_3333) + ((n >>> 2) & 0x3333_3333);
  return (((n + (n >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
}

/**
 * `address/prefix`, or `null` when the netmask is not a run of ones.
 * Node `lib/internal/util.js:814`.
 *
 * A netmask has to be contiguous to have a prefix length at all: `255.255.0.0`
 * is `/16`, and `255.0.255.0` is not expressible, so node returns `null` rather
 * than a number that would be wrong.
 */
export function getCIDR(
  address: string,
  netmask: string,
  family: string,
): string | null {
  let ones = 0;
  let split = ".";
  let range = 10;
  let groupLength = 8;
  let hasZeros = false;
  let lastPos = 0;

  if (family === "IPv6") {
    split = ":";
    range = 16;
    groupLength = 16;
  }

  for (let i = 0; i < netmask.length; i++) {
    if (netmask[i] !== split) {
      if (i + 1 < netmask.length) {
        continue;
      }
      i++;
    }
    const part = netmask.slice(lastPos, i);
    lastPos = i + 1;
    if (part !== "") {
      if (hasZeros) {
        if (part !== "0") {
          return null;
        }
      } else {
        const binary = Number.parseInt(part, range);
        const binaryOnes = countBinaryOnes(binary);
        ones += binaryOnes;
        if (binaryOnes !== groupLength) {
          // A group with a zero between ones is not a prefix.
          if (binary.toString(2).includes("01")) {
            return null;
          }
          hasZeros = true;
        }
      }
    }
  }

  return `${address}/${ones}`;
}
