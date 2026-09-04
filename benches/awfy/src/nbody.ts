// Ported from `benchmarks/JavaScript/nbody.js`.
//
// The Computer Language Benchmarks Game's n-body, by way of SOM. Two hundred
// and fifty thousand steps of a five-body solar system, which is what the
// suite's recorded result is for -- so the loop count is part of the check
// rather than a knob.
//
// Two things here that no other micro benchmark has: *static* methods, which
// are the constructors of the five bodies, and `forEach` over an array with a
// closure, which the suite uses twice and which is worth compiling as a loop
// rather than as a call.

import { Benchmark } from "./benchmark.ts";

const PI = 3.141592653589793;
const SOLAR_MASS = 4 * PI * PI;
const DAYS_PER_YER = 365.24;

// Are We Fast Yet passes this to `innerBenchmarkLoop`; here it is a constant
// for the same reason every other port has one, and it is not adjustable: the
// number `verifyResult` checks is the energy after exactly this many steps.
const STEPS = 250000;

class Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  mass: number;

  constructor(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    mass: number,
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx * DAYS_PER_YER;
    this.vy = vy * DAYS_PER_YER;
    this.vz = vz * DAYS_PER_YER;
    this.mass = mass * SOLAR_MASS;
  }

  offsetMomentum(px: number, py: number, pz: number): void {
    this.vx = 0.0 - px / SOLAR_MASS;
    this.vy = 0.0 - py / SOLAR_MASS;
    this.vz = 0.0 - pz / SOLAR_MASS;
  }

  static jupiter(): Body {
    return new Body(
      4.84143144246472090e00,
      -1.16032004402742839e00,
      -1.03622044471123109e-01,
      1.66007664274403694e-03,
      7.69901118419740425e-03,
      -6.90460016972063023e-05,
      9.54791938424326609e-04,
    );
  }

  static saturn(): Body {
    return new Body(
      8.34336671824457987e00,
      4.12479856412430479e00,
      -4.03523417114321381e-01,
      -2.76742510726862411e-03,
      4.99852801234917238e-03,
      2.30417297573763929e-05,
      2.85885980666130812e-04,
    );
  }

  static uranus(): Body {
    return new Body(
      1.28943695621391310e01,
      -1.51111514016986312e01,
      -2.23307578892655734e-01,
      2.96460137564761618e-03,
      2.37847173959480950e-03,
      -2.96589568540237556e-05,
      4.36624404335156298e-05,
    );
  }

  static neptune(): Body {
    return new Body(
      1.53796971148509165e01,
      -2.59193146099879641e01,
      1.79258772950371181e-01,
      2.68067772490389322e-03,
      1.62824170038242295e-03,
      -9.51592254519715870e-05,
      5.15138902046611451e-05,
    );
  }

  static sun(): Body {
    return new Body(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0);
  }
}

class NBodySystem {
  bodies: Body[];

  constructor() {
    this.bodies = this.createBodies();
  }

  createBodies(): Body[] {
    const bodies = [
      Body.sun(),
      Body.jupiter(),
      Body.saturn(),
      Body.uranus(),
      Body.neptune(),
    ];

    let px = 0.0;
    let py = 0.0;
    let pz = 0.0;

    bodies.forEach((b) => {
      px += b.vx * b.mass;
      py += b.vy * b.mass;
      pz += b.vz * b.mass;
    });

    bodies[0].offsetMomentum(px, py, pz);

    return bodies;
  }

  advance(dt: number): void {
    for (let i = 0; i < this.bodies.length; i += 1) {
      const iBody = this.bodies[i];

      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const jBody = this.bodies[j];
        const dx = iBody.x - jBody.x;
        const dy = iBody.y - jBody.y;
        const dz = iBody.z - jBody.z;

        const dSquared = dx * dx + dy * dy + dz * dz;
        const distance = Math.sqrt(dSquared);
        const mag = dt / (dSquared * distance);

        iBody.vx -= dx * jBody.mass * mag;
        iBody.vy -= dy * jBody.mass * mag;
        iBody.vz -= dz * jBody.mass * mag;

        jBody.vx += dx * iBody.mass * mag;
        jBody.vy += dy * iBody.mass * mag;
        jBody.vz += dz * iBody.mass * mag;
      }
    }

    this.bodies.forEach((body) => {
      body.x += dt * body.vx;
      body.y += dt * body.vy;
      body.z += dt * body.vz;
    });
  }

  energy(): number {
    let e = 0.0;

    for (let i = 0; i < this.bodies.length; i += 1) {
      const iBody = this.bodies[i];
      e += 0.5 * iBody.mass *
        (iBody.vx * iBody.vx + iBody.vy * iBody.vy + iBody.vz * iBody.vz);

      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const jBody = this.bodies[j];
        const dx = iBody.x - jBody.x;
        const dy = iBody.y - jBody.y;
        const dz = iBody.z - jBody.z;

        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        e -= (iBody.mass * jBody.mass) / distance;
      }
    }
    return e;
  }
}

export class NBody extends Benchmark {
  override benchmark(): number {
    const system = new NBodySystem();
    for (let i = 0; i < STEPS; i += 1) {
      system.advance(0.01);
    }
    return system.energy();
  }

  override verifyResult(result: number): boolean {
    return result === -0.1690859889909308;
  }
}
