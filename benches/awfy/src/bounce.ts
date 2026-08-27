// Ported from `benchmarks/JavaScript/bounce.js`.

import { Random } from "./som";

class Ball {
  x: number;
  y: number;
  xVel: number;
  yVel: number;

  constructor(random: Random) {
    this.x = random.next() % 500;
    this.y = random.next() % 500;
    this.xVel = (random.next() % 300) - 150;
    this.yVel = (random.next() % 300) - 150;
  }

  bounce(): boolean {
    const xLimit = 500;
    const yLimit = 500;
    let bounced = false;

    this.x += this.xVel;
    this.y += this.yVel;

    if (this.x > xLimit) {
      this.x = xLimit; this.xVel = 0 - Math.abs(this.xVel); bounced = true;
    }

    if (this.x < 0) {
      this.x = 0; this.xVel = Math.abs(this.xVel); bounced = true;
    }

    if (this.y > yLimit) {
      this.y = yLimit; this.yVel = 0 - Math.abs(this.yVel); bounced = true;
    }

    if (this.y < 0) {
      this.y = 0; this.yVel = Math.abs(this.yVel); bounced = true;
    }

    return bounced;
  }
}

export function bounce(): number {
  const random = new Random();
  const ballCount = 100;
  let bounces = 0;
  const balls: Ball[] = new Array(ballCount);
  let i = 0;

  for (i = 0; i < ballCount; i += 1) {
    balls[i] = new Ball(random);
  }

  for (i = 0; i < 50; i += 1) {
    for (const ball of balls) {
      if (ball.bounce()) {
        bounces += 1;
      }
    }
  }
  return bounces;
}
