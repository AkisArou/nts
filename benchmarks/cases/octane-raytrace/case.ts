// Copyright (c) 2013, the V8 project authors (http://code.google.com/p/v8/)
// All rights reserved. BSD-3-Clause; see ../LICENSE-octane.
// Transcribed from Octane 2.0 raytrace.js, revision 570ad1ccfe86e3eecba0636c8f932ac08edec517:
// https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/raytrace.js
//
// The Prototype Class.create/Object.extend scaffolding is expressed as typed
// classes, and namespace lookups name those classes directly. The scene,
// material defaults, ray arithmetic, and Octane's 2321 check are unchanged.
// Pixel dimensions remain the source's strings; Number spells the coercions
// that JavaScript's arithmetic performs. The optional canvas path is retained
// but the benchmark supplies null, so it performs no output.
// work(n) renders the original scene n times and returns the sum of its checks.
// Each render resets checkNumber exactly where Octane does.

// The ray tracer code in this file is written by Adam Burmister. It
// is available in its original form from:
//
//   http://labs.flog.nz.co/raytracer/
//
// It has been modified slightly by Google to work as a standalone
// benchmark, but the all the computational code remains
// untouched. This file also contains a copy of parts of the Prototype
// JavaScript framework which is used by the ray tracer.

// Prototype JavaScript framework, version 1.5.0
// (c) 2005-2007 Sam Stephenson
//
// Prototype is freely distributable under the terms of an MIT-style license.
// For details, see the Prototype web site: http://prototype.conio.net/


// The rest of this file is the actual ray tracer written by Adam
// Burmister. It's a concatenation of the following files:
//
//   flog/color.js
//   flog/light.js
//   flog/vector.js
//   flog/ray.js
//   flog/scene.js
//   flog/material/basematerial.js
//   flog/material/solid.js
//   flog/material/chessboard.js
//   flog/shape/baseshape.js
//   flog/shape/sphere.js
//   flog/shape/plane.js
//   flog/intersectioninfo.js
//   flog/camera.js
//   flog/background.js
//   flog/engine.js


type Material = Solid | Chessboard;
type Shape = Sphere | Plane;

interface CanvasContext {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
}

interface Canvas {
    getContext(kind: "2d"): CanvasContext;
}

interface EngineOptions {
    canvasHeight: number;
    canvasWidth: number;
    pixelWidth: number | string;
    pixelHeight: number | string;
    renderDiffuse: boolean;
    renderShadows: boolean;
    renderHighlights: boolean;
    renderReflections: boolean;
    rayDepth: number;
}

// The upstream renderer resets this before tracing each scene.
let checkNumber: number = 0;

class Color {
    red: number;
    green: number;
    blue: number;

    constructor(r: number, g: number, b: number) {
        if(!r) r = 0.0;
        if(!g) g = 0.0;
        if(!b) b = 0.0;

        this.red = r;
        this.green = g;
        this.blue = b;
    }

    add(c1: Color, c2: Color): Color {
        var result = new Color(0,0,0);

        result.red = c1.red + c2.red;
        result.green = c1.green + c2.green;
        result.blue = c1.blue + c2.blue;

        return result;
    }

    addScalar(c1: Color, s: number): Color {
        var result = new Color(0,0,0);

        result.red = c1.red + s;
        result.green = c1.green + s;
        result.blue = c1.blue + s;

        result.limit();

        return result;
    }

    subtract(c1: Color, c2: Color): Color {
        var result = new Color(0,0,0);

        result.red = c1.red - c2.red;
        result.green = c1.green - c2.green;
        result.blue = c1.blue - c2.blue;

        return result;
    }

    multiply(c1: Color, c2: Color): Color {
        var result = new Color(0,0,0);

        result.red = c1.red * c2.red;
        result.green = c1.green * c2.green;
        result.blue = c1.blue * c2.blue;

        return result;
    }

