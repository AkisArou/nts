// The ray tracer code in this file is written by Adam Burmister.
// It is available in its original form from:
//
//   http://labs.flog.nz.co/raytracer/
//
// It has been modified slightly by Google to work as a standalone benchmark,
// but all the computational code remains untouched.

// For JetStream3, this code was rewritten using ES6 classes and private fields,
// dropping namespaces and Prototype.js class system, as well as slightly refactored.
// All the computational code still remains untouched.

// Transcribed from JetStream 3.0, revision 3967678fa8ab98d847ab33cf3728dba726fa854b:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/class-fields/raytrace-private-class-fields.js
// All original field initializers, scene values, methods, and 15 renders remain.
// Type-related checked narrowing and post-validation observations are documented
// in README.md and provenance.json. Companion notices: ../LICENSE-jetstream.

// Copyright 2010 the V8 project authors. All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
//       copyright notice, this list of conditions and the following
//       disclaimer in the documentation and/or other materials provided
//       with the distribution.
//     * Neither the name of Google Inc. nor the names of its
//       contributors may be used to endorse or promote products derived
//       from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/*
Copyright (C) 2007-2024 Apple Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
 notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
 notice, this list of conditions and the following disclaimer in the
 documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
THE POSSIBILITY OF SUCH DAMAGE.
*/

interface EngineOptions {
    canvasHeight: number;
    canvasWidth: number;
    pixelWidth: number;
    pixelHeight: number;
    renderDiffuse: boolean;
    renderShadows: boolean;
    renderHighlights: boolean;
    renderReflections: boolean;
    rayDepth: number;
}

// Null remains a real field value; a check is added only where the original
// operation dereferences it or passes it to a vector operation.
function requireValue<T>(value: T | null | undefined, property: string): T {
    if (value === null || value === undefined)
        throw new TypeError(`Cannot read properties of ${value} (reading '${property}')`);
    return value;
}

let lastCheckNumber: number = 0;
let renderChecksum: number = 0;
let completedRenders: number = 0;

export class Color {
    #red: number = 0;
    #green: number = 0;
    #blue: number = 0;

    constructor(red: number, green: number, blue: number) {
        this.#red = red;
        this.#green = green;
        this.#blue = blue;
    }

