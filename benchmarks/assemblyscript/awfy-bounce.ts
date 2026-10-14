// Are We Fast Yet's Bounce, transcribed to AssemblyScript. The balls are walked
// with an index rather than `for...of`, which AssemblyScript does not have.
import { Benchmark, Random } from "./awfy";

class Ball {
  x: i32;
  y: i32;
  xVel: i32;
  yVel: i32;

  constructor(random: Random) {
    this.x = random.next() % 500;
    this.y = random.next() % 500;
    this.xVel = (random.next() % 300) - 150;
    this.yVel = (random.next() % 300) - 150;
  }

  bounce(): bool {
    const xLimit = 500;
    const yLimit = 500;
    let bounced = false;
    this.x += this.xVel;
    this.y += this.yVel;
    if (this.x > xLimit) {
      this.x = xLimit;
      this.xVel = 0 - abs(this.xVel);
      bounced = true;
    }
    if (this.x < 0) {
      this.x = 0;
      this.xVel = abs(this.xVel);
      bounced = true;
    }
    if (this.y > yLimit) {
      this.y = yLimit;
      this.yVel = 0 - abs(this.yVel);
      bounced = true;
    }
    if (this.y < 0) {
      this.y = 0;
      this.yVel = abs(this.yVel);
      bounced = true;
    }
    return bounced;
  }
}

class Bounce extends Benchmark {
  benchmark(): f64 {
    const random = new Random();
    const ballCount = 100;
    let bounces = 0;
    const balls = new Array<Ball>(ballCount);
    for (let i = 0; i < ballCount; i += 1) {
      balls[i] = new Ball(random);
    }
    for (let i = 0; i < 50; i += 1) {
      for (let b = 0; b < balls.length; b += 1) {
        if (balls[b].bounce()) {
          bounces += 1;
        }
      }
    }
    return bounces;
  }

  verifyResult(result: f64): bool {
    return result == 1331;
  }
}

export function work(iterations: i32): i32 {
  return new Bounce().innerBenchmarkLoop(iterations) ? 1 : 0;
}