    multiplyScalar(c1: Color, f: number): Color {
        var result = new Color(0,0,0);

        result.red = c1.red * f;
        result.green = c1.green * f;
        result.blue = c1.blue * f;

        return result;
    }

    divideFactor(c1: Color, f: number): Color {
        var result = new Color(0,0,0);

        result.red = c1.red / f;
        result.green = c1.green / f;
        result.blue = c1.blue / f;

        return result;
    }

    limit(): void {
        this.red = (this.red > 0.0) ? ( (this.red > 1.0) ? 1.0 : this.red ) : 0.0;
        this.green = (this.green > 0.0) ? ( (this.green > 1.0) ? 1.0 : this.green ) : 0.0;
        this.blue = (this.blue > 0.0) ? ( (this.blue > 1.0) ? 1.0 : this.blue ) : 0.0;
    }

    distance(color: Color): number {
        var d = Math.abs(this.red - color.red) + Math.abs(this.green - color.green) + Math.abs(this.blue - color.blue);
        return d;
    }

    blend(c1: Color, c2: Color, w: number): Color {
        var result = new Color(0,0,0);
        result = Color.prototype.add(
                    Color.prototype.multiplyScalar(c1, 1 - w),
                    Color.prototype.multiplyScalar(c2, w)
                  );
        return result;
    }

    brightness(): number {
        var r = Math.floor(this.red*255);
        var g = Math.floor(this.green*255);
        var b = Math.floor(this.blue*255);
        return (r * 77 + g * 150 + b * 29) >> 8;
    }

    toString(): string {
        var r = Math.floor(this.red*255);
        var g = Math.floor(this.green*255);
        var b = Math.floor(this.blue*255);

        return "rgb("+ r +","+ g +","+ b +")";
    }

}

class Light {
    position: Vector;
    color: Color;
    intensity: number;

    constructor(pos: Vector, color: Color, intensity?: number) {
        this.position = pos;
        this.color = color;
        this.intensity = (intensity ? intensity : 10.0);
    }

    toString(): string {
        return 'Light [' + this.position.x + ',' + this.position.y + ',' + this.position.z + ']';
    }

}

class Vector {
    x: number;
    y: number;
    z: number;

    constructor(x: number, y: number, z: number) {
        this.x = (x ? x : 0);
        this.y = (y ? y : 0);
        this.z = (z ? z : 0);
    }

    copy(vector: Vector): void {
        this.x = vector.x;
        this.y = vector.y;
        this.z = vector.z;
    }

    normalize(): Vector {
        var m = this.magnitude();
        return new Vector(this.x / m, this.y / m, this.z / m);
    }

    magnitude(): number {
        return Math.sqrt((this.x * this.x) + (this.y * this.y) + (this.z * this.z));
    }

    cross(w: Vector): Vector {
        return new Vector(
                                            -this.z * w.y + this.y * w.z,
                                           this.z * w.x - this.x * w.z,
                                          -this.y * w.x + this.x * w.y);
    }

    dot(w: Vector): number {
        return this.x * w.x + this.y * w.y + this.z * w.z;
    }

    add(v: Vector, w: Vector): Vector {
        return new Vector(w.x + v.x, w.y + v.y, w.z + v.z);
    }

    subtract(v: Vector, w: Vector): Vector {
        if(!w || !v) throw 'Vectors must be defined [' + v + ',' + w + ']';
        return new Vector(v.x - w.x, v.y - w.y, v.z - w.z);
    }

    multiplyVector(v: Vector, w: Vector): Vector {
        return new Vector(v.x * w.x, v.y * w.y, v.z * w.z);
    }

    multiplyScalar(v: Vector, w: number): Vector {
        return new Vector(v.x * w, v.y * w, v.z * w);
    }

    toString(): string {
        return 'Vector [' + this.x + ',' + this.y + ',' + this.z + ']';
    }

}

class Ray {
    position: Vector;
    direction: Vector;

