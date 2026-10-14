// Are We Fast Yet's NBody, transcribed to AssemblyScript. The two `forEach`
// walks are index loops: AssemblyScript has no closures over locals.
import { Benchmark } from "./awfy";

const PI: f64 = 3.141592653589793;
const SOLAR_MASS: f64 = 4 * PI * PI;
const DAYS_PER_YER: f64 = 365.24;
const STEPS: i32 = 250000;

class Body {
  x: f64;
  y: f64;
  z: f64;
  vx: f64;
  vy: f64;
  vz: f64;
  mass: f64;

  constructor(x: f64, y: f64, z: f64, vx: f64, vy: f64, vz: f64, mass: f64) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx * DAYS_PER_YER;
    this.vy = vy * DAYS_PER_YER;
    this.vz = vz * DAYS_PER_YER;
    this.mass = mass * SOLAR_MASS;
  }

  offsetMomentum(px: f64, py: f64, pz: f64): void {
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
  bodies: Array<Body>;

  constructor() {
    this.bodies = NBodySystem.createBodies();
  }

  static createBodies(): Array<Body> {
    const bodies: Array<Body> = [Body.sun(), Body.jupiter(), Body.saturn(), Body.uranus(), Body.neptune()];
    let px = 0.0;
    let py = 0.0;
    let pz = 0.0;
    for (let i = 0; i < bodies.length; i += 1) {
      const b = bodies[i];
      px += b.vx * b.mass;
      py += b.vy * b.mass;
      pz += b.vz * b.mass;
    }
    bodies[0].offsetMomentum(px, py, pz);
    return bodies;
  }

  advance(dt: f64): void {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i += 1) {
      const iBody = bodies[i];
      for (let j = i + 1; j < bodies.length; j += 1) {
        const jBody = bodies[j];
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
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      body.x += dt * body.vx;
      body.y += dt * body.vy;
      body.z += dt * body.vz;
    }
  }

  energy(): f64 {
    const bodies = this.bodies;
    let e = 0.0;
    for (let i = 0; i < bodies.length; i += 1) {
      const iBody = bodies[i];
      e += 0.5 * iBody.mass * (iBody.vx * iBody.vx + iBody.vy * iBody.vy + iBody.vz * iBody.vz);
      for (let j = i + 1; j < bodies.length; j += 1) {
        const jBody = bodies[j];
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

class NBody extends Benchmark {
  benchmark(): f64 {
    const system = new NBodySystem();
    for (let i = 0; i < STEPS; i += 1) {
      system.advance(0.01);
    }
    return system.energy();
  }

  verifyResult(result: f64): bool {
    return result == -0.1690859889909308;
  }
}

export function work(iterations: i32): i32 {
  return new NBody().innerBenchmarkLoop(iterations) ? 1 : 0;
}
