/*
 * Copyright (C) 2025 Mozilla. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

// JetStream 3.0, WebKit/JetStream@3967678fa8ab98d847ab33cf3728dba726fa854b.
// Full original threejs/benchmark.js. This factory isolates fresh validation
// runs; work retains one driver and the original persistent scene/particles.
// The local RNG is the suite's deterministic Math.random replacement.
import { THREE } from "./three.ts";
import type { RenderCanvas } from "./three.ts";
import { random, resetRandom } from "./random.ts";

function createDriver() {
const NUM_PARTICLES = 8000;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
const innerHeight = 1080;
const innerWidth = 1920;
camera.position.z = 500;

const canvas: RenderCanvas = {
  addEventListener(): undefined {},
  style: {},
  getContext(kind: "webgl2") {
    return {
      getExtension(extension: unknown) {
	if (extension == 'EXT_blend_minmax') {
          return {MIN_EXT: 32775, MAX_EXT: 32776}
	}
	if (extension == 'OES_vertex_array_object') {
          return {
            createVertexArrayOES() { return 1 },
            bindVertexArrayOES(): undefined {},
            deleteVertexArrayOES(): undefined {},
          }
	}
      },
      createTexture(): undefined {},
      bindTexture(): undefined {},
      texImage2D(): undefined {},
      texImage3D(): undefined {},
      texParameteri(): undefined {},
      uniform1i(): undefined {},
      uniform1f(): undefined {},
      uniform2f(): undefined {},
      uniform3f(): undefined {},
      uniform4f(): undefined {},
      clearColor(): undefined {},
      clear(): undefined {},
      clearDepth(): undefined {},
      clearStencil(): undefined {},
      enable(): undefined {},
      disable(): undefined {},
      depthFunc(): undefined {},
      depthMask(): undefined {},
      frontFace(): undefined {},
      cullFace(): undefined {},
      getContextAttributes(): undefined {},
      createBuffer(): undefined {},
      createFramebuffer(): undefined {},
      bindBuffer(): undefined {},
      bufferData(): undefined {},
      createProgram(): undefined {},
      attachShader(): undefined {},
      linkProgram(): undefined {},
      useProgram(): undefined {},
      getAttribLocation(): undefined {},
      getUniformLocation(): undefined {},
      createShader(): undefined {},
      shaderSource(): undefined {},
      compileShader(): undefined {},
      getShaderParameter(): undefined {},
      getProgramInfoLog() { return "" },
      getShaderInfoLog() { return "" },
      getProgramParameter(): undefined {},
      deleteShader(): undefined {},
      colorMask(): undefined {},
      stencilMask(): undefined {},
      createVertexArray(): undefined {},
      bindVertexArray(): undefined {},
      drawElements(): undefined {},
      lineWidth(): undefined {},
      drawArrays(): undefined {},
      viewport(): undefined {},
      getParameter(param: unknown) {
	if (param == 34930) { return 16 }
	if (param == 35660) { return 16 }
	if (param == 3379) { return 8192 }
	if (param == 36347) { return 1024 }
	if (param == 36348) { return 32 }
	if (param == 36349) { return 1024 }
	if (param == 35661) { return 80 }
	if (param == 7938) { return "WebGL 2.0" }
	if (param == 3088) { return [0,0,1024,480] }
	if (param == 2978) { return [0,0,1024,480] }
      },
      MAX_TEXTURE_IMAGE_UNITS: 34930,
      MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660,
      MAX_TEXTURE_SIZE: 3379,
      MAX_VERTEX_UNIFORM_VECTORS: 36347,
      MAX_VARYING_VECTORS: 36348,
      MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
      MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
      VERSION: 7938,
      SCISSOR_BOX: 3088,
      VIEWPORT: 2978
    }
  }
}

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  canvas,
  powerPreference: 'low-power',
  precision: 'lowp'
});
renderer.setSize(innerWidth, innerHeight);

const createGeometryParticle = (size: number) => {
  const visibleHeight = 2 * Math.tan(75 * Math.PI/360) * 500;
  const radius = (size / innerHeight) * visibleHeight / 2;

  // Main circle
  const geometry = new THREE.CircleGeometry(radius, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false
  });
  const circle = new THREE.Mesh(geometry, material);

  const posArray = geometry.attributes.position.array!;
  const outlineVertices: InstanceType<typeof THREE.Vector3>[] = [];
  for (let i = 3; i < posArray.length; i += 3) {
    outlineVertices.push(
      new THREE.Vector3(
        posArray[i],
        posArray[i + 1],
        posArray[i + 2]
      )
    );
  }
  const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlineVertices);
  const outline = new THREE.LineLoop(
    outlineGeometry,
    new THREE.LineBasicMaterial({ color: 0x000000, depthTest: false })
  );

  const group = new THREE.Group();
  group.add(circle);
  group.add(outline);
  return group;
};

// Initialize particles
var initialized = false;
const particles: InstanceType<typeof THREE.Group>[] = [];

function initialize() {
  for(let i = 0; i < NUM_PARTICLES; i++) {
    const size = 10 + random() * 80;
    const particle = createGeometryParticle(size);

    // Random initial position
    const visibleWidth = 2 * Math.tan(75 * Math.PI/360) * 500 * camera.aspect;
    particle.position.set(
      THREE.MathUtils.randFloatSpread(visibleWidth),
      THREE.MathUtils.randFloatSpread(visibleWidth/camera.aspect),
      0
    );

    // Velocity storage
    particle.velocity = new THREE.Vector2(
      (random() - 0.5) * 8,
      (random() - 0.5) * 8
    );

    scene.add(particle);
    particles.push(particle);
  }
  initialized = true;
}

// Metrics and animation
const visibleWidth = 2 * Math.tan(75 * Math.PI/360) * 500 * camera.aspect;
const visibleHeight = visibleWidth / camera.aspect;

function animate() {
  particles.forEach(particle => {
    particle.position.x += particle.velocity!.x;
    particle.position.y += particle.velocity!.y;

    // Boundary checks
    if(Math.abs(particle.position.x) > visibleWidth/2)
      particle.velocity!.x *= -1;
    if(Math.abs(particle.position.y) > visibleHeight/2)
      particle.velocity!.y *= -1;
  });

  renderer.render(scene, camera);
}

class Benchmark {
  runIteration() {
    if (!initialized) {
      initialize();
    }
    animate();
  }
}

  return { benchmark: new Benchmark(), particles, scene, renderer };
}

type Driver = ReturnType<typeof createDriver>;
type ChildSnapshot = [string, number[], number[] | null, number[]];
type ParticleSnapshot = [number, number, number, number, number, ChildSnapshot[]];

interface FrameSnapshot {
  particles: number;
  objects: number;
  geometryCount: number;
  render: { frame: number; calls: number; triangles: number; points: number; lines: number };
  values: ParticleSnapshot[];
}

function snapshot(driver: Driver): FrameSnapshot {
  return {
    particles: driver.particles.length,
    objects: driver.scene.children.length,
    geometryCount: driver.renderer.info.memory.geometries,
    render: { ...driver.renderer.info.render },
    values: driver.particles.map((particle): ParticleSnapshot => {
      const velocity = particle.velocity;
      if (velocity === undefined) throw new Error("Particle has no velocity");
      return [particle.position.x, particle.position.y, particle.position.z,
        velocity.x, velocity.y, particle.children.map((child): ChildSnapshot => {
          if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineLoop)) {
            throw new Error("Unexpected particle child");
          }
          const geometry = child.geometry;
          return [child.type, Array.from(geometry.attributes.position.array!),
            geometry.index ? Array.from(geometry.index.array) : null,
            Array.from(child.matrixWorld.elements)];
        })];
    })
  };
}

// Complete particle, geometry, and matrix output for independent checks.
// Snapshot creation and serialization are outside work and its timing.
export function render(n: number = 1): string {
  const driver = createDriver();
  for (let i = 0; i < n; i++) {
    resetRandom();
    driver.benchmark.runIteration();
  }
  return JSON.stringify(snapshot(driver));
}

const driver = createDriver();

function observe(driver: Driver): number {
  const info = driver.renderer.info;
  let checksum = driver.particles.length;
  checksum = (checksum * 31 + driver.scene.children.length) >>> 0;
  checksum = (checksum * 31 + info.memory.geometries) >>> 0;
  checksum = (checksum * 31 + info.render.calls) >>> 0;
  checksum = (checksum * 31 + info.render.triangles) >>> 0;
  checksum = (checksum * 31 + info.render.points) >>> 0;
  checksum = (checksum * 31 + info.render.lines) >>> 0;
  return checksum;
}

export function work(n: number): number {
  let checksum = 0;
  for (let i = 0; i < n; i++) {
    // JetStream resets its deterministic RNG before each original iteration.
    resetRandom();
    driver.benchmark.runIteration();
    checksum = (checksum * 31 + observe(driver)) >>> 0;
  }
  return checksum;
}

// One complete original frame, preserving all 8,000 particles and 32 segments.
export const seed = 1;