    constructor(pos: Vector, dir: Vector) {
        this.position = pos;
        this.direction = dir;
    }

    toString(): string {
        return 'Ray [' + this.position + ',' + this.direction + ']';
    }

}

class Scene {
    camera: Camera;
    shapes: Shape[];
    lights: Light[];
    background: Background;

    constructor() {
        this.camera = new Camera(
            new Vector(0,0,-5),
            new Vector(0,0,1),
            new Vector(0,1,0)
        );
        this.shapes = new Array<Shape>();
        this.lights = new Array<Light>();
        this.background = new Background(new Color(0,0,0.5), 0.2);
    }

}

class BaseMaterial {
    gloss: number = 2.0;             // [0...infinity] 0 = matt
    transparency: number = 0.0;      // 0=opaque
    reflection: number = 0.0;        // [0...infinity] 0 = no reflection
    refraction: number = 0.50;
    hasTexture: boolean = false;

    constructor() {

    }

    getColor(u: number, v: number): Color | undefined {
        return undefined;
    }

    wrapUp(t: number): number {
        t = t % 2.0;
        if(t < -1) t += 2.0;
        if(t >= 1) t -= 2.0;
        return t;
    }

    toString(): string {
        return 'Material [gloss=' + this.gloss + ', transparency=' + this.transparency + ', hasTexture=' + this.hasTexture +']';
    }

}

class Solid extends BaseMaterial {
    color: Color;

    constructor(color: Color, reflection: number, refraction: number, transparency: number, gloss: number) {
            super();
            this.color = color;
            this.reflection = reflection;
            this.transparency = transparency;
            this.gloss = gloss;
            this.hasTexture = false;
        }

    override getColor(u: number, v: number): Color {
            return this.color;
        }

    override toString(): string {
            return 'SolidMaterial [gloss=' + this.gloss + ', transparency=' + this.transparency + ', hasTexture=' + this.hasTexture +']';
        }

}

class Chessboard extends BaseMaterial {
    colorEven: Color;
    colorOdd: Color;
    density: number = 0.5;

    constructor(colorEven: Color, colorOdd: Color, reflection: number, transparency: number, gloss: number, density: number) {
            super();
            this.colorEven = colorEven;
            this.colorOdd = colorOdd;
            this.reflection = reflection;
            this.transparency = transparency;
            this.gloss = gloss;
            this.density = density;
            this.hasTexture = true;
        }

    override getColor(u: number, v: number): Color {
            var t = this.wrapUp(u * this.density) * this.wrapUp(v * this.density);

            if(t < 0.0)
                return this.colorEven;
            else
                return this.colorOdd;
        }

    override toString(): string {
            return 'ChessMaterial [gloss=' + this.gloss + ', transparency=' + this.transparency + ', hasTexture=' + this.hasTexture +']';
        }

}

class Sphere {
    radius: number;
    position: Vector;
    material: Material;

    constructor(pos: Vector, radius: number, material: Material) {
        this.radius = radius;
        this.position = pos;
        this.material = material;
    }

    intersect(ray: Ray): IntersectionInfo {
        var info = new IntersectionInfo();
        info.shape = this;

        var dst = Vector.prototype.subtract(ray.position, this.position);

        var B = dst.dot(ray.direction);
        var C = dst.dot(dst) - (this.radius * this.radius);
        var D = (B * B) - C;

        if(D > 0){ // intersection!
            info.isHit = true;
            info.distance = (-B) - Math.sqrt(D);
            info.position = Vector.prototype.add(
                                                ray.position,
                                                Vector.prototype.multiplyScalar(
                                                    ray.direction,
                                                    info.distance!
                                                )
                                            );
            info.normal = Vector.prototype.subtract(
                                            info.position!,
                                            this.position
                                        ).normalize();

            info.color = this.material.getColor(0,0);
        } else {
            info.isHit = false;
        }
        return info;
    }