    static add(c1: Color, c2: Color): Color {
        return new Color(c1.#red + c2.#red, c1.#green + c2.#green, c1.#blue + c2.#blue);
    }

    static addScalar(c1: Color, s: number): Color {
        return new Color(c1.#red + s, c1.#green + s, c1.#blue + s).limit();
    }

    static multiply(c1: Color, c2: Color): Color {
        return new Color(c1.#red * c2.#red, c1.#green * c2.#green, c1.#blue * c2.#blue);
    }

    static multiplyScalar(c1: Color, f: number): Color {
        return new Color(c1.#red * f, c1.#green * f, c1.#blue * f);
    }

    static blend(c1: Color, c2: Color, w: number): Color {
        return Color.add(
            Color.multiplyScalar(c1, 1 - w),
            Color.multiplyScalar(c2, w),
        );
    }

    limit(): Color {
        this.#red = this.#red > 0 ? (this.#red > 1 ? 1 : this.#red) : 0;
        this.#green = this.#green > 0 ? (this.#green > 1 ? 1 : this.#green) : 0;
        this.#blue = this.#blue > 0 ? (this.#blue > 1 ? 1 : this.#blue) : 0;

        return this;
    }

    brightness(): number {
        const r = Math.floor(this.#red * 255);
        const g = Math.floor(this.#green * 255);
        const b = Math.floor(this.#blue * 255);

        return (r * 77 + g * 150 + b * 29) >> 8;
    }

    toString(): string {
        const r = Math.floor(this.#red * 255);
        const g = Math.floor(this.#green * 255);
        const b = Math.floor(this.#blue * 255);

        return `rgb(${r},${g},${b})`;
    }
}

export class Light {
    static #defaultColor: Color = new Color(0, 0, 0);

    #position: Vector | null = null;
    #color: Color = Light.#defaultColor;

    constructor(position: Vector | null, color: Color) {
        this.#position = position;
        this.#color = color;
    }

    get position(): Vector | null { return this.#position; }
    get color(): Color { return this.#color; }

    toString(): string {
        return `Light [${this.position}]`;
    }
}

export class Vector {
    #x: number = 0;
    #y: number = 0;
    #z: number = 0;

    static add(v: Vector, w: Vector): Vector {
        return new Vector(w.#x + v.#x, w.#y + v.#y, w.#z + v.#z);
    }

    static subtract(v: Vector, w: Vector): Vector {
        return new Vector(v.#x - w.#x, v.#y - w.#y, v.#z - w.#z);
    }

    static multiplyScalar(v: Vector, w: number): Vector {
        return new Vector(v.#x * w, v.#y * w, v.#z * w);
    }

    constructor(x: number, y: number, z: number) {
        this.#x = x;
        this.#y = y;
        this.#z = z;
    }

    get x(): number { return this.#x; }
    get y(): number { return this.#y; }
    get z(): number { return this.#z; }

    normalize(): Vector {
        const m = this.#magnitude();

        return new Vector(this.#x / m, this.#y / m, this.#z / m);
    }

    negateY(): void {
        this.#y *= -1;
    }

    #magnitude(): number {
        return Math.sqrt((this.#x * this.#x) + (this.#y * this.#y) + (this.#z * this.#z));
    }

    cross(w: Vector): Vector {
        return new Vector(
            -this.#z * w.#y + this.#y * w.#z,
            this.#z * w.#x - this.#x * w.#z,
            -this.#y * w.#x + this.#x * w.#y,
        );
    }

    dot(w: Vector): number {
        return this.#x * w.#x + this.#y * w.#y + this.#z * w.#z;
    }

    toString(): string {
        return `Vector [${this.#x},${this.#y},${this.#z}]`;
    }
}

export class Ray {
    #position: Vector | null = null;
    #direction: Vector | null = null;

    constructor(position: Vector | null, direction: Vector | null) {
        this.#position = position;
        this.#direction = direction;
    }

    get position(): Vector | null { return this.#position; }
    get direction(): Vector | null { return this.#direction; }

    toString(): string {
        return `Ray [${this.position},${this.direction}]`;
    }
}

export class Scene {
    #camera: Camera | null = null;
    #background: Background | null = null;
    #shapes: Shape[] = [];
    #lights: Light[] = [];

    constructor(camera: Camera | null, background: Background | null, shapes: Shape[], lights: Light[]) {
        this.#camera = camera;
        this.#background = background;
        this.#shapes = shapes;
        this.#lights = lights;
    }

    get camera(): Camera | null { return this.#camera; }
    get background(): Background | null { return this.#background; }
    get shapes(): Shape[] { return this.#shapes; }
    get lights(): Light[] { return this.#lights; }
}

export class Material {
    #reflection: number = 0;
    #transparency: number = 0;
    #gloss: number = 0;
    #hasTexture: boolean = false;

    constructor(reflection: number, transparency: number, gloss: number, hasTexture: boolean) {
        this.#reflection = reflection;
        this.#transparency = transparency;
        this.#gloss = gloss;
        this.#hasTexture = hasTexture;
    }

    get reflection(): number { return this.#reflection; }
    get transparency(): number { return this.#transparency; }
    get gloss(): number { return this.#gloss; }
    get hasTexture(): boolean { return this.#hasTexture; }

    getColor(u: number, v: number): Color;
    getColor(): Color {
        throw new Error("getColor() isn't implemented");
    }

    toString(): string {
        return `Material [gloss=${this.gloss}, transparency=${this.transparency}, hasTexture=${this.hasTexture}]`;
    }
}

export class SolidMaterial extends Material {
    static #defaultColor: Color = new Color(0, 0, 0);

    #color: Color = SolidMaterial.#defaultColor;

    constructor(color: Color, reflection: number, transparency: number, gloss: number) {
        super(reflection, transparency, gloss, true);
        this.#color = color;
    }

    getColor(): Color {
        return this.#color;
    }

    toString(): string {
        return `SolidMaterial [gloss=${this.gloss}, transparency=${this.transparency}, hasTexture=${this.hasTexture}]`;
    }
}

export class ChessboardMaterial extends Material {
    static #defaultColorEven: Color = new Color(0, 0, 0);
    static #defaultColorOdd: Color = new Color(0, 0, 0);

    #colorEven: Color = ChessboardMaterial.#defaultColorEven;
    #colorOdd: Color = ChessboardMaterial.#defaultColorOdd;
    #density: number = 1;

    constructor(colorEven: Color, colorOdd: Color, reflection: number, transparency: number, gloss: number, density: number) {
        super(reflection, transparency, gloss, true);
        this.#colorEven = colorEven;
        this.#colorOdd = colorOdd;
        this.#density = density;
    }

    #wrapUp(t: number): number {
        t %= 2;
        if (t < -1) t += 2;
        if (t >= 1) t -= 2;
        return t;
    }

    getColor(u: number, v: number): Color {
        const t = this.#wrapUp(u * this.#density) * this.#wrapUp(v * this.#density);
        return t < 0 ? this.#colorEven : this.#colorOdd;
    }

    toString(): string {
        return `ChessMaterial [gloss=${this.gloss}, transparency=${this.transparency}, hasTexture=${this.hasTexture}]`;
    }
}

export class Shape {
    #position: Vector | null = null;
    #material: Material | null = null;

    constructor(position: Vector | null, material: Material | null) {
        this.#position = position;
        this.#material = material;
    }

    get position(): Vector | null { return this.#position; }
    get material(): Material | null { return this.#material; }

    intersect(ray: Ray): IntersectionInfo {
        throw new Error("intersect() isn't implemented");
    }
}

export class Sphere extends Shape {
    #radius: number = 0;

    constructor(position: Vector | null, material: Material | null, radius: number) {
        super(position, material);
        this.#radius = radius;
    }

    intersect(ray: Ray): IntersectionInfo {
        const info = new IntersectionInfo();
        info.shape = this;

        const dst = Vector.subtract(requireValue(ray.position, "#x"), requireValue(this.position, "#x"));

        const B = dst.dot(requireValue(ray.direction, "#x"));
        const C = dst.dot(dst) - (this.#radius * this.#radius);
        const D = (B * B) - C;

        if (D > 0) { // intersection!
            info.isHit = true;
            info.distance = (-B) - Math.sqrt(D);
            info.position = Vector.add(requireValue(ray.position, "#x"), Vector.multiplyScalar(requireValue(ray.direction, "#x"), info.distance));
            info.normal = Vector.subtract(info.position, requireValue(this.position, "#x")).normalize();
            info.color = requireValue(this.material, "getColor").getColor(0, 0);
        } else {
            info.isHit = false;
        }

        return info;
    }

    toString(): string {
        return `Sphere [position=${this.position}, radius=${this.#radius}]`;
    }
}

export class Plane extends Shape {
    #d: number = 0;

    constructor(position: Vector | null, material: Material | null, d: number) {
        super(position, material);
        this.#d = d;
    }

    intersect(ray: Ray): IntersectionInfo {
        const info = new IntersectionInfo();
        info.shape = this;

        const Vd = requireValue(this.position, "dot").dot(requireValue(ray.direction, "#x"));
        if (Vd === 0) return info; // no intersection

        const t = -(requireValue(this.position, "dot").dot(requireValue(ray.position, "#x")) + this.#d) / Vd;
        if (t <= 0) return info;

        info.isHit = true;
        info.position = Vector.add(requireValue(ray.position, "#x"), Vector.multiplyScalar(requireValue(ray.direction, "#x"), t));
        info.normal = this.position;
        info.distance = t;

        if (requireValue(this.material, "hasTexture").hasTexture) {
            const vU = new Vector(requireValue(this.position, "y").y, requireValue(this.position, "z").z, -requireValue(this.position, "x").x);
            const vV = vU.cross(requireValue(this.position, "#x"));
            const u = info.position.dot(vU);
            const v = info.position.dot(vV);
            info.color = requireValue(this.material, "getColor").getColor(u, v);
        } else {
            info.color = requireValue(this.material, "getColor").getColor(0, 0);
        }

        return info;
    }

    toString(): string {
        return `Plane [${this.position}, d=${this.#d}]`;
    }
}

export class IntersectionInfo {
    static #defaultColor: Color = new Color(0, 0, 0);

    isHit: boolean = false;
    hitCount: number = 0;
    shape: Shape | null = null;
    position: Vector | null = null;
    normal: Vector | null = null;
    color: Color = IntersectionInfo.#defaultColor;
    distance: number | null = null;

    toString(): string {
        return `Intersection [${this.position}]`;
    }
}

export class Camera {
    #position: Vector | null = null;
    #lookAt: Vector | null = null;
    #up: Vector | null = null;
    #equator: Vector | null = null;
    #screen: Vector | null = null;

    constructor(position: Vector, lookAt: Vector, up: Vector) {
        this.#position = position;
        this.#lookAt = lookAt;
        this.#up = up;
        this.#equator = this.#lookAt.normalize().cross(this.#up);
        this.#screen = Vector.add(this.#position, this.#lookAt);
    }

    get position(): Vector | null { return this.#position; }

    getRay(vx: number, vy: number): Ray {
        const pos = Vector.subtract(
            requireValue(this.#screen, "#x"),
            Vector.subtract(
                Vector.multiplyScalar(requireValue(this.#equator, "#x"), vx),
                Vector.multiplyScalar(requireValue(this.#up, "#x"), vy),
            ),
        );

        pos.negateY();

        const dir = Vector.subtract(pos, requireValue(this.#position, "#x"));
        return new Ray(pos, dir.normalize());
    }

    toString(): string {
        return `Camera [${this.position}]`;
    }
}

export class Background {
    static #defaultColor: Color = new Color(0, 0, 0);

    #color: Color = Background.#defaultColor;
    #ambience: number = 0;

    constructor(color: Color, ambience: number) {
        this.#color = color;
        this.#ambience = ambience;
    }

    get color(): Color { return this.#color; }
    get ambience(): number { return this.#ambience; }

    toString(): string {
        return `Background [${this.color}]`;
    }
}

export class Engine {
    // Variable used to hold a number that can be used to verify that
    // the scene was ray traced correctly.
    #checkNumber: number = 0;
    #options: Partial<EngineOptions> = {};

    constructor(options?: Partial<EngineOptions>) {
        this.#options = {
            canvasHeight: 100,
            canvasWidth: 100,
            pixelWidth: 2,
            pixelHeight: 2,
            renderDiffuse: false,
            renderShadows: false,
            renderHighlights: false,
            renderReflections: false,
            rayDepth: 2,
            ...options,
        };

        this.#options.canvasHeight = (this.#options.canvasHeight ?? NaN) / (this.#options.pixelHeight ?? NaN);
        this.#options.canvasWidth = (this.#options.canvasWidth ?? NaN) / (this.#options.pixelWidth ?? NaN);
    }

    renderScene(scene: Scene): void {
        for (let x = 0; x < (this.#options.canvasWidth ?? NaN); x++) {
            for (let y = 0; y < (this.#options.canvasHeight ?? NaN); y++) {
                const xp = x * 1 / (this.#options.canvasWidth ?? NaN) * 2 - 1;
                const yp = y * 1 / (this.#options.canvasHeight ?? NaN) * 2 - 1;

                const ray = requireValue(scene.camera, "getRay").getRay(xp, yp);
                const color = this.#getPixelColor(ray, scene);

                this.#setPixel(x, y, color);
            }
        }

        if (this.#checkNumber !== 2321)
            throw new Error("Scene rendered incorrectly");
        // Adapter observation follows the original 2321 assertion.
        lastCheckNumber = this.#checkNumber;
        renderChecksum = (renderChecksum * 31 + this.#checkNumber) >>> 0;
        completedRenders++;
    }

    #getPixelColor(ray: Ray, scene: Scene): Color {
        const info = this.#testIntersection(ray, scene, null);
        if (info.isHit)
            return this.#rayTrace(info, ray, scene, 0);
        return requireValue(scene.background, "color").color;
    }

    #setPixel(x: number, y: number, color: Color): void {
        if (x === y)
            this.#checkNumber += color.brightness();
    }

    #testIntersection(ray: Ray, scene: Scene, exclude: Shape | null): IntersectionInfo {
        let hitCount = 0;
        let best = new IntersectionInfo();
        best.distance = 2000;

        for (let i = 0; i < scene.shapes.length; i++) {
            const shape = scene.shapes[i];
            if (shape !== exclude) {
                const info = shape.intersect(ray);
                if (info.isHit && (info.distance ?? 0) >= 0 && (info.distance ?? 0) < (best.distance ?? 0)) {
                    best = info;
                    hitCount++;
                }
            }
        }

        best.hitCount = hitCount;
        return best;
    }

    #getReflectionRay(P: Vector | null, N: Vector, V: Vector): Ray {
        const c1 = -N.dot(V);
        const R1 = Vector.add(Vector.multiplyScalar(N, 2 * c1), V);
        return new Ray(P, R1);
    }

    #rayTrace(info: IntersectionInfo, ray: Ray, scene: Scene, depth: number): Color {
        // Calc ambient
        let color = Color.multiplyScalar(info.color, requireValue(scene.background, "ambience").ambience);
        const shininess = 10 ** (requireValue(requireValue(info.shape, "material").material, "gloss").gloss + 1);

        for (let i = 0; i < scene.lights.length; i++) {
            const light = scene.lights[i];

            // Calc diffuse lighting
            const v = Vector.subtract(requireValue(light.position, "#x"), requireValue(info.position, "#x")).normalize();

            if (this.#options.renderDiffuse) {
                const L = v.dot(requireValue(info.normal, "#x"));
                if (L > 0) {
                    color = Color.add(
                        color,
                        Color.multiply(
                            info.color,
                            Color.multiplyScalar(light.color, L),
                        ),
                    );
                }
            }

            // The greater the depth the more accurate the colours, but
            // this is exponentially (!) expensive
            if (depth <= (this.#options.rayDepth ?? NaN)) {
                // calculate reflection ray
                if (this.#options.renderReflections && requireValue(requireValue(info.shape, "material").material, "reflection").reflection > 0) {
                    const reflectionRay = this.#getReflectionRay(info.position, requireValue(info.normal, "#x"), requireValue(ray.direction, "#x"));
                    const refl = this.#testIntersection(reflectionRay, scene, info.shape);

                    if (refl.isHit && (refl.distance ?? 0) > 0) {
                        refl.color = this.#rayTrace(refl, reflectionRay, scene, depth + 1);
                    } else {
                        refl.color = requireValue(scene.background, "color").color;
                    }

                    color = Color.blend(
                        color,
                        refl.color,
                        requireValue(requireValue(info.shape, "material").material, "reflection").reflection,
                    );
                }
            }

            // Render shadows and highlights
            let shadowInfo = new IntersectionInfo();

            if (this.#options.renderShadows) {
                const shadowRay = new Ray(info.position, v);

                shadowInfo = this.#testIntersection(shadowRay, scene, info.shape);
                if (shadowInfo.isHit && shadowInfo.shape !== info.shape) {
                    const vA = Color.multiplyScalar(color, 0.5);
                    const dB = 0.5 * (requireValue(requireValue(shadowInfo.shape, "material").material, "transparency").transparency ** 0.5);
                    color = Color.addScalar(vA, dB);
                }
            }

            // Phong specular highlights
            if (this.#options.renderHighlights && !shadowInfo.isHit && requireValue(requireValue(info.shape, "material").material, "gloss").gloss > 0) {
                const Lv = Vector.subtract(requireValue(requireValue(info.shape, "position").position, "#x"), requireValue(light.position, "#x")).normalize();
                const E = Vector.subtract(requireValue(requireValue(scene.camera, "position").position, "#x"), requireValue(requireValue(info.shape, "position").position, "#x")).normalize();
                const H = Vector.subtract(E, Lv).normalize();

                const glossWeight = Math.max(requireValue(info.normal, "dot").dot(H), 0) ** shininess;
                color = Color.add(Color.multiplyScalar(light.color, glossWeight), color);
            }
        }

        return color.limit();
    }
}

export function renderScene(): void {
    const camera = new Camera(
        new Vector(0, 0, -15),
        new Vector(-0.2, 0, 5),
        new Vector(0, 1, 0),
    );
    const background = new Background(new Color(0.5, 0.5, 0.5), 0.4);

    const shapes = [
        new Sphere(
            new Vector(-1.5, 1.5, 2),
            new SolidMaterial(new Color(0, 0.5, 0.5), 0.3, 0, 2),
            1.5,
        ),
        new Sphere(
            new Vector(1, 0.25, 1),
            new SolidMaterial(new Color(0.9, 0.9, 0.9), 0.1, 0, 1.5),
            0.5,
        ),
        new Plane(
            new Vector(0.1, 0.9, -0.5).normalize(),
            new ChessboardMaterial(
                new Color(1, 1, 1),
                new Color(0, 0, 0),
                0.2, 0, 1, 0.7,
            ),
            1.2,
        ),
    ];

    const lights = [
        new Light(
            new Vector(5, 10, -1),
            new Color(0.8, 0.8, 0.8),
        ),
        new Light(
            new Vector(-3, 5, -15),
            new Color(0.8, 0.8, 0.8),
        ),
    ];

    const scene = new Scene(camera, background, shapes, lights);

    const raytracer = new Engine({
        canvasWidth: 100,
        canvasHeight: 100,
        pixelWidth: 5,
        pixelHeight: 5,
        renderDiffuse: true,
        renderHighlights: true,
        renderShadows: true,
        renderReflections: true,
        rayDepth: 2,
    });

    raytracer.renderScene(scene);
}

export class Benchmark {
    runIteration(): void {
        for (let i = 0; i < 15; ++i)
            renderScene();
    }
}

// The release driver keeps one stateless Benchmark instance. Its original
// runIteration still creates and renders all 15 complete scenes each time.
const benchmark = new Benchmark();

export const seed = 1;

export function work(n: number): number {
    renderChecksum = 0;
    completedRenders = 0;
    for (let iteration = 0; iteration < n; ++iteration)
        benchmark.runIteration();
    return renderChecksum;
}

export function render(n: number = 1): number {
    work(n);
    return n > 0 ? lastCheckNumber : 0;
}

export function observation(): {checkNumber: number; renders: number; checksum: number} {
    return {checkNumber: lastCheckNumber, renders: completedRenders, checksum: renderChecksum};
}