    toString(): string {
        return 'Sphere [position=' + this.position + ', radius=' + this.radius + ']';
    }

}

class Plane {
    d: number = 0.0;
    position: Vector;
    material: Material;

    constructor(pos: Vector, d: number, material: Material) {
        this.position = pos;
        this.d = d;
        this.material = material;
    }

    intersect(ray: Ray): IntersectionInfo {
        var info = new IntersectionInfo();

        var Vd = this.position.dot(ray.direction);
        if(Vd == 0) return info; // no intersection

        var t = -(this.position.dot(ray.position) + this.d) / Vd;
        if(t <= 0) return info;

        info.shape = this;
        info.isHit = true;
        info.position = Vector.prototype.add(
                                            ray.position,
                                            Vector.prototype.multiplyScalar(
                                                ray.direction,
                                                t
                                            )
                                        );
        info.normal = this.position;
        info.distance = t;

        if(this.material.hasTexture){
            var vU = new Vector(this.position.y, this.position.z, -this.position.x);
            var vV = vU.cross(this.position);
            var u = info.position!.dot(vU);
            var v = info.position!.dot(vV);
            info.color = this.material.getColor(u,v);
        } else {
            info.color = this.material.getColor(0,0);
        }

        return info;
    }

    toString(): string {
        return 'Plane [' + this.position + ', d=' + this.d + ']';
    }

}

class IntersectionInfo {
    isHit: boolean = false;
    hitCount: number = 0;
    shape: Shape | null = null;
    position: Vector | null = null;
    normal: Vector | null = null;
    color: Color;
    distance: number | null = null;

    constructor() {
        this.color = new Color(0,0,0);
    }

    toString(): string {
        return 'Intersection [' + this.position + ']';
    }

}

class Camera {
    position: Vector;
    lookAt: Vector;
    equator: Vector;
    up: Vector;
    screen: Vector;

    constructor(pos: Vector, lookAt: Vector, up: Vector) {
        this.position = pos;
        this.lookAt = lookAt;
        this.up = up;
        this.equator = lookAt.normalize().cross(this.up);
        this.screen = Vector.prototype.add(this.position, this.lookAt);
    }

    getRay(vx: number, vy: number): Ray {
        var pos = Vector.prototype.subtract(
            this.screen,
            Vector.prototype.subtract(
                Vector.prototype.multiplyScalar(this.equator, vx),
                Vector.prototype.multiplyScalar(this.up, vy)
            )
        );
        pos.y = pos.y * -1;
        var dir = Vector.prototype.subtract(
            pos,
            this.position
        );

        var ray = new Ray(pos, dir.normalize());

        return ray;
    }

    toString(): string {
        return 'Ray []';
    }

}

class Background {
    color: Color;
    ambience: number = 0.0;

    constructor(color: Color, ambience: number) {
        this.color = color;
        this.ambience = ambience;
    }

}

class Engine {
    canvas: CanvasContext | null = null; /* 2d context we can render to */
    options: EngineOptions;

    constructor(options: Partial<EngineOptions>) {
        this.options = Object.assign({
                canvasHeight: 100,
                canvasWidth: 100,
                pixelWidth: 2,
                pixelHeight: 2,
                renderDiffuse: false,
                renderShadows: false,
                renderHighlights: false,
                renderReflections: false,
                rayDepth: 2
            }, options || {});

        this.options.canvasHeight /= Number(this.options.pixelHeight);
        this.options.canvasWidth /= Number(this.options.pixelWidth);

        /* TODO: dynamically include other scripts */
    }

    setPixel(x: number, y: number, color: Color): void {
        var pxW: number, pxH: number;
        pxW = Number(this.options.pixelWidth);
        pxH = Number(this.options.pixelHeight);

        if (this.canvas) {
          this.canvas.fillStyle = color.toString();
          this.canvas.fillRect (x * pxW, y * pxH, pxW, pxH);
        } else {
          if (x ===  y) {
            checkNumber += color.brightness();
          }
          // print(x * pxW, y * pxH, pxW, pxH);
        }
    }

    renderScene(scene: Scene, canvas: Canvas | null, unused?: number): void {
        checkNumber = 0;
        /* Get canvas */
        if (canvas) {
          this.canvas = canvas.getContext("2d");
        } else {
          this.canvas = null;
        }

        var canvasHeight = this.options.canvasHeight;
        var canvasWidth = this.options.canvasWidth;

        for(var y=0; y < canvasHeight; y++){
            for(var x=0; x < canvasWidth; x++){
                var yp = y * 1.0 / canvasHeight * 2 - 1;
                var xp = x * 1.0 / canvasWidth * 2 - 1;

                var ray = scene.camera.getRay(xp, yp);

                var color = this.getPixelColor(ray, scene);

                this.setPixel(x, y, color);
            }
        }
        if (checkNumber !== 2321) {
          throw new Error("Scene rendered incorrectly");
        }
    }

    getPixelColor(ray: Ray, scene: Scene): Color {
        var info = this.testIntersection(ray, scene, null);
        if(info.isHit){
            var color = this.rayTrace(info, ray, scene, 0);
            return color;
        }
        return scene.background.color;
    }

    testIntersection(ray: Ray, scene: Scene, exclude: Shape | null): IntersectionInfo {
        var hits = 0;
        var best = new IntersectionInfo();
        best.distance = 2000;

        for(var i=0; i<scene.shapes.length; i++){
            var shape = scene.shapes[i];

            if(shape != exclude){
                var info = shape.intersect(ray);
                if(info.isHit && info.distance! >= 0 && info.distance! < best.distance!){
                    best = info;
                    hits++;
                }
            }
        }
        best.hitCount = hits;
        return best;
    }

    getReflectionRay(P: Vector, N: Vector, V: Vector): Ray {
        var c1 = -N.dot(V);
        var R1 = Vector.prototype.add(
            Vector.prototype.multiplyScalar(N, 2*c1),
            V
        );
        return new Ray(P, R1);
    }

    rayTrace(info: IntersectionInfo, ray: Ray, scene: Scene, depth: number): Color {
        // Calc ambient
        var color = Color.prototype.multiplyScalar(info.color, scene.background.ambience);
        var oldColor = color;
        var shininess = Math.pow(10, info.shape!.material.gloss + 1);

        for(var i=0; i<scene.lights.length; i++){
            var light = scene.lights[i];

            // Calc diffuse lighting
            var v = Vector.prototype.subtract(
                                light.position,
                                info.position!
                            ).normalize();

            if(this.options.renderDiffuse){
                var L = v.dot(info.normal!);
                if(L > 0.0){
                    color = Color.prototype.add(
                                        color,
                                        Color.prototype.multiply(
                                            info.color,
                                            Color.prototype.multiplyScalar(
                                                light.color,
                                                L
                                            )
                                        )
                                    );
                }
            }

            // The greater the depth the more accurate the colours, but
            // this is exponentially (!) expensive
            if(depth <= this.options.rayDepth){
          // calculate reflection ray
          if(this.options.renderReflections && info.shape!.material.reflection > 0)
          {
              var reflectionRay = this.getReflectionRay(info.position!, info.normal!, ray.direction);
              var refl = this.testIntersection(reflectionRay, scene, info.shape!);

              if (refl.isHit && refl.distance! > 0){
                  refl.color = this.rayTrace(refl, reflectionRay, scene, depth + 1);
              } else {
                  refl.color = scene.background.color;
                        }

                  color = Color.prototype.blend(
                    color,
                    refl.color,
                    info.shape!.material.reflection
                  );
          }

                // Refraction
                /* TODO */
            }

            /* Render shadows and highlights */

            var shadowInfo = new IntersectionInfo();

            if(this.options.renderShadows){
                var shadowRay = new Ray(info.position!, v);

                shadowInfo = this.testIntersection(shadowRay, scene, info.shape!);
                if(shadowInfo.isHit && shadowInfo.shape! != info.shape! /*&& shadowInfo.shape!.type != 'PLANE'*/){
                    var vA = Color.prototype.multiplyScalar(color, 0.5);
                    var dB = (0.5 * Math.pow(shadowInfo.shape!.material.transparency, 0.5));
                    color = Color.prototype.addScalar(vA,dB);
                }
            }

      // Phong specular highlights
      if(this.options.renderHighlights && !shadowInfo.isHit && info.shape!.material.gloss > 0){
        var Lv = Vector.prototype.subtract(
                            info.shape!.position,
                            light.position
                        ).normalize();

        var E = Vector.prototype.subtract(
                            scene.camera.position,
                            info.shape!.position
                        ).normalize();

        var H = Vector.prototype.subtract(
                            E,
                            Lv
                        ).normalize();

        var glossWeight = Math.pow(Math.max(info.normal!.dot(H), 0), shininess);
        color = Color.prototype.add(
                            Color.prototype.multiplyScalar(light.color, glossWeight),
                            color
                        );
      }
        }
        color.limit();
        return color;
    }

}

export function renderScene(): number {
    var scene = new Scene();

    scene.camera = new Camera(
                        new Vector(0, 0, -15),
                        new Vector(-0.2, 0, 5),
                        new Vector(0, 1, 0)
                    );

    scene.background = new Background(
                                new Color(0.5, 0.5, 0.5),
                                0.4
                            );

    var sphere = new Sphere(
        new Vector(-1.5, 1.5, 2),
        1.5,
        new Solid(
            new Color(0,0.5,0.5),
            0.3,
            0.0,
            0.0,
            2.0
        )
    );

    var sphere1 = new Sphere(
        new Vector(1, 0.25, 1),
        0.5,
        new Solid(
            new Color(0.9,0.9,0.9),
            0.1,
            0.0,
            0.0,
            1.5
        )
    );

    var plane = new Plane(
                                new Vector(0.1, 0.9, -0.5).normalize(),
                                1.2,
                                new Chessboard(
                                    new Color(1,1,1),
                                    new Color(0,0,0),
                                    0.2,
                                    0.0,
                                    1.0,
                                    0.7
                                )
                            );

    scene.shapes.push(plane);
    scene.shapes.push(sphere);
    scene.shapes.push(sphere1);

    var light = new Light(
        new Vector(5, 10, -1),
        new Color(0.8, 0.8, 0.8)
    );

    var light1 = new Light(
        new Vector(-3, 5, -15),
        new Color(0.8, 0.8, 0.8),
        100
    );

    scene.lights.push(light);
    scene.lights.push(light1);

    var imageWidth = 100; // $F('imageWidth');
    var imageHeight = 100; // $F('imageHeight');
    var pixelSize = "5,5".split(','); //  $F('pixelSize').split(',');
    var renderDiffuse = true; // $F('renderDiffuse');
    var renderShadows = true; // $F('renderShadows');
    var renderHighlights = true; // $F('renderHighlights');
    var renderReflections = true; // $F('renderReflections');
    var rayDepth = 2;//$F('rayDepth');

    var raytracer = new Engine(
        {
            canvasWidth: imageWidth,
            canvasHeight: imageHeight,
            pixelWidth: pixelSize[0],
            pixelHeight: pixelSize[1],
            "renderDiffuse": renderDiffuse,
            "renderHighlights": renderHighlights,
            "renderShadows": renderShadows,
            "renderReflections": renderReflections,
            "rayDepth": rayDepth
        }
    );

    raytracer.renderScene(scene, null, 0);
    return checkNumber;
}

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        checksum += renderScene();
    }
    return checksum;
}

// The harness passes this iteration count through its opaque input boundary.
export const seed = 4;
