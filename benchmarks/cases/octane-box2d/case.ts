// Portions copyright 2013 Google, Inc
/*
* Copyright (c) 2006-2007 Erin Catto http://www.gphysics.com
*
* This software is provided 'as-is', without any express or implied
* warranty.  In no event will the authors be held liable for any damages
* arising from the use of this software.
* Permission is granted to anyone to use this software for any purpose,
* including commercial applications, and to alter it and redistribute it
* freely, subject to the following restrictions:
* 1. The origin of this software must not be misrepresented; you must not
* claim that you wrote the original software. If you use this software
* in a product, an acknowledgment in the product documentation would be
* appreciated but is not required.
* 2. Altered source versions must be plainly marked as such, and must not be
* misrepresented as being the original software.
* 3. This notice may not be removed or altered from any source distribution.
*/

/*
 * Altered TypeScript transcription of the zlib-licensed Box2DWeb engine.
 * Readable engine: Uli Hecht's Box2DWeb port of Box2DFlash 2.1a:
 * https://github.com/hecht-software/box2dweb/blob/03ff76dac7f9961668011b44c5ae716a30dd0b6f/Box2D.js
 * This is the engine embedded in Octane 2.0 at revision
 * 570ad1ccfe86e3eecba0636c8f932ac08edec517 (box2d.js), with the documented
 * Object.defineProperty compatibility-guard correction in its readable pair.
 * Native classes, declared fields, get/set accessors and TypeScript annotations
 * replace the generated AS3 prototype/bootstrap machinery. Engine algorithms,
 * arithmetic order and ordinary arrays are retained.
 * The distance proxy keeps the generated heterogeneous [1, true] array and
 * checks each live vertex before use. QueryAABB checks its unknown payload;
 * existing instanceof branches narrow local copies of pure getter results.
 * No as casts are used. new.target preserves the engine's two-stage field
 * allocation and logical-constructor order.
 *
 * The benchmark scene below is original nts code, not Octane's scene.
 * It is released under the zlib terms printed above. Its opaque input controls
 * the number of fresh worlds simulated; the engine is the transcribed program.
 */

type TreeQueryCallback = (proxy: b2DynamicTreeNode) => boolean;
type TreeRayCallback = (input: b2RayCastInput, proxy: b2DynamicTreeNode) => number;
type PairCallback = (a: unknown, b: unknown) => void;
type FixtureQueryCallback = (fixture: b2Fixture) => boolean;
type FixtureRayCallback = (fixture: b2Fixture, point: b2Vec2, normal: b2Vec2, fraction: number) => number;
type ContactCreate = (allocator: unknown) => b2Contact | null;
type ContactDestroy = (contact: b2Contact | null, allocator: unknown) => void;
interface b2OBB { R: b2Mat22; center: b2Vec2; extents: b2Vec2 }
interface DebugSprite { graphics: { clear(): void } }
interface DebugCanvas {
   canvas: { width: number; height: number };
   strokeWidth: number;
   strokeStyle: string;
   fillStyle: string;
   clearRect(x: number, y: number, width: number, height: number): void;
   beginPath(): void;
   moveTo(x: number, y: number): void;
   lineTo(x: number, y: number): void;
   closePath(): void;
   stroke(): void;
   fill(): void;
   arc(x: number, y: number, radius: number, start: number, end: number, ccw: boolean): void;
}
function numberVector(length: number = 0): Array<number> {
   var tmp = new Array<number>(length || 0);
   for (var i = 0; i < length; ++i) tmp[i] = 0;
   return tmp;
}
function parseUInt(v: number): number { return Math.abs(parseInt(String(v))); }

class b2AABB {
   declare lowerBound: (b2Vec2 | null);
   declare upperBound: (b2Vec2 | null);

   constructor() {

      this.lowerBound = new b2Vec2();
      this.upperBound = new b2Vec2();

   }
   IsValid(): boolean {
      var dX: number = this.upperBound!.x - this.lowerBound!.x;
      var dY: number = this.upperBound!.y - this.lowerBound!.y;
      var valid: boolean = dX >= 0.0 && dY >= 0.0;
      valid = valid && this.lowerBound!.IsValid() && this.upperBound!.IsValid();
      return valid;
   }
   GetCenter(): (b2Vec2 | null) {
      return new b2Vec2((this.lowerBound!.x + this.upperBound!.x) / 2, (this.lowerBound!.y + this.upperBound!.y) / 2);
   }
   GetExtents(): (b2Vec2 | null) {
      return new b2Vec2((this.upperBound!.x - this.lowerBound!.x) / 2, (this.upperBound!.y - this.lowerBound!.y) / 2);
   }
   Contains(aabb: (b2AABB | null)): boolean {
      var result: boolean = true;
      result = result && this.lowerBound!.x <= aabb!.lowerBound!.x;
      result = result && this.lowerBound!.y <= aabb!.lowerBound!.y;
      result = result && aabb!.upperBound!.x <= this.upperBound!.x;
      result = result && aabb!.upperBound!.y <= this.upperBound!.y;
      return result;
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null)): boolean {
      var tmin: number = (-Number.MAX_VALUE);
      var tmax: number = Number.MAX_VALUE;
      var pX: number = input!.p1!.x;
      var pY: number = input!.p1!.y;
      var dX: number = input!.p2!.x - input!.p1!.x;
      var dY: number = input!.p2!.y - input!.p1!.y;
      var absDX: number = Math.abs(dX);
      var absDY: number = Math.abs(dY);
      var normal: (b2Vec2 | null) = output!.normal;
      var inv_d: number = 0;
      var t1: number = 0;
      var t2: number = 0;
      var t3: number = 0;
      var s: number = 0; {
         if (absDX < Number.MIN_VALUE) {
            if (pX < this.lowerBound!.x || this.upperBound!.x < pX) return false;
         }
         else {
            inv_d = 1.0 / dX;
            t1 = (this.lowerBound!.x - pX) * inv_d;
            t2 = (this.upperBound!.x - pX) * inv_d;
            s = (-1.0);
            if (t1 > t2) {
               t3 = t1;
               t1 = t2;
               t2 = t3;
               s = 1.0;
            }
            if (t1 > tmin) {
               normal!.x = s;
               normal!.y = 0;
               tmin = t1;
            }
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return false;
         }
      } {
         if (absDY < Number.MIN_VALUE) {
            if (pY < this.lowerBound!.y || this.upperBound!.y < pY) return false;
         }
         else {
            inv_d = 1.0 / dY;
            t1 = (this.lowerBound!.y - pY) * inv_d;
            t2 = (this.upperBound!.y - pY) * inv_d;
            s = (-1.0);
            if (t1 > t2) {
               t3 = t1;
               t1 = t2;
               t2 = t3;
               s = 1.0;
            }
            if (t1 > tmin) {
               normal!.y = s;
               normal!.x = 0;
               tmin = t1;
            }
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) return false;
         }
      }
      output!.fraction = tmin;
      return true;
   }
   TestOverlap(other: (b2AABB | null)): boolean {
      var d1X: number = other!.lowerBound!.x - this.upperBound!.x;
      var d1Y: number = other!.lowerBound!.y - this.upperBound!.y;
      var d2X: number = this.lowerBound!.x - other!.upperBound!.x;
      var d2Y: number = this.lowerBound!.y - other!.upperBound!.y;
      if (d1X > 0.0 || d1Y > 0.0) return false;
      if (d2X > 0.0 || d2Y > 0.0) return false;
      return true;
   }
   static Combine(aabb1: (b2AABB | null), aabb2: (b2AABB | null)): (b2AABB | null) {
      var aabb: (b2AABB | null) = new b2AABB();
      aabb!.Combine(aabb1, aabb2);
      return aabb;
   }
   Combine(aabb1: (b2AABB | null), aabb2: (b2AABB | null)): void {
      this.lowerBound!.x = Math.min(aabb1!.lowerBound!.x, aabb2!.lowerBound!.x);
      this.lowerBound!.y = Math.min(aabb1!.lowerBound!.y, aabb2!.lowerBound!.y);
      this.upperBound!.x = Math.max(aabb1!.upperBound!.x, aabb2!.upperBound!.x);
      this.upperBound!.y = Math.max(aabb1!.upperBound!.y, aabb2!.upperBound!.y);
   }
}

class b2Bound {
   declare value: number;
   declare proxy: unknown;
   declare stabbingCount: number;

   constructor() {

   }
   IsLower(): boolean {
      return (this.value & 1) == 0;
   }
   IsUpper(): boolean {
      return (this.value & 1) == 1;
   }
   Swap(b: (b2Bound | null)): void {
      var tempValue: number = this.value;
      var tempProxy = this.proxy;
      var tempStabbingCount: number = this.stabbingCount;
      this.value = b!.value;
      this.proxy = b!.proxy;
      this.stabbingCount = b!.stabbingCount;
      b!.value = tempValue;
      b!.proxy = tempProxy;
      b!.stabbingCount = tempStabbingCount;
   }
}

class b2BoundValues {
   declare lowerValues: Array<number>;
   declare upperValues: Array<number>;

   constructor() {

      if (new.target === b2BoundValues) this.b2BoundValues();
   }
   b2BoundValues(): void {
      this.lowerValues = numberVector();
      this.lowerValues![0] = 0.0;
      this.lowerValues![1] = 0.0;
      this.upperValues = numberVector();
      this.upperValues![0] = 0.0;
      this.upperValues![1] = 0.0;
   }
}

class b2Collision {
   declare static b2_nullFeature: number;
   declare static s_incidentEdge: Array<(ClipVertex | null)>;
   declare static s_clipPoints1: Array<(ClipVertex | null)>;
   declare static s_clipPoints2: Array<(ClipVertex | null)>;
   declare static s_edgeAO: Array<number>;
   declare static s_edgeBO: Array<number>;
   declare static s_localTangent: (b2Vec2 | null);
   declare static s_localNormal: (b2Vec2 | null);
   declare static s_planePoint: (b2Vec2 | null);
   declare static s_normal: (b2Vec2 | null);
   declare static s_tangent: (b2Vec2 | null);
   declare static s_tangent2: (b2Vec2 | null);
   declare static s_v11: (b2Vec2 | null);
   declare static s_v12: (b2Vec2 | null);
   declare static b2CollidePolyTempVec: (b2Vec2 | null);

   constructor() {

   }
   static ClipSegmentToLine(vOut: Array<(ClipVertex | null)>, vIn: Array<(ClipVertex | null)>, normal: (b2Vec2 | null), offset: number): number {
      if (offset === undefined) offset = 0;
      var cv: (ClipVertex | null) | undefined;
      var numOut: number = 0;
      cv = vIn![0];
      var vIn0: (b2Vec2 | null) = cv!.v;
      cv = vIn![1];
      var vIn1: (b2Vec2 | null) = cv!.v;
      var distance0: number = normal!.x * vIn0!.x + normal!.y * vIn0!.y - offset;
      var distance1: number = normal!.x * vIn1!.x + normal!.y * vIn1!.y - offset;
      if (distance0 <= 0.0) vOut![numOut++]!.Set(vIn![0]);
      if (distance1 <= 0.0) vOut![numOut++]!.Set(vIn![1]);
      if (distance0 * distance1 < 0.0) {
         var interp: number = distance0 / (distance0 - distance1);
         cv = vOut![numOut];
         var tVec: (b2Vec2 | null) = cv!.v;
         tVec!.x = vIn0!.x + interp * (vIn1!.x - vIn0!.x);
         tVec!.y = vIn0!.y + interp * (vIn1!.y - vIn0!.y);
         cv = vOut![numOut];
         var cv2: (ClipVertex | null) | undefined;
         if (distance0 > 0.0) {
            cv2 = vIn![0];
            cv!.id = cv2!.id;
         }
         else {
            cv2 = vIn![1];
            cv!.id = cv2!.id;
         }++numOut;
      }
      return numOut;
   }
   static EdgeSeparation(poly1: (b2PolygonShape | null), xf1: (b2Transform | null), edge1: number, poly2: (b2PolygonShape | null), xf2: (b2Transform | null)): number {
      if (edge1 === undefined) edge1 = 0;
      var count1: number = parseInt(String(poly1!.m_vertexCount));
      var vertices1: Array<(b2Vec2 | null)> = poly1!.m_vertices;
      var normals1: Array<(b2Vec2 | null)> = poly1!.m_normals;
      var count2: number = parseInt(String(poly2!.m_vertexCount));
      var vertices2: Array<(b2Vec2 | null)> = poly2!.m_vertices;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      tMat = xf1!.R;
      tVec = normals1![edge1];
      var normal1WorldX: number = (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var normal1WorldY: number = (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tMat = xf2!.R;
      var normal1X: number = (tMat!.col1!.x * normal1WorldX + tMat!.col1!.y * normal1WorldY);
      var normal1Y: number = (tMat!.col2!.x * normal1WorldX + tMat!.col2!.y * normal1WorldY);
      var index: number = 0;
      var minDot: number = Number.MAX_VALUE;
      for (var i: number = 0; i < count2; ++i) {
         tVec = vertices2![i];
         var dot: number = tVec!.x * normal1X + tVec!.y * normal1Y;
         if (dot < minDot) {
            minDot = dot;
            index = i;
         }
      }
      tVec = vertices1![edge1];
      tMat = xf1!.R;
      var v1X: number = xf1!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var v1Y: number = xf1!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tVec = vertices2![index];
      tMat = xf2!.R;
      var v2X: number = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var v2Y: number = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      v2X -= v1X;
      v2Y -= v1Y;
      var separation: number = v2X * normal1WorldX + v2Y * normal1WorldY;
      return separation;
   }
   static FindMaxSeparation(edgeIndex: Array<number>, poly1: (b2PolygonShape | null), xf1: (b2Transform | null), poly2: (b2PolygonShape | null), xf2: (b2Transform | null)): number {
      var count1: number = parseInt(String(poly1!.m_vertexCount));
      var normals1: Array<(b2Vec2 | null)> = poly1!.m_normals;
      var tVec: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = xf2!.R;
      tVec = poly2!.m_centroid;
      var dX: number = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var dY: number = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tMat = xf1!.R;
      tVec = poly1!.m_centroid;
      dX -= xf1!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      dY -= xf1!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      var dLocal1X: number = (dX * xf1!.R!.col1!.x + dY * xf1!.R!.col1!.y);
      var dLocal1Y: number = (dX * xf1!.R!.col2!.x + dY * xf1!.R!.col2!.y);
      var edge: number = 0;
      var maxDot: number = (-Number.MAX_VALUE);
      for (var i: number = 0; i < count1; ++i) {
         tVec = normals1![i];
         var dot: number = (tVec!.x * dLocal1X + tVec!.y * dLocal1Y);
         if (dot > maxDot) {
            maxDot = dot;
            edge = i;
         }
      }
      var s: number = b2Collision.EdgeSeparation(poly1, xf1, edge, poly2, xf2);
      var prevEdge: number = parseInt(String(edge - 1 >= 0 ? edge - 1 : count1 - 1));
      var sPrev: number = b2Collision.EdgeSeparation(poly1, xf1, prevEdge, poly2, xf2);
      var nextEdge: number = parseInt(String(edge + 1 < count1 ? edge + 1 : 0));
      var sNext: number = b2Collision.EdgeSeparation(poly1, xf1, nextEdge, poly2, xf2);
      var bestEdge: number = 0;
      var bestSeparation: number = 0;
      var increment: number = 0;
      if (sPrev > s && sPrev > sNext) {
         increment = (-1);
         bestEdge = prevEdge;
         bestSeparation = sPrev;
      }
      else if (sNext > s) {
         increment = 1;
         bestEdge = nextEdge;
         bestSeparation = sNext;
      }
      else {
         edgeIndex![0] = edge;
         return s;
      }
      while (true) {
         if (increment == (-1)) edge = bestEdge - 1 >= 0 ? bestEdge - 1 : count1 - 1;
         else edge = bestEdge + 1 < count1 ? bestEdge + 1 : 0;s = b2Collision.EdgeSeparation(poly1, xf1, edge, poly2, xf2);
         if (s > bestSeparation) {
            bestEdge = edge;
            bestSeparation = s;
         }
         else {
            break;
         }
      }
      edgeIndex![0] = bestEdge;
      return bestSeparation;
   }
   static FindIncidentEdge(c: Array<(ClipVertex | null)>, poly1: (b2PolygonShape | null), xf1: (b2Transform | null), edge1: number, poly2: (b2PolygonShape | null), xf2: (b2Transform | null)): void {
      if (edge1 === undefined) edge1 = 0;
      var count1: number = parseInt(String(poly1!.m_vertexCount));
      var normals1: Array<(b2Vec2 | null)> = poly1!.m_normals;
      var count2: number = parseInt(String(poly2!.m_vertexCount));
      var vertices2: Array<(b2Vec2 | null)> = poly2!.m_vertices;
      var normals2: Array<(b2Vec2 | null)> = poly2!.m_normals;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      tMat = xf1!.R;
      tVec = normals1![edge1];
      var normal1X: number = (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var normal1Y: number = (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tMat = xf2!.R;
      var tX: number = (tMat!.col1!.x * normal1X + tMat!.col1!.y * normal1Y);
      normal1Y = (tMat!.col2!.x * normal1X + tMat!.col2!.y * normal1Y);
      normal1X = tX;
      var index: number = 0;
      var minDot: number = Number.MAX_VALUE;
      for (var i: number = 0; i < count2; ++i) {
         tVec = normals2![i];
         var dot: number = (normal1X * tVec!.x + normal1Y * tVec!.y);
         if (dot < minDot) {
            minDot = dot;
            index = i;
         }
      }
      var tClip: (ClipVertex | null) | undefined;
      var i1: number = parseInt(String(index));
      var i2: number = parseInt(String(i1 + 1 < count2 ? i1 + 1 : 0));
      tClip = c![0];
      tVec = vertices2![i1];
      tMat = xf2!.R;
      tClip!.v!.x = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      tClip!.v!.y = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tClip!.id!.features!.referenceEdge = edge1;
      tClip!.id!.features!.incidentEdge = i1;
      tClip!.id!.features!.incidentVertex = 0;
      tClip = c![1];
      tVec = vertices2![i2];
      tMat = xf2!.R;
      tClip!.v!.x = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      tClip!.v!.y = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tClip!.id!.features!.referenceEdge = edge1;
      tClip!.id!.features!.incidentEdge = i2;
      tClip!.id!.features!.incidentVertex = 1;
   }
   static MakeClipPointVector(): Array<(ClipVertex | null)> {
      var r: Array<(ClipVertex | null)> = new Array<(ClipVertex | null)>(2);
      r![0] = new ClipVertex();
      r![1] = new ClipVertex();
      return r;
   }
   static CollidePolygons(manifold: (b2Manifold | null), polyA: (b2PolygonShape | null), xfA: (b2Transform | null), polyB: (b2PolygonShape | null), xfB: (b2Transform | null)): void {
      var cv: (ClipVertex | null) | undefined;
      manifold!.m_pointCount = 0;
      var totalRadius: number = polyA!.m_radius + polyB!.m_radius;
      var edgeA: number = 0;
      b2Collision.s_edgeAO![0] = edgeA;
      var separationA: number = b2Collision.FindMaxSeparation(b2Collision.s_edgeAO, polyA, xfA, polyB, xfB);
      edgeA = b2Collision.s_edgeAO![0];
      if (separationA > totalRadius) return;
      var edgeB: number = 0;
      b2Collision.s_edgeBO![0] = edgeB;
      var separationB: number = b2Collision.FindMaxSeparation(b2Collision.s_edgeBO, polyB, xfB, polyA, xfA);
      edgeB = b2Collision.s_edgeBO![0];
      if (separationB > totalRadius) return;
      var poly1: (b2PolygonShape | null) | undefined;
      var poly2: (b2PolygonShape | null) | undefined;
      var xf1: (b2Transform | null) | undefined;
      var xf2: (b2Transform | null) | undefined;
      var edge1: number = 0;
      var flip: number = 0;
      var k_relativeTol: number = 0.98;
      var k_absoluteTol: number = 0.001;
      var tMat: (b2Mat22 | null) | undefined;
      if (separationB > k_relativeTol * separationA + k_absoluteTol) {
         poly1 = polyB;
         poly2 = polyA;
         xf1 = xfB;
         xf2 = xfA;
         edge1 = edgeB;
         manifold!.m_type = b2Manifold.e_faceB;
         flip = 1;
      }
      else {
         poly1 = polyA;
         poly2 = polyB;
         xf1 = xfA;
         xf2 = xfB;
         edge1 = edgeA;
         manifold!.m_type = b2Manifold.e_faceA;
         flip = 0;
      }
      var incidentEdge: Array<(ClipVertex | null)> = b2Collision.s_incidentEdge;
      b2Collision.FindIncidentEdge(incidentEdge, poly1, xf1, edge1, poly2, xf2);
      var count1: number = parseInt(String(poly1!.m_vertexCount));
      var vertices1: Array<(b2Vec2 | null)> = poly1!.m_vertices;
      var local_v11: (b2Vec2 | null) = vertices1![edge1];
      var local_v12: (b2Vec2 | null) | undefined;
      if (edge1 + 1 < count1) {
         local_v12 = vertices1![parseInt(String(edge1 + 1))];
      }
      else {
         local_v12 = vertices1![0];
      }
      var localTangent: (b2Vec2 | null) = b2Collision.s_localTangent;
      localTangent!.Set(local_v12!.x - local_v11!.x, local_v12!.y - local_v11!.y);
      localTangent!.Normalize();
      var localNormal: (b2Vec2 | null) = b2Collision.s_localNormal;
      localNormal!.x = localTangent!.y;
      localNormal!.y = (-localTangent!.x);
      var planePoint: (b2Vec2 | null) = b2Collision.s_planePoint;
      planePoint!.Set(0.5 * (local_v11!.x + local_v12!.x), 0.5 * (local_v11!.y + local_v12!.y));
      var tangent: (b2Vec2 | null) = b2Collision.s_tangent;
      tMat = xf1!.R;
      tangent!.x = (tMat!.col1!.x * localTangent!.x + tMat!.col2!.x * localTangent!.y);
      tangent!.y = (tMat!.col1!.y * localTangent!.x + tMat!.col2!.y * localTangent!.y);
      var tangent2: (b2Vec2 | null) = b2Collision.s_tangent2;
      tangent2!.x = (-tangent!.x);
      tangent2!.y = (-tangent!.y);
      var normal: (b2Vec2 | null) = b2Collision.s_normal;
      normal!.x = tangent!.y;
      normal!.y = (-tangent!.x);
      var v11: (b2Vec2 | null) = b2Collision.s_v11;
      var v12: (b2Vec2 | null) = b2Collision.s_v12;
      v11!.x = xf1!.position!.x + (tMat!.col1!.x * local_v11!.x + tMat!.col2!.x * local_v11!.y);
      v11!.y = xf1!.position!.y + (tMat!.col1!.y * local_v11!.x + tMat!.col2!.y * local_v11!.y);
      v12!.x = xf1!.position!.x + (tMat!.col1!.x * local_v12!.x + tMat!.col2!.x * local_v12!.y);
      v12!.y = xf1!.position!.y + (tMat!.col1!.y * local_v12!.x + tMat!.col2!.y * local_v12!.y);
      var frontOffset: number = normal!.x * v11!.x + normal!.y * v11!.y;
      var sideOffset1: number = (-tangent!.x * v11!.x) - tangent!.y * v11!.y + totalRadius;
      var sideOffset2: number = tangent!.x * v12!.x + tangent!.y * v12!.y + totalRadius;
      var clipPoints1: Array<(ClipVertex | null)> = b2Collision.s_clipPoints1;
      var clipPoints2: Array<(ClipVertex | null)> = b2Collision.s_clipPoints2;
      var np: number = 0;
      np = b2Collision.ClipSegmentToLine(clipPoints1, incidentEdge, tangent2, sideOffset1);
      if (np < 2) return;
      np = b2Collision.ClipSegmentToLine(clipPoints2, clipPoints1, tangent, sideOffset2);
      if (np < 2) return;
      manifold!.m_localPlaneNormal!.SetV(localNormal);
      manifold!.m_localPoint!.SetV(planePoint);
      var pointCount: number = 0;
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; ++i) {
         cv = clipPoints2![i];
         var separation: number = normal!.x * cv!.v!.x + normal!.y * cv!.v!.y - frontOffset;
         if (separation <= totalRadius) {
            var cp: (b2ManifoldPoint | null) = manifold!.m_points![pointCount];
            tMat = xf2!.R;
            var tX: number = cv!.v!.x - xf2!.position!.x;
            var tY: number = cv!.v!.y - xf2!.position!.y;
            cp!.m_localPoint!.x = (tX * tMat!.col1!.x + tY * tMat!.col1!.y);
            cp!.m_localPoint!.y = (tX * tMat!.col2!.x + tY * tMat!.col2!.y);
            cp!.m_id!.Set(cv!.id);
            cp!.m_id!.features!.flip = flip;
            ++pointCount;
         }
      }
      manifold!.m_pointCount = pointCount;
   }
   static CollideCircles(manifold: (b2Manifold | null), circle1: (b2CircleShape | null), xf1: (b2Transform | null), circle2: (b2CircleShape | null), xf2: (b2Transform | null)): void {
      manifold!.m_pointCount = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      tMat = xf1!.R;
      tVec = circle1!.m_p;
      var p1X: number = xf1!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var p1Y: number = xf1!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      tMat = xf2!.R;
      tVec = circle2!.m_p;
      var p2X: number = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var p2Y: number = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      var dX: number = p2X - p1X;
      var dY: number = p2Y - p1Y;
      var distSqr: number = dX * dX + dY * dY;
      var radius: number = circle1!.m_radius + circle2!.m_radius;
      if (distSqr > radius * radius) {
         return;
      }
      manifold!.m_type = b2Manifold.e_circles;
      manifold!.m_localPoint!.SetV(circle1!.m_p);
      manifold!.m_localPlaneNormal!.SetZero();
      manifold!.m_pointCount = 1;
      manifold!.m_points![0]!.m_localPoint!.SetV(circle2!.m_p);
      manifold!.m_points![0]!.m_id!.key = 0;
   }
   static CollidePolygonAndCircle(manifold: (b2Manifold | null), polygon: (b2PolygonShape | null), xf1: (b2Transform | null), circle: (b2CircleShape | null), xf2: (b2Transform | null)): void {
      manifold!.m_pointCount = 0;
      var tPoint: (b2ManifoldPoint | null) | undefined;
      var dX: number = 0;
      var dY: number = 0;
      var positionX: number = 0;
      var positionY: number = 0;
      var tVec: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = xf2!.R;
      tVec = circle!.m_p;
      var cX: number = xf2!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var cY: number = xf2!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      dX = cX - xf1!.position!.x;
      dY = cY - xf1!.position!.y;
      tMat = xf1!.R;
      var cLocalX: number = (dX * tMat!.col1!.x + dY * tMat!.col1!.y);
      var cLocalY: number = (dX * tMat!.col2!.x + dY * tMat!.col2!.y);
      var dist: number = 0;
      var normalIndex: number = 0;
      var separation: number = (-Number.MAX_VALUE);
      var radius: number = polygon!.m_radius + circle!.m_radius;
      var vertexCount: number = parseInt(String(polygon!.m_vertexCount));
      var vertices: Array<(b2Vec2 | null)> = polygon!.m_vertices;
      var normals: Array<(b2Vec2 | null)> = polygon!.m_normals;
      for (var i: number = 0; i < vertexCount; ++i) {
         tVec = vertices![i];
         dX = cLocalX - tVec!.x;
         dY = cLocalY - tVec!.y;
         tVec = normals![i];
         var s: number = tVec!.x * dX + tVec!.y * dY;
         if (s > radius) {
            return;
         }
         if (s > separation) {
            separation = s;
            normalIndex = i;
         }
      }
      var vertIndex1: number = parseInt(String(normalIndex));
      var vertIndex2: number = parseInt(String(vertIndex1 + 1 < vertexCount ? vertIndex1 + 1 : 0));
      var v1: (b2Vec2 | null) = vertices![vertIndex1];
      var v2: (b2Vec2 | null) = vertices![vertIndex2];
      if (separation < Number.MIN_VALUE) {
         manifold!.m_pointCount = 1;
         manifold!.m_type = b2Manifold.e_faceA;
         manifold!.m_localPlaneNormal!.SetV(normals![normalIndex]);
         manifold!.m_localPoint!.x = 0.5 * (v1!.x + v2!.x);
         manifold!.m_localPoint!.y = 0.5 * (v1!.y + v2!.y);
         manifold!.m_points![0]!.m_localPoint!.SetV(circle!.m_p);
         manifold!.m_points![0]!.m_id!.key = 0;
         return;
      }
      var u1: number = (cLocalX - v1!.x) * (v2!.x - v1!.x) + (cLocalY - v1!.y) * (v2!.y - v1!.y);
      var u2: number = (cLocalX - v2!.x) * (v1!.x - v2!.x) + (cLocalY - v2!.y) * (v1!.y - v2!.y);
      if (u1 <= 0.0) {
         if ((cLocalX - v1!.x) * (cLocalX - v1!.x) + (cLocalY - v1!.y) * (cLocalY - v1!.y) > radius * radius) return;
         manifold!.m_pointCount = 1;
         manifold!.m_type = b2Manifold.e_faceA;
         manifold!.m_localPlaneNormal!.x = cLocalX - v1!.x;
         manifold!.m_localPlaneNormal!.y = cLocalY - v1!.y;
         manifold!.m_localPlaneNormal!.Normalize();
         manifold!.m_localPoint!.SetV(v1);
         manifold!.m_points![0]!.m_localPoint!.SetV(circle!.m_p);
         manifold!.m_points![0]!.m_id!.key = 0;
      }
      else if (u2 <= 0) {
         if ((cLocalX - v2!.x) * (cLocalX - v2!.x) + (cLocalY - v2!.y) * (cLocalY - v2!.y) > radius * radius) return;
         manifold!.m_pointCount = 1;
         manifold!.m_type = b2Manifold.e_faceA;
         manifold!.m_localPlaneNormal!.x = cLocalX - v2!.x;
         manifold!.m_localPlaneNormal!.y = cLocalY - v2!.y;
         manifold!.m_localPlaneNormal!.Normalize();
         manifold!.m_localPoint!.SetV(v2);
         manifold!.m_points![0]!.m_localPoint!.SetV(circle!.m_p);
         manifold!.m_points![0]!.m_id!.key = 0;
      }
      else {
         var faceCenterX: number = 0.5 * (v1!.x + v2!.x);
         var faceCenterY: number = 0.5 * (v1!.y + v2!.y);
         separation = (cLocalX - faceCenterX) * normals![vertIndex1]!.x + (cLocalY - faceCenterY) * normals![vertIndex1]!.y;
         if (separation > radius) return;
         manifold!.m_pointCount = 1;
         manifold!.m_type = b2Manifold.e_faceA;
         manifold!.m_localPlaneNormal!.x = normals![vertIndex1]!.x;
         manifold!.m_localPlaneNormal!.y = normals![vertIndex1]!.y;
         manifold!.m_localPlaneNormal!.Normalize();
         manifold!.m_localPoint!.Set(faceCenterX, faceCenterY);
         manifold!.m_points![0]!.m_localPoint!.SetV(circle!.m_p);
         manifold!.m_points![0]!.m_id!.key = 0;
      }
   }
   static TestOverlap(a: (b2AABB | null), b: (b2AABB | null)): boolean {
      var t1: (b2Vec2 | null) = b!.lowerBound;
      var t2: (b2Vec2 | null) = a!.upperBound;
      var d1X: number = t1!.x - t2!.x;
      var d1Y: number = t1!.y - t2!.y;
      t1 = a!.lowerBound;
      t2 = b!.upperBound;
      var d2X: number = t1!.x - t2!.x;
      var d2Y: number = t1!.y - t2!.y;
      if (d1X > 0.0 || d1Y > 0.0) return false;
      if (d2X > 0.0 || d2Y > 0.0) return false;
      return true;
   }
}

class b2ContactID {
   declare features: (Features | null);
   declare _key: number;

   constructor() {

      this.features = new Features();

      if (new.target === b2ContactID) this.b2ContactID();
   }
   b2ContactID(): void {
      this.features!._m_id = this;
   }
   Set(id: (b2ContactID | null)): void {
      this.key = id!._key;
   }
   Copy(): (b2ContactID | null) {
      var id: (b2ContactID | null) = new b2ContactID();
      id!.key = this.key;
      return id;
   }
   get key(): number {
         return this._key;
      }
   set key(value: number) {
         if (value === undefined) value = 0;
         this._key = value;
         this.features!._referenceEdge = this._key & 0x000000ff;
         this.features!._incidentEdge = ((this._key & 0x0000ff00) >> 8) & 0x000000ff;
         this.features!._incidentVertex = ((this._key & 0x00ff0000) >> 16) & 0x000000ff;
         this.features!._flip = ((this._key & 0xff000000) >> 24) & 0x000000ff;
      }
}

class b2ContactPoint {
   declare shape1: (b2Shape | null);
   declare shape2: (b2Shape | null);
   declare position: (b2Vec2 | null);
   declare velocity: (b2Vec2 | null);
   declare normal: (b2Vec2 | null);
   declare separation: number;
   declare friction: number;
   declare restitution: number;
   declare id: (b2ContactID | null);

   constructor() {

      this.position = new b2Vec2();
      this.velocity = new b2Vec2();
      this.normal = new b2Vec2();
      this.id = new b2ContactID();

   }
}

class b2Distance {
   declare static b2_gjkCalls: number;
   declare static b2_gjkIters: number;
   declare static b2_gjkMaxIters: number;
   declare static s_simplex: (b2Simplex | null);
   declare static s_saveA: Array<number>;
   declare static s_saveB: Array<number>;

   constructor() {

   }
   static Distance(output: (b2DistanceOutput | null), cache: (b2SimplexCache | null), input: (b2DistanceInput | null)): void {
      ++b2Distance.b2_gjkCalls;
      var proxyA: (b2DistanceProxy | null) = input!.proxyA;
      var proxyB: (b2DistanceProxy | null) = input!.proxyB;
      var transformA: (b2Transform | null) = input!.transformA;
      var transformB: (b2Transform | null) = input!.transformB;
      var simplex: (b2Simplex | null) = b2Distance.s_simplex;
      simplex!.ReadCache(cache, proxyA, transformA, proxyB, transformB);
      var vertices: Array<(b2SimplexVertex | null)> = simplex!.m_vertices;
      var k_maxIters: number = 20;
      var saveA: Array<number> = b2Distance.s_saveA;
      var saveB: Array<number> = b2Distance.s_saveB;
      var saveCount: number = 0;
      var closestPoint: (b2Vec2 | null) = simplex!.GetClosestPoint();
      var distanceSqr1: number = closestPoint!.LengthSquared();
      var distanceSqr2: number = distanceSqr1;
      var i: number = 0;
      var p: (b2Vec2 | null) | undefined;
      var iter: number = 0;
      while (iter < k_maxIters) {
         saveCount = simplex!.m_count;
         for (i = 0;
         i < saveCount; i++) {
            saveA![i] = vertices![i]!.indexA;
            saveB![i] = vertices![i]!.indexB;
         }
         switch (simplex!.m_count) {
         case 1:
            break;
         case 2:
            simplex!.Solve2();
            break;
         case 3:
            simplex!.Solve3();
            break;
         default:
            b2Settings.b2Assert(false);
         }
         if (simplex!.m_count == 3) {
            break;
         }
         p = simplex!.GetClosestPoint();
         distanceSqr2 = p!.LengthSquared();
         if (distanceSqr2 > distanceSqr1) {}
         distanceSqr1 = distanceSqr2;
         var d: (b2Vec2 | null) = simplex!.GetSearchDirection();
         if (d!.LengthSquared() < Number.MIN_VALUE * Number.MIN_VALUE) {
            break;
         }
         var vertex: (b2SimplexVertex | null) = vertices![simplex!.m_count];
         vertex!.indexA = proxyA!.GetSupport(b2Math.MulTMV(transformA!.R, d!.GetNegative()));
         vertex!.wA = b2Math.MulX(transformA, proxyA!.GetVertex(vertex!.indexA));
         vertex!.indexB = proxyB!.GetSupport(b2Math.MulTMV(transformB!.R, d));
         vertex!.wB = b2Math.MulX(transformB, proxyB!.GetVertex(vertex!.indexB));
         vertex!.w = b2Math.SubtractVV(vertex!.wB, vertex!.wA);
         ++iter;
         ++b2Distance.b2_gjkIters;
         var duplicate: boolean = false;
         for (i = 0;
         i < saveCount; i++) {
            if (vertex!.indexA == saveA![i] && vertex!.indexB == saveB![i]) {
               duplicate = true;
               break;
            }
         }
         if (duplicate) {
            break;
         }++simplex!.m_count;
      }
      b2Distance.b2_gjkMaxIters = b2Math.Max(b2Distance.b2_gjkMaxIters, iter);
      simplex!.GetWitnessPoints(output!.pointA, output!.pointB);
      output!.distance = b2Math.SubtractVV(output!.pointA, output!.pointB)!.Length();
      output!.iterations = iter;
      simplex!.WriteCache(cache);
      if (input!.useRadii) {
         var rA: number = proxyA!.m_radius;
         var rB: number = proxyB!.m_radius;
         if (output!.distance > rA + rB && output!.distance > Number.MIN_VALUE) {
            output!.distance -= rA + rB;
            var normal: (b2Vec2 | null) = b2Math.SubtractVV(output!.pointB, output!.pointA);
            normal!.Normalize();
            output!.pointA!.x += rA * normal!.x;
            output!.pointA!.y += rA * normal!.y;
            output!.pointB!.x -= rB * normal!.x;
            output!.pointB!.y -= rB * normal!.y;
         }
         else {
            p = new b2Vec2();
            p!.x = .5 * (output!.pointA!.x + output!.pointB!.x);
            p!.y = .5 * (output!.pointA!.y + output!.pointB!.y);
            output!.pointA!.x = output!.pointB!.x = p!.x;
            output!.pointA!.y = output!.pointB!.y = p!.y;
            output!.distance = 0.0;
         }
      }
   }
}

class b2DistanceInput {
   declare proxyA: (b2DistanceProxy | null);
   declare proxyB: (b2DistanceProxy | null);
   declare transformA: (b2Transform | null);
   declare transformB: (b2Transform | null);
   declare useRadii: boolean;

   constructor() {

   }
}

class b2DistanceOutput {
   declare pointA: (b2Vec2 | null);
   declare pointB: (b2Vec2 | null);
   declare distance: number;
   declare iterations: number;

   constructor() {

      this.pointA = new b2Vec2();
      this.pointB = new b2Vec2();

   }
}

class b2DistanceProxy {
   // The generated upstream new Vector(1, true) is Array(1, true): index 0
   // becomes the circle's vertex, while index 1 remains the unused boolean.
   // Keep the actual heterogeneous array and narrow its live reads explicitly.
   declare m_vertices: Array<b2Vec2 | null | number | boolean>;
   declare m_count: number;
   declare m_radius: number;

   constructor() {

   }
   Set(shape: (b2Shape | null)): void {
      switch (shape!.GetType()) {
      case b2Shape.e_circleShape:
         {
            var circle: (b2CircleShape | null) = (shape instanceof b2CircleShape ? shape : null);
            this.m_vertices = [1, true];
            this.m_vertices![0] = circle!.m_p;
            this.m_count = 1;
            this.m_radius = circle!.m_radius;
         }
         break;
      case b2Shape.e_polygonShape:
         {
            var polygon: (b2PolygonShape | null) = (shape instanceof b2PolygonShape ? shape : null);
            this.m_vertices = polygon!.m_vertices;
            this.m_count = polygon!.m_vertexCount;
            this.m_radius = polygon!.m_radius;
         }
         break;
      default:
         b2Settings.b2Assert(false);
      }
   }
   private ReadVertex(index: number): b2Vec2 {
      var vertex: b2Vec2 | null | number | boolean | undefined = this.m_vertices[index];
      if (vertex instanceof b2Vec2) return vertex;
      throw new Error("Box2D distance proxy: non-vector in the live vertex prefix");
   }
   GetSupport(d: (b2Vec2 | null)): number {
      var bestIndex: number = 0;
      var bestValue: number = this.ReadVertex(0).x * d!.x + this.ReadVertex(0).y * d!.y;
      for (var i: number = 1; i < this.m_count; ++i) {
         var value: number = this.ReadVertex(i).x * d!.x + this.ReadVertex(i).y * d!.y;
         if (value > bestValue) {
            bestIndex = i;
            bestValue = value;
         }
      }
      return bestIndex;
   }
   GetSupportVertex(d: (b2Vec2 | null)): (b2Vec2 | null) {
      var bestIndex: number = 0;
      var bestValue: number = this.ReadVertex(0).x * d!.x + this.ReadVertex(0).y * d!.y;
      for (var i: number = 1; i < this.m_count; ++i) {
         var value: number = this.ReadVertex(i).x * d!.x + this.ReadVertex(i).y * d!.y;
         if (value > bestValue) {
            bestIndex = i;
            bestValue = value;
         }
      }
      return this.ReadVertex(bestIndex);
   }
   GetVertexCount(): number {
      return this.m_count;
   }
   GetVertex(index: number): (b2Vec2 | null) {
      if (index === undefined) index = 0;
      b2Settings.b2Assert(0 <= index && index < this.m_count);
      return this.ReadVertex(index);
   }
}

class b2DynamicTree {
   declare m_root: (b2DynamicTreeNode | null);
   declare m_freeList: (b2DynamicTreeNode | null);
   declare m_path: number;
   declare m_insertionCount: number;

   constructor() {

      if (new.target === b2DynamicTree) this.b2DynamicTree();
   }
   b2DynamicTree(): void {
      this.m_root = null;
      this.m_freeList = null;
      this.m_path = 0;
      this.m_insertionCount = 0;
   }
   CreateProxy(aabb: (b2AABB | null), userData: unknown): (b2DynamicTreeNode | null) {
      var node: (b2DynamicTreeNode | null) = this.AllocateNode();
      var extendX: number = b2Settings.b2_aabbExtension;
      var extendY: number = b2Settings.b2_aabbExtension;
      node!.aabb!.lowerBound!.x = aabb!.lowerBound!.x - extendX;
      node!.aabb!.lowerBound!.y = aabb!.lowerBound!.y - extendY;
      node!.aabb!.upperBound!.x = aabb!.upperBound!.x + extendX;
      node!.aabb!.upperBound!.y = aabb!.upperBound!.y + extendY;
      node!.userData = userData;
      this.InsertLeaf(node);
      return node;
   }
   DestroyProxy(proxy: (b2DynamicTreeNode | null)): void {
      this.RemoveLeaf(proxy);
      this.FreeNode(proxy);
   }
   MoveProxy(proxy: (b2DynamicTreeNode | null), aabb: (b2AABB | null), displacement: (b2Vec2 | null)): boolean {
      b2Settings.b2Assert(proxy!.IsLeaf());
      if (proxy!.aabb!.Contains(aabb)) {
         return false;
      }
      this.RemoveLeaf(proxy);
      var extendX: number = b2Settings.b2_aabbExtension + b2Settings.b2_aabbMultiplier * (displacement!.x > 0 ? displacement!.x : (-displacement!.x));
      var extendY: number = b2Settings.b2_aabbExtension + b2Settings.b2_aabbMultiplier * (displacement!.y > 0 ? displacement!.y : (-displacement!.y));
      proxy!.aabb!.lowerBound!.x = aabb!.lowerBound!.x - extendX;
      proxy!.aabb!.lowerBound!.y = aabb!.lowerBound!.y - extendY;
      proxy!.aabb!.upperBound!.x = aabb!.upperBound!.x + extendX;
      proxy!.aabb!.upperBound!.y = aabb!.upperBound!.y + extendY;
      this.InsertLeaf(proxy);
      return true;
   }
   Rebalance(iterations: number): void {
      if (iterations === undefined) iterations = 0;
      if (this.m_root == null) return;
      for (var i: number = 0; i < iterations; i++) {
         var node: (b2DynamicTreeNode | null) = this.m_root;
         var bit: number = 0;
         while (node!.IsLeaf() == false) {
            node = (this.m_path >> bit) & 1 ? node!.child2 : node!.child1;
            bit = (bit + 1) & 31;
         }++this.m_path;
         this.RemoveLeaf(node);
         this.InsertLeaf(node);
      }
   }
   GetFatAABB(proxy: (b2DynamicTreeNode | null)): (b2AABB | null) {
      return proxy!.aabb;
   }
   GetUserData(proxy: (b2DynamicTreeNode | null)): unknown {
      return proxy!.userData;
   }
   Query(callback: TreeQueryCallback, aabb: (b2AABB | null)): void {
      if (this.m_root == null) return;
      var stack: Array<(b2DynamicTreeNode | null)> = new Array<(b2DynamicTreeNode | null)>();
      var count: number = 0;
      stack![count++] = this.m_root;
      while (count > 0) {
         var node: (b2DynamicTreeNode | null) = stack![--count];
         if (node!.aabb!.TestOverlap(aabb)) {
            if (node!.IsLeaf()) {
               var proceed: boolean = callback(node!);
               if (!proceed) return;
            }
            else {
               stack![count++] = node!.child1;
               stack![count++] = node!.child2;
            }
         }
      }
   }
   RayCast(callback: TreeRayCallback, input: (b2RayCastInput | null)): void {
      if (this.m_root == null) return;
      var p1: (b2Vec2 | null) = input!.p1;
      var p2: (b2Vec2 | null) = input!.p2;
      var r: (b2Vec2 | null) = b2Math.SubtractVV(p1, p2);
      r!.Normalize();
      var v: (b2Vec2 | null) = b2Math.CrossFV(1.0, r);
      var abs_v: (b2Vec2 | null) = b2Math.AbsV(v);
      var maxFraction: number = input!.maxFraction;
      var segmentAABB: (b2AABB | null) = new b2AABB();
      var tX: number = 0;
      var tY: number = 0; {
         tX = p1!.x + maxFraction * (p2!.x - p1!.x);
         tY = p1!.y + maxFraction * (p2!.y - p1!.y);
         segmentAABB!.lowerBound!.x = Math.min(p1!.x, tX);
         segmentAABB!.lowerBound!.y = Math.min(p1!.y, tY);
         segmentAABB!.upperBound!.x = Math.max(p1!.x, tX);
         segmentAABB!.upperBound!.y = Math.max(p1!.y, tY);
      }
      var stack: Array<(b2DynamicTreeNode | null)> = new Array<(b2DynamicTreeNode | null)>();
      var count: number = 0;
      stack![count++] = this.m_root;
      while (count > 0) {
         var node: (b2DynamicTreeNode | null) = stack![--count];
         if (node!.aabb!.TestOverlap(segmentAABB) == false) {
            continue;
         }
         var c: (b2Vec2 | null) = node!.aabb!.GetCenter();
         var h: (b2Vec2 | null) = node!.aabb!.GetExtents();
         var separation: number = Math.abs(v!.x * (p1!.x - c!.x) + v!.y * (p1!.y - c!.y)) - abs_v!.x * h!.x - abs_v!.y * h!.y;
         if (separation > 0.0) continue;
         if (node!.IsLeaf()) {
            var subInput: (b2RayCastInput | null) = new b2RayCastInput();
            subInput!.p1 = input!.p1;
            subInput!.p2 = input!.p2;
            subInput!.maxFraction = input!.maxFraction;
            maxFraction = callback(subInput!, node!);
            if (maxFraction == 0.0) return;
            if (maxFraction > 0.0) {
               tX = p1!.x + maxFraction * (p2!.x - p1!.x);
               tY = p1!.y + maxFraction * (p2!.y - p1!.y);
               segmentAABB!.lowerBound!.x = Math.min(p1!.x, tX);
               segmentAABB!.lowerBound!.y = Math.min(p1!.y, tY);
               segmentAABB!.upperBound!.x = Math.max(p1!.x, tX);
               segmentAABB!.upperBound!.y = Math.max(p1!.y, tY);
            }
         }
         else {
            stack![count++] = node!.child1;
            stack![count++] = node!.child2;
         }
      }
   }
   AllocateNode(): (b2DynamicTreeNode | null) {
      if (this.m_freeList) {
         var node: (b2DynamicTreeNode | null) = this.m_freeList;
         this.m_freeList = node!.parent;
         node!.parent = null;
         node!.child1 = null;
         node!.child2 = null;
         return node;
      }
      return new b2DynamicTreeNode();
   }
   FreeNode(node: (b2DynamicTreeNode | null)): void {
      node!.parent = this.m_freeList;
      this.m_freeList = node;
   }
   InsertLeaf(leaf: (b2DynamicTreeNode | null)): void {
      ++this.m_insertionCount;
      if (this.m_root == null) {
         this.m_root = leaf;
         this.m_root!.parent = null;
         return;
      }
      var center: (b2Vec2 | null) = leaf!.aabb!.GetCenter();
      var sibling: (b2DynamicTreeNode | null) = this.m_root;
      if (sibling!.IsLeaf() == false) {
         do {
            var child1: (b2DynamicTreeNode | null) = sibling!.child1;
            var child2: (b2DynamicTreeNode | null) = sibling!.child2;
            var norm1: number = Math.abs((child1!.aabb!.lowerBound!.x + child1!.aabb!.upperBound!.x) / 2 - center!.x) + Math.abs((child1!.aabb!.lowerBound!.y + child1!.aabb!.upperBound!.y) / 2 - center!.y);
            var norm2: number = Math.abs((child2!.aabb!.lowerBound!.x + child2!.aabb!.upperBound!.x) / 2 - center!.x) + Math.abs((child2!.aabb!.lowerBound!.y + child2!.aabb!.upperBound!.y) / 2 - center!.y);
            if (norm1 < norm2) {
               sibling = child1;
            }
            else {
               sibling = child2;
            }
         }
         while (sibling!.IsLeaf() == false)
      }
      var node1: (b2DynamicTreeNode | null) = sibling!.parent;
      var node2: (b2DynamicTreeNode | null) = this.AllocateNode();
      node2!.parent = node1;
      node2!.userData = null;
      node2!.aabb!.Combine(leaf!.aabb, sibling!.aabb);
      if (node1) {
         if (sibling!.parent!.child1 == sibling) {
            node1!.child1 = node2;
         }
         else {
            node1!.child2 = node2;
         }
         node2!.child1 = sibling;
         node2!.child2 = leaf;
         sibling!.parent = node2;
         leaf!.parent = node2;
         do {
            if (node1!.aabb!.Contains(node2!.aabb)) break;
            node1!.aabb!.Combine(node1!.child1!.aabb, node1!.child2!.aabb);
            node2 = node1;
            node1 = node1!.parent;
         }
         while (node1)
      }
      else {
         node2!.child1 = sibling;
         node2!.child2 = leaf;
         sibling!.parent = node2;
         leaf!.parent = node2;
         this.m_root = node2;
      }
   }
   RemoveLeaf(leaf: (b2DynamicTreeNode | null)): void {
      if (leaf == this.m_root) {
         this.m_root = null;
         return;
      }
      var node2: (b2DynamicTreeNode | null) = leaf!.parent;
      var node1: (b2DynamicTreeNode | null) = node2!.parent;
      var sibling: (b2DynamicTreeNode | null) | undefined;
      if (node2!.child1 == leaf) {
         sibling = node2!.child2;
      }
      else {
         sibling = node2!.child1;
      }
      if (node1) {
         if (node1!.child1 == node2) {
            node1!.child1 = sibling;
         }
         else {
            node1!.child2 = sibling;
         }
         sibling!.parent = node1;
         this.FreeNode(node2);
         while (node1) {
            var oldAABB: (b2AABB | null) = node1!.aabb;
            node1!.aabb = b2AABB.Combine(node1!.child1!.aabb, node1!.child2!.aabb);
            if (oldAABB!.Contains(node1!.aabb)) break;
            node1 = node1!.parent;
         }
      }
      else {
         this.m_root = sibling;
         sibling!.parent = null;
         this.FreeNode(node2);
      }
   }
}

class b2DynamicTreeBroadPhase {
   declare m_tree: (b2DynamicTree | null);
   declare m_proxyCount: number;
   declare m_moveBuffer: Array<(b2DynamicTreeNode | null)>;
   declare m_pairBuffer: Array<(b2DynamicTreePair | null)>;
   declare m_pairCount: number;

   constructor() {

      this.m_tree = new b2DynamicTree();
      this.m_moveBuffer = new Array<(b2DynamicTreeNode | null)>();
      this.m_pairBuffer = new Array<(b2DynamicTreePair | null)>();
      this.m_pairCount = 0;

   }
   CreateProxy(aabb: (b2AABB | null), userData: unknown): b2DynamicTreeNode | null {
      var proxy: (b2DynamicTreeNode | null) = this.m_tree!.CreateProxy(aabb, userData);
      ++this.m_proxyCount;
      this.BufferMove(proxy);
      return proxy;
   }
   DestroyProxy(proxy: b2DynamicTreeNode | null): void {
      this.UnBufferMove(proxy);
      --this.m_proxyCount;
      this.m_tree!.DestroyProxy(proxy);
   }
   MoveProxy(proxy: b2DynamicTreeNode | null, aabb: (b2AABB | null), displacement: (b2Vec2 | null)): void {
      var buffer: boolean = this.m_tree!.MoveProxy(proxy, aabb, displacement);
      if (buffer) {
         this.BufferMove(proxy);
      }
   }
   TestOverlap(proxyA: b2DynamicTreeNode | null, proxyB: b2DynamicTreeNode | null): boolean {
      var aabbA: (b2AABB | null) = this.m_tree!.GetFatAABB(proxyA);
      var aabbB: (b2AABB | null) = this.m_tree!.GetFatAABB(proxyB);
      return aabbA!.TestOverlap(aabbB);
   }
   GetUserData(proxy: b2DynamicTreeNode | null): unknown {
      return this.m_tree!.GetUserData(proxy);
   }
   GetFatAABB(proxy: b2DynamicTreeNode | null): (b2AABB | null) {
      return this.m_tree!.GetFatAABB(proxy);
   }
   GetProxyCount(): number {
      return this.m_proxyCount;
   }
   UpdatePairs(callback: PairCallback): void {
      var __this: b2DynamicTreeBroadPhase = this;
      __this!.m_pairCount = 0;
      var i: number = 0,
         queryProxy: (b2DynamicTreeNode | null) | undefined;
      for (i = 0;
      i! < __this!.m_moveBuffer!.length!; ++i) {
         queryProxy = __this!.m_moveBuffer![i];

         function QueryCallback(proxy: (b2DynamicTreeNode | null)) {
            if (proxy == queryProxy) return true;
            if (__this!.m_pairCount == __this!.m_pairBuffer!.length) {
               __this!.m_pairBuffer![__this!.m_pairCount] = new b2DynamicTreePair();
            }
            var pair: (b2DynamicTreePair | null) = __this!.m_pairBuffer![__this!.m_pairCount];
            pair!.proxyA = proxy! < queryProxy! ? proxy : queryProxy!;
            pair!.proxyB = proxy! >= queryProxy! ? proxy : queryProxy!;++__this!.m_pairCount;
            return true;
         };
         var fatAABB: (b2AABB | null) = __this!.m_tree!.GetFatAABB(queryProxy);
         __this!.m_tree!.Query(QueryCallback, fatAABB);
      }
      __this!.m_moveBuffer!.length = 0;
      for (var i: number = 0; i! < __this!.m_pairCount!;) {
         var primaryPair: (b2DynamicTreePair | null) = __this!.m_pairBuffer![i];
         var userDataA = __this!.m_tree!.GetUserData(primaryPair!.proxyA);
         var userDataB = __this!.m_tree!.GetUserData(primaryPair!.proxyB);
         callback(userDataA!, userDataB!);
         ++i;
         while (i! < __this!.m_pairCount!) {
            var pair: (b2DynamicTreePair | null) = __this!.m_pairBuffer![i];
            if (pair!.proxyA != primaryPair!.proxyA || pair!.proxyB != primaryPair!.proxyB) {
               break;
            }++i;
         }
      }
   }
   Query(callback: TreeQueryCallback, aabb: (b2AABB | null)): void {
      this.m_tree!.Query(callback, aabb);
   }
   RayCast(callback: TreeRayCallback, input: (b2RayCastInput | null)): void {
      this.m_tree!.RayCast(callback, input);
   }
   Validate(): void {}
   Rebalance(iterations: number): void {
      if (iterations === undefined) iterations = 0;
      this.m_tree!.Rebalance(iterations);
   }
   BufferMove(proxy: (b2DynamicTreeNode | null)): void {
      this.m_moveBuffer![this.m_moveBuffer!.length] = proxy;
   }
   UnBufferMove(proxy: (b2DynamicTreeNode | null)): void {
      var i: number = parseInt(String(this.m_moveBuffer!.indexOf(proxy)));
      this.m_moveBuffer!.splice(i, 1);
   }
   ComparePairs(pair1: (b2DynamicTreePair | null), pair2: (b2DynamicTreePair | null)): number {
      return 0;
   }
}

class b2DynamicTreeNode {
   declare userData: unknown;
   declare aabb: (b2AABB | null);
   declare parent: (b2DynamicTreeNode | null);
   declare child1: (b2DynamicTreeNode | null);
   declare child2: (b2DynamicTreeNode | null);

   constructor() {

      this.aabb = new b2AABB();

   }
   IsLeaf(): boolean {
      return this.child1 == null;
   }
}

class b2DynamicTreePair {
   declare proxyA: (b2DynamicTreeNode | null);
   declare proxyB: (b2DynamicTreeNode | null);

   constructor() {

   }
}

class b2Manifold {
   declare m_points: Array<(b2ManifoldPoint | null)>;
   declare m_localPlaneNormal: (b2Vec2 | null);
   declare m_localPoint: (b2Vec2 | null);
   declare m_type: number;
   declare m_pointCount: number;
   declare static e_circles: number;
   declare static e_faceA: number;
   declare static e_faceB: number;

   constructor() {

      this.m_pointCount = 0;

      if (new.target === b2Manifold) this.b2Manifold();
   }
   b2Manifold(): void {
      this.m_points = new Array<(b2ManifoldPoint | null)>(b2Settings.b2_maxManifoldPoints);
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         this.m_points![i] = new b2ManifoldPoint();
      }
      this.m_localPlaneNormal = new b2Vec2();
      this.m_localPoint = new b2Vec2();
   }
   Reset(): void {
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         (((this.m_points![i] instanceof b2ManifoldPoint ? (this.m_points![i]) : null)!)).Reset();
      }
      this.m_localPlaneNormal!.SetZero();
      this.m_localPoint!.SetZero();
      this.m_type = 0;
      this.m_pointCount = 0;
   }
   Set(m: (b2Manifold | null)): void {
      this.m_pointCount = m!.m_pointCount;
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         (((this.m_points![i] instanceof b2ManifoldPoint ? (this.m_points![i]) : null)!)).Set(m!.m_points![i]);
      }
      this.m_localPlaneNormal!.SetV(m!.m_localPlaneNormal);
      this.m_localPoint!.SetV(m!.m_localPoint);
      this.m_type = m!.m_type;
   }
   Copy(): (b2Manifold | null) {
      var copy: (b2Manifold | null) = new b2Manifold();
      copy!.Set(this);
      return copy;
   }
}

class b2ManifoldPoint {
   declare m_localPoint: (b2Vec2 | null);
   declare m_normalImpulse: number;
   declare m_tangentImpulse: number;
   declare m_id: (b2ContactID | null);

   constructor() {

      this.m_localPoint = new b2Vec2();
      this.m_id = new b2ContactID();

      if (new.target === b2ManifoldPoint) this.b2ManifoldPoint();
   }
   b2ManifoldPoint(): void {
      this.Reset();
   }
   Reset(): void {
      this.m_localPoint!.SetZero();
      this.m_normalImpulse = 0.0;
      this.m_tangentImpulse = 0.0;
      this.m_id!.key = 0;
   }
   Set(m: (b2ManifoldPoint | null)): void {
      this.m_localPoint!.SetV(m!.m_localPoint);
      this.m_normalImpulse = m!.m_normalImpulse;
      this.m_tangentImpulse = m!.m_tangentImpulse;
      this.m_id!.Set(m!.m_id);
   }
}

class b2Point {
   declare p: (b2Vec2 | null);

   constructor() {

      this.p = new b2Vec2();

   }
   Support(xf: (b2Transform | null), vX: number, vY: number): (b2Vec2 | null) {
      if (vX === undefined) vX = 0;
      if (vY === undefined) vY = 0;
      return this.p;
   }
   GetFirstVertex(xf: (b2Transform | null)): (b2Vec2 | null) {
      return this.p;
   }
}

class b2RayCastInput {
   declare p1: (b2Vec2 | null);
   declare p2: (b2Vec2 | null);
   declare maxFraction: number;

   constructor(p1?: (b2Vec2 | null), p2?: (b2Vec2 | null), maxFraction?: number) {

      this.p1 = new b2Vec2();
      this.p2 = new b2Vec2();

      if (new.target === b2RayCastInput) this.b2RayCastInput(p1!, p2!, maxFraction!);
   }
   b2RayCastInput(p1: (b2Vec2 | null) = null, p2: (b2Vec2 | null) = null, maxFraction: number = 1): void {
      if (p1 === undefined) p1 = null;
      if (p2 === undefined) p2 = null;
      if (maxFraction === undefined) maxFraction = 1;
      if (p1) this.p1!.SetV(p1);
      if (p2) this.p2!.SetV(p2);
      this.maxFraction = maxFraction;
   }
}

class b2RayCastOutput {
   declare normal: (b2Vec2 | null);
   declare fraction: number;

   constructor() {

      this.normal = new b2Vec2();

   }
}

class b2Segment {
   declare p1: (b2Vec2 | null);
   declare p2: (b2Vec2 | null);

   constructor() {

      this.p1 = new b2Vec2();
      this.p2 = new b2Vec2();

   }
   TestSegment(lambda: Array<number>, normal: (b2Vec2 | null), segment: (b2Segment | null), maxLambda: number): boolean {
      if (maxLambda === undefined) maxLambda = 0;
      var s: (b2Vec2 | null) = segment!.p1;
      var rX: number = segment!.p2!.x - s!.x;
      var rY: number = segment!.p2!.y - s!.y;
      var dX: number = this.p2!.x - this.p1!.x;
      var dY: number = this.p2!.y - this.p1!.y;
      var nX: number = dY;
      var nY: number = (-dX);
      var k_slop: number = 100.0 * Number.MIN_VALUE;
      var denom: number = (-(rX * nX + rY * nY));
      if (denom > k_slop) {
         var bX: number = s!.x - this.p1!.x;
         var bY: number = s!.y - this.p1!.y;
         var a: number = (bX * nX + bY * nY);
         if (0.0 <= a && a <= maxLambda * denom) {
            var mu2: number = (-rX * bY) + rY * bX;
            if ((-k_slop * denom) <= mu2 && mu2 <= denom * (1.0 + k_slop)) {
               a /= denom;
               var nLen: number = Math.sqrt(nX * nX + nY * nY);
               nX /= nLen;
               nY /= nLen;
               lambda![0] = a;
               normal!.Set(nX, nY);
               return true;
            }
         }
      }
      return false;
   }
   Extend(aabb: (b2AABB | null)): void {
      this.ExtendForward(aabb);
      this.ExtendBackward(aabb);
   }
   ExtendForward(aabb: (b2AABB | null)): void {
      var dX: number = this.p2!.x - this.p1!.x;
      var dY: number = this.p2!.y - this.p1!.y;
      var lambda: number = Math.min(dX > 0 ? (aabb!.upperBound!.x - this.p1!.x) / dX : dX < 0 ? (aabb!.lowerBound!.x - this.p1!.x) / dX : Number.POSITIVE_INFINITY,
      dY > 0 ? (aabb!.upperBound!.y - this.p1!.y) / dY : dY < 0 ? (aabb!.lowerBound!.y - this.p1!.y) / dY : Number.POSITIVE_INFINITY);
      this.p2!.x = this.p1!.x + dX * lambda;
      this.p2!.y = this.p1!.y + dY * lambda;
   }
   ExtendBackward(aabb: (b2AABB | null)): void {
      var dX: number = (-this.p2!.x) + this.p1!.x;
      var dY: number = (-this.p2!.y) + this.p1!.y;
      var lambda: number = Math.min(dX > 0 ? (aabb!.upperBound!.x - this.p2!.x) / dX : dX < 0 ? (aabb!.lowerBound!.x - this.p2!.x) / dX : Number.POSITIVE_INFINITY,
      dY > 0 ? (aabb!.upperBound!.y - this.p2!.y) / dY : dY < 0 ? (aabb!.lowerBound!.y - this.p2!.y) / dY : Number.POSITIVE_INFINITY);
      this.p1!.x = this.p2!.x + dX * lambda;
      this.p1!.y = this.p2!.y + dY * lambda;
   }
}

class b2SeparationFunction {
   declare static e_points: number;
   declare static e_faceA: number;
   declare static e_faceB: number;
   declare m_proxyA: (b2DistanceProxy | null);
   declare m_proxyB: (b2DistanceProxy | null);
   declare m_type: number;
   declare m_localPoint: (b2Vec2 | null);
   declare m_axis: (b2Vec2 | null);

   constructor() {

      this.m_localPoint = new b2Vec2();
      this.m_axis = new b2Vec2();

   }
   Initialize(cache: (b2SimplexCache | null), proxyA: (b2DistanceProxy | null), transformA: (b2Transform | null), proxyB: (b2DistanceProxy | null), transformB: (b2Transform | null)): void {
      this.m_proxyA = proxyA;
      this.m_proxyB = proxyB;
      var count: number = parseInt(String(cache!.count));
      b2Settings.b2Assert(0 < count && count < 3);
      var localPointA: b2Vec2 | null | undefined | undefined;
      var localPointA1: (b2Vec2 | null) | undefined;
      var localPointA2: (b2Vec2 | null) | undefined;
      var localPointB: b2Vec2 | null | undefined | undefined;
      var localPointB1: (b2Vec2 | null) | undefined;
      var localPointB2: (b2Vec2 | null) | undefined;
      var pointAX: number = 0;
      var pointAY: number = 0;
      var pointBX: number = 0;
      var pointBY: number = 0;
      var normalX: number = 0;
      var normalY: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      var s: number = 0;
      var sgn: number = 0;
      if (count == 1) {
         this.m_type = b2SeparationFunction.e_points;
         localPointA = this.m_proxyA!.GetVertex(cache!.indexA![0]);
         localPointB = this.m_proxyB!.GetVertex(cache!.indexB![0]);
         tVec = localPointA;
         tMat = transformA!.R;
         pointAX = transformA!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointAY = transformA!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         tVec = localPointB;
         tMat = transformB!.R;
         pointBX = transformB!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointBY = transformB!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         this.m_axis!.x = pointBX - pointAX;
         this.m_axis!.y = pointBY - pointAY;
         this.m_axis!.Normalize();
      }
      else if (cache!.indexB![0] == cache!.indexB![1]) {
         this.m_type = b2SeparationFunction.e_faceA;
         localPointA1 = this.m_proxyA!.GetVertex(cache!.indexA![0]);
         localPointA2 = this.m_proxyA!.GetVertex(cache!.indexA![1]);
         localPointB = this.m_proxyB!.GetVertex(cache!.indexB![0]);
         this.m_localPoint!.x = 0.5 * (localPointA1!.x + localPointA2!.x);
         this.m_localPoint!.y = 0.5 * (localPointA1!.y + localPointA2!.y);
         this.m_axis = b2Math.CrossVF(b2Math.SubtractVV(localPointA2, localPointA1), 1.0);
         this.m_axis!.Normalize();
         tVec = this.m_axis;
         tMat = transformA!.R;
         normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
         normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
         tVec = this.m_localPoint;
         tMat = transformA!.R;
         pointAX = transformA!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointAY = transformA!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         tVec = localPointB;
         tMat = transformB!.R;
         pointBX = transformB!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointBY = transformB!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         s = (pointBX - pointAX) * normalX + (pointBY - pointAY) * normalY;
         if (s < 0.0) {
            this.m_axis!.NegativeSelf();
         }
      }
      else if (cache!.indexA![0] == cache!.indexA![0]) {
         this.m_type = b2SeparationFunction.e_faceB;
         localPointB1 = this.m_proxyB!.GetVertex(cache!.indexB![0]);
         localPointB2 = this.m_proxyB!.GetVertex(cache!.indexB![1]);
         localPointA = this.m_proxyA!.GetVertex(cache!.indexA![0]);
         this.m_localPoint!.x = 0.5 * (localPointB1!.x + localPointB2!.x);
         this.m_localPoint!.y = 0.5 * (localPointB1!.y + localPointB2!.y);
         this.m_axis = b2Math.CrossVF(b2Math.SubtractVV(localPointB2, localPointB1), 1.0);
         this.m_axis!.Normalize();
         tVec = this.m_axis;
         tMat = transformB!.R;
         normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
         normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
         tVec = this.m_localPoint;
         tMat = transformB!.R;
         pointBX = transformB!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointBY = transformB!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         tVec = localPointA;
         tMat = transformA!.R;
         pointAX = transformA!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         pointAY = transformA!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         s = (pointAX - pointBX) * normalX + (pointAY - pointBY) * normalY;
         if (s < 0.0) {
            this.m_axis!.NegativeSelf();
         }
      }
      else {
         localPointA1 = this.m_proxyA!.GetVertex(cache!.indexA![0]);
         localPointA2 = this.m_proxyA!.GetVertex(cache!.indexA![1]);
         localPointB1 = this.m_proxyB!.GetVertex(cache!.indexB![0]);
         localPointB2 = this.m_proxyB!.GetVertex(cache!.indexB![1]);
         var pA: (b2Vec2 | null) = b2Math.MulX(transformA, localPointA!);
         var dA: (b2Vec2 | null) = b2Math.MulMV(transformA!.R, b2Math.SubtractVV(localPointA2, localPointA1));
         var pB: (b2Vec2 | null) = b2Math.MulX(transformB, localPointB!);
         var dB: (b2Vec2 | null) = b2Math.MulMV(transformB!.R, b2Math.SubtractVV(localPointB2, localPointB1));
         var a: number = dA!.x * dA!.x + dA!.y * dA!.y;
         var e: number = dB!.x * dB!.x + dB!.y * dB!.y;
         var r: (b2Vec2 | null) = b2Math.SubtractVV(dB, dA);
         var c: number = dA!.x * r!.x + dA!.y * r!.y;
         var f: number = dB!.x * r!.x + dB!.y * r!.y;
         var b: number = dA!.x * dB!.x + dA!.y * dB!.y;
         var denom: number = a * e - b * b;
         s = 0.0;
         if (denom != 0.0) {
            s = b2Math.Clamp((b * f - c * e) / denom, 0.0, 1.0);
         }
         var t: number = (b * s + f) / e;
         if (t < 0.0) {
            t = 0.0;
            s = b2Math.Clamp((b - c) / a, 0.0, 1.0);
         }
         localPointA = new b2Vec2();
         localPointA!.x = localPointA1!.x + s * (localPointA2!.x - localPointA1!.x);
         localPointA!.y = localPointA1!.y + s * (localPointA2!.y - localPointA1!.y);
         localPointB = new b2Vec2();
         localPointB!.x = localPointB1!.x + s * (localPointB2!.x - localPointB1!.x);
         localPointB!.y = localPointB1!.y + s * (localPointB2!.y - localPointB1!.y);
         if (s == 0.0 || s == 1.0) {
            this.m_type = b2SeparationFunction.e_faceB;
            this.m_axis = b2Math.CrossVF(b2Math.SubtractVV(localPointB2, localPointB1), 1.0);
            this.m_axis!.Normalize();
            this.m_localPoint = localPointB;
            tVec = this.m_axis;
            tMat = transformB!.R;
            normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tVec = this.m_localPoint;
            tMat = transformB!.R;
            pointBX = transformB!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            pointBY = transformB!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            tVec = localPointA;
            tMat = transformA!.R;
            pointAX = transformA!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            pointAY = transformA!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            sgn = (pointAX - pointBX) * normalX + (pointAY - pointBY) * normalY;
            if (s < 0.0) {
               this.m_axis!.NegativeSelf();
            }
         }
         else {
            this.m_type = b2SeparationFunction.e_faceA;
            this.m_axis = b2Math.CrossVF(b2Math.SubtractVV(localPointA2, localPointA1), 1.0);
            this.m_localPoint = localPointA;
            tVec = this.m_axis;
            tMat = transformA!.R;
            normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tVec = this.m_localPoint;
            tMat = transformA!.R;
            pointAX = transformA!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            pointAY = transformA!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            tVec = localPointB;
            tMat = transformB!.R;
            pointBX = transformB!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            pointBY = transformB!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            sgn = (pointBX - pointAX) * normalX + (pointBY - pointAY) * normalY;
            if (s < 0.0) {
               this.m_axis!.NegativeSelf();
            }
         }
      }
   }
   Evaluate(transformA: (b2Transform | null), transformB: (b2Transform | null)): number {
      var axisA: (b2Vec2 | null) | undefined;
      var axisB: (b2Vec2 | null) | undefined;
      var localPointA: (b2Vec2 | null) | undefined;
      var localPointB: (b2Vec2 | null) | undefined;
      var pointA: (b2Vec2 | null) | undefined;
      var pointB: (b2Vec2 | null) | undefined;
      var seperation: number = 0;
      var normal: (b2Vec2 | null) | undefined;
      switch (this.m_type) {
      case b2SeparationFunction.e_points:
         {
            axisA = b2Math.MulTMV(transformA!.R, this.m_axis);
            axisB = b2Math.MulTMV(transformB!.R, this.m_axis!.GetNegative());
            localPointA = this.m_proxyA!.GetSupportVertex(axisA);
            localPointB = this.m_proxyB!.GetSupportVertex(axisB);
            pointA = b2Math.MulX(transformA, localPointA);
            pointB = b2Math.MulX(transformB, localPointB);
            seperation = (pointB!.x - pointA!.x) * this.m_axis!.x + (pointB!.y - pointA!.y) * this.m_axis!.y;
            return seperation;
         }
      case b2SeparationFunction.e_faceA:
         {
            normal = b2Math.MulMV(transformA!.R, this.m_axis);
            pointA = b2Math.MulX(transformA, this.m_localPoint);
            axisB = b2Math.MulTMV(transformB!.R, normal!.GetNegative());
            localPointB = this.m_proxyB!.GetSupportVertex(axisB);
            pointB = b2Math.MulX(transformB, localPointB);
            seperation = (pointB!.x - pointA!.x) * normal!.x + (pointB!.y - pointA!.y) * normal!.y;
            return seperation;
         }
      case b2SeparationFunction.e_faceB:
         {
            normal = b2Math.MulMV(transformB!.R, this.m_axis);
            pointB = b2Math.MulX(transformB, this.m_localPoint);
            axisA = b2Math.MulTMV(transformA!.R, normal!.GetNegative());
            localPointA = this.m_proxyA!.GetSupportVertex(axisA);
            pointA = b2Math.MulX(transformA, localPointA);
            seperation = (pointA!.x - pointB!.x) * normal!.x + (pointA!.y - pointB!.y) * normal!.y;
            return seperation;
         }
      default:
         b2Settings.b2Assert(false);
         return 0.0;
      }
   }
}

class b2Simplex {
   declare m_v1: (b2SimplexVertex | null);
   declare m_v2: (b2SimplexVertex | null);
   declare m_v3: (b2SimplexVertex | null);
   declare m_vertices: Array<(b2SimplexVertex | null)>;
   declare m_count: number;

   constructor() {

      this.m_v1 = new b2SimplexVertex();
      this.m_v2 = new b2SimplexVertex();
      this.m_v3 = new b2SimplexVertex();
      this.m_vertices = new Array<(b2SimplexVertex | null)>(3);

      if (new.target === b2Simplex) this.b2Simplex();
   }
   b2Simplex(): void {
      this.m_vertices![0] = this.m_v1;
      this.m_vertices![1] = this.m_v2;
      this.m_vertices![2] = this.m_v3;
   }
   ReadCache(cache: (b2SimplexCache | null), proxyA: (b2DistanceProxy | null), transformA: (b2Transform | null), proxyB: (b2DistanceProxy | null), transformB: (b2Transform | null)): void {
      b2Settings.b2Assert(0 <= cache!.count && cache!.count <= 3);
      var wALocal: (b2Vec2 | null) | undefined;
      var wBLocal: (b2Vec2 | null) | undefined;
      this.m_count = cache!.count;
      var vertices: Array<(b2SimplexVertex | null)> = this.m_vertices;
      for (var i: number = 0; i < this.m_count; i++) {
         var v: (b2SimplexVertex | null) = vertices![i];
         v!.indexA = cache!.indexA![i];
         v!.indexB = cache!.indexB![i];
         wALocal = proxyA!.GetVertex(v!.indexA);
         wBLocal = proxyB!.GetVertex(v!.indexB);
         v!.wA = b2Math.MulX(transformA, wALocal);
         v!.wB = b2Math.MulX(transformB, wBLocal);
         v!.w = b2Math.SubtractVV(v!.wB, v!.wA);
         v!.a = 0;
      }
      if (this.m_count > 1) {
         var metric1: number = cache!.metric;
         var metric2: number = this.GetMetric();
         if (metric2 < .5 * metric1 || 2.0 * metric1 < metric2 || metric2 < Number.MIN_VALUE) {
            this.m_count = 0;
         }
      }
      if (this.m_count == 0) {
         v = vertices![0];
         v!.indexA = 0;
         v!.indexB = 0;
         wALocal = proxyA!.GetVertex(0);
         wBLocal = proxyB!.GetVertex(0);
         v!.wA = b2Math.MulX(transformA, wALocal);
         v!.wB = b2Math.MulX(transformB, wBLocal);
         v!.w = b2Math.SubtractVV(v!.wB, v!.wA);
         this.m_count = 1;
      }
   }
   WriteCache(cache: (b2SimplexCache | null)): void {
      cache!.metric = this.GetMetric();
      cache!.count = parseUInt(this.m_count);
      var vertices: Array<(b2SimplexVertex | null)> = this.m_vertices;
      for (var i: number = 0; i < this.m_count; i++) {
         cache!.indexA![i] = parseUInt(vertices![i]!.indexA);
         cache!.indexB![i] = parseUInt(vertices![i]!.indexB);
      }
   }
   GetSearchDirection(): (b2Vec2 | null) {
      switch (this.m_count) {
      case 1:
         return this.m_v1!.w!.GetNegative();
      case 2:
         {
            var e12: (b2Vec2 | null) = b2Math.SubtractVV(this.m_v2!.w, this.m_v1!.w);
            var sgn: number = b2Math.CrossVV(e12, this.m_v1!.w!.GetNegative());
            if (sgn > 0.0) {
               return b2Math.CrossFV(1.0, e12);
            }
            else {
               return b2Math.CrossVF(e12, 1.0);
            }
         }
      default:
         b2Settings.b2Assert(false);
         return new b2Vec2();
      }
   }
   GetClosestPoint(): (b2Vec2 | null) {
      switch (this.m_count) {
      case 0:
         b2Settings.b2Assert(false);
         return new b2Vec2();
      case 1:
         return this.m_v1!.w;
      case 2:
         return new b2Vec2(this.m_v1!.a * this.m_v1!.w!.x + this.m_v2!.a * this.m_v2!.w!.x, this.m_v1!.a * this.m_v1!.w!.y + this.m_v2!.a * this.m_v2!.w!.y);
      default:
         b2Settings.b2Assert(false);
         return new b2Vec2();
      }
   }
   GetWitnessPoints(pA: (b2Vec2 | null), pB: (b2Vec2 | null)): void {
      switch (this.m_count) {
      case 0:
         b2Settings.b2Assert(false);
         break;
      case 1:
         pA!.SetV(this.m_v1!.wA);
         pB!.SetV(this.m_v1!.wB);
         break;
      case 2:
         pA!.x = this.m_v1!.a * this.m_v1!.wA!.x + this.m_v2!.a * this.m_v2!.wA!.x;
         pA!.y = this.m_v1!.a * this.m_v1!.wA!.y + this.m_v2!.a * this.m_v2!.wA!.y;
         pB!.x = this.m_v1!.a * this.m_v1!.wB!.x + this.m_v2!.a * this.m_v2!.wB!.x;
         pB!.y = this.m_v1!.a * this.m_v1!.wB!.y + this.m_v2!.a * this.m_v2!.wB!.y;
         break;
      case 3:
         pB!.x = pA!.x = this.m_v1!.a * this.m_v1!.wA!.x + this.m_v2!.a * this.m_v2!.wA!.x + this.m_v3!.a * this.m_v3!.wA!.x;
         pB!.y = pA!.y = this.m_v1!.a * this.m_v1!.wA!.y + this.m_v2!.a * this.m_v2!.wA!.y + this.m_v3!.a * this.m_v3!.wA!.y;
         break;
      default:
         b2Settings.b2Assert(false);
         break;
      }
   }
   GetMetric(): number {
      switch (this.m_count) {
      case 0:
         b2Settings.b2Assert(false);
         return 0.0;
      case 1:
         return 0.0;
      case 2:
         return b2Math.SubtractVV(this.m_v1!.w, this.m_v2!.w)!.Length();
      case 3:
         return b2Math.CrossVV(b2Math.SubtractVV(this.m_v2!.w, this.m_v1!.w), b2Math.SubtractVV(this.m_v3!.w, this.m_v1!.w));
      default:
         b2Settings.b2Assert(false);
         return 0.0;
      }
   }
   Solve2(): void {
      var w1: (b2Vec2 | null) = this.m_v1!.w;
      var w2: (b2Vec2 | null) = this.m_v2!.w;
      var e12: (b2Vec2 | null) = b2Math.SubtractVV(w2, w1);
      var d12_2: number = (-(w1!.x * e12!.x + w1!.y * e12!.y));
      if (d12_2 <= 0.0) {
         this.m_v1!.a = 1.0;
         this.m_count = 1;
         return;
      }
      var d12_1: number = (w2!.x * e12!.x + w2!.y * e12!.y);
      if (d12_1 <= 0.0) {
         this.m_v2!.a = 1.0;
         this.m_count = 1;
         this.m_v1!.Set(this.m_v2);
         return;
      }
      var inv_d12: number = 1.0 / (d12_1 + d12_2);
      this.m_v1!.a = d12_1 * inv_d12;
      this.m_v2!.a = d12_2 * inv_d12;
      this.m_count = 2;
   }
   Solve3(): void {
      var w1: (b2Vec2 | null) = this.m_v1!.w;
      var w2: (b2Vec2 | null) = this.m_v2!.w;
      var w3: (b2Vec2 | null) = this.m_v3!.w;
      var e12: (b2Vec2 | null) = b2Math.SubtractVV(w2, w1);
      var w1e12: number = b2Math.Dot(w1, e12);
      var w2e12: number = b2Math.Dot(w2, e12);
      var d12_1: number = w2e12;
      var d12_2: number = (-w1e12);
      var e13: (b2Vec2 | null) = b2Math.SubtractVV(w3, w1);
      var w1e13: number = b2Math.Dot(w1, e13);
      var w3e13: number = b2Math.Dot(w3, e13);
      var d13_1: number = w3e13;
      var d13_2: number = (-w1e13);
      var e23: (b2Vec2 | null) = b2Math.SubtractVV(w3, w2);
      var w2e23: number = b2Math.Dot(w2, e23);
      var w3e23: number = b2Math.Dot(w3, e23);
      var d23_1: number = w3e23;
      var d23_2: number = (-w2e23);
      var n123: number = b2Math.CrossVV(e12, e13);
      var d123_1: number = n123 * b2Math.CrossVV(w2, w3);
      var d123_2: number = n123 * b2Math.CrossVV(w3, w1);
      var d123_3: number = n123 * b2Math.CrossVV(w1, w2);
      if (d12_2 <= 0.0 && d13_2 <= 0.0) {
         this.m_v1!.a = 1.0;
         this.m_count = 1;
         return;
      }
      if (d12_1 > 0.0 && d12_2 > 0.0 && d123_3 <= 0.0) {
         var inv_d12: number = 1.0 / (d12_1 + d12_2);
         this.m_v1!.a = d12_1 * inv_d12;
         this.m_v2!.a = d12_2 * inv_d12;
         this.m_count = 2;
         return;
      }
      if (d13_1 > 0.0 && d13_2 > 0.0 && d123_2 <= 0.0) {
         var inv_d13: number = 1.0 / (d13_1 + d13_2);
         this.m_v1!.a = d13_1 * inv_d13;
         this.m_v3!.a = d13_2 * inv_d13;
         this.m_count = 2;
         this.m_v2!.Set(this.m_v3);
         return;
      }
      if (d12_1 <= 0.0 && d23_2 <= 0.0) {
         this.m_v2!.a = 1.0;
         this.m_count = 1;
         this.m_v1!.Set(this.m_v2);
         return;
      }
      if (d13_1 <= 0.0 && d23_1 <= 0.0) {
         this.m_v3!.a = 1.0;
         this.m_count = 1;
         this.m_v1!.Set(this.m_v3);
         return;
      }
      if (d23_1 > 0.0 && d23_2 > 0.0 && d123_1 <= 0.0) {
         var inv_d23: number = 1.0 / (d23_1 + d23_2);
         this.m_v2!.a = d23_1 * inv_d23;
         this.m_v3!.a = d23_2 * inv_d23;
         this.m_count = 2;
         this.m_v1!.Set(this.m_v3);
         return;
      }
      var inv_d123: number = 1.0 / (d123_1 + d123_2 + d123_3);
      this.m_v1!.a = d123_1 * inv_d123;
      this.m_v2!.a = d123_2 * inv_d123;
      this.m_v3!.a = d123_3 * inv_d123;
      this.m_count = 3;
   }
}

class b2SimplexCache {
   declare metric: number;
   declare count: number;
   declare indexA: Array<number>;
   declare indexB: Array<number>;

   constructor() {

      this.indexA = numberVector(3);
      this.indexB = numberVector(3);

   }
}

class b2SimplexVertex {
   declare wA: (b2Vec2 | null);
   declare wB: (b2Vec2 | null);
   declare w: (b2Vec2 | null);
   declare a: number;
   declare indexA: number;
   declare indexB: number;

   constructor() {

   }
   Set(other: (b2SimplexVertex | null)): void {
      this.wA!.SetV(other!.wA);
      this.wB!.SetV(other!.wB);
      this.w!.SetV(other!.w);
      this.a = other!.a;
      this.indexA = other!.indexA;
      this.indexB = other!.indexB;
   }
}

class b2TimeOfImpact {
   declare static b2_toiCalls: number;
   declare static b2_toiIters: number;
   declare static b2_toiMaxIters: number;
   declare static b2_toiRootIters: number;
   declare static b2_toiMaxRootIters: number;
   declare static s_cache: (b2SimplexCache | null);
   declare static s_distanceInput: (b2DistanceInput | null);
   declare static s_xfA: (b2Transform | null);
   declare static s_xfB: (b2Transform | null);
   declare static s_fcn: (b2SeparationFunction | null);
   declare static s_distanceOutput: (b2DistanceOutput | null);

   constructor() {

   }
   static TimeOfImpact(input: (b2TOIInput | null)): number {
      ++b2TimeOfImpact.b2_toiCalls;
      var proxyA: (b2DistanceProxy | null) = input!.proxyA;
      var proxyB: (b2DistanceProxy | null) = input!.proxyB;
      var sweepA: (b2Sweep | null) = input!.sweepA;
      var sweepB: (b2Sweep | null) = input!.sweepB;
      b2Settings.b2Assert(sweepA!.t0 == sweepB!.t0);
      b2Settings.b2Assert(1.0 - sweepA!.t0 > Number.MIN_VALUE);
      var radius: number = proxyA!.m_radius + proxyB!.m_radius;
      var tolerance: number = input!.tolerance;
      var alpha: number = 0.0;
      var k_maxIterations: number = 1000;
      var iter: number = 0;
      var target: number = 0.0;
      b2TimeOfImpact.s_cache!.count = 0;
      b2TimeOfImpact.s_distanceInput!.useRadii = false;
      for (;;) {
         sweepA!.GetTransform(b2TimeOfImpact.s_xfA, alpha);
         sweepB!.GetTransform(b2TimeOfImpact.s_xfB, alpha);
         b2TimeOfImpact.s_distanceInput!.proxyA = proxyA;
         b2TimeOfImpact.s_distanceInput!.proxyB = proxyB;
         b2TimeOfImpact.s_distanceInput!.transformA = b2TimeOfImpact.s_xfA;
         b2TimeOfImpact.s_distanceInput!.transformB = b2TimeOfImpact.s_xfB;
         b2Distance.Distance(b2TimeOfImpact.s_distanceOutput, b2TimeOfImpact.s_cache, b2TimeOfImpact.s_distanceInput);
         if (b2TimeOfImpact.s_distanceOutput!.distance <= 0.0) {
            alpha = 1.0;
            break;
         }
         b2TimeOfImpact.s_fcn!.Initialize(b2TimeOfImpact.s_cache, proxyA, b2TimeOfImpact.s_xfA, proxyB, b2TimeOfImpact.s_xfB);
         var separation: number = b2TimeOfImpact.s_fcn!.Evaluate(b2TimeOfImpact.s_xfA, b2TimeOfImpact.s_xfB);
         if (separation <= 0.0) {
            alpha = 1.0;
            break;
         }
         if (iter == 0) {
            if (separation > radius) {
               target = b2Math.Max(radius - tolerance, 0.75 * radius);
            }
            else {
               target = b2Math.Max(separation - tolerance, 0.02 * radius);
            }
         }
         if (separation - target < 0.5 * tolerance) {
            if (iter == 0) {
               alpha = 1.0;
               break;
            }
            break;
         }
         var newAlpha: number = alpha; {
            var x1: number = alpha;
            var x2: number = 1.0;
            var f1: number = separation;
            sweepA!.GetTransform(b2TimeOfImpact.s_xfA, x2);
            sweepB!.GetTransform(b2TimeOfImpact.s_xfB, x2);
            var f2: number = b2TimeOfImpact.s_fcn!.Evaluate(b2TimeOfImpact.s_xfA, b2TimeOfImpact.s_xfB);
            if (f2 >= target) {
               alpha = 1.0;
               break;
            }
            var rootIterCount: number = 0;
            for (;;) {
               var x: number = 0;
               if (rootIterCount & 1) {
                  x = x1 + (target - f1) * (x2 - x1) / (f2 - f1);
               }
               else {
                  x = 0.5 * (x1 + x2);
               }
               sweepA!.GetTransform(b2TimeOfImpact.s_xfA, x);
               sweepB!.GetTransform(b2TimeOfImpact.s_xfB, x);
               var f: number = b2TimeOfImpact.s_fcn!.Evaluate(b2TimeOfImpact.s_xfA, b2TimeOfImpact.s_xfB);
               if (b2Math.Abs(f - target) < 0.025 * tolerance) {
                  newAlpha = x;
                  break;
               }
               if (f > target) {
                  x1 = x;
                  f1 = f;
               }
               else {
                  x2 = x;
                  f2 = f;
               }++rootIterCount;
               ++b2TimeOfImpact.b2_toiRootIters;
               if (rootIterCount == 50) {
                  break;
               }
            }
            b2TimeOfImpact.b2_toiMaxRootIters = b2Math.Max(b2TimeOfImpact.b2_toiMaxRootIters, rootIterCount);
         }
         if (newAlpha < (1.0 + 100.0 * Number.MIN_VALUE) * alpha) {
            break;
         }
         alpha = newAlpha;
         iter++;
         ++b2TimeOfImpact.b2_toiIters;
         if (iter == k_maxIterations) {
            break;
         }
      }
      b2TimeOfImpact.b2_toiMaxIters = b2Math.Max(b2TimeOfImpact.b2_toiMaxIters, iter);
      return alpha;
   }
}

class b2TOIInput {
   declare proxyA: (b2DistanceProxy | null);
   declare proxyB: (b2DistanceProxy | null);
   declare sweepA: (b2Sweep | null);
   declare sweepB: (b2Sweep | null);
   declare tolerance: number;

   constructor() {

      this.proxyA = new b2DistanceProxy();
      this.proxyB = new b2DistanceProxy();
      this.sweepA = new b2Sweep();
      this.sweepB = new b2Sweep();

   }
}

class b2WorldManifold {
   declare m_normal: (b2Vec2 | null);
   declare m_points: Array<(b2Vec2 | null)>;

   constructor() {

      this.m_normal = new b2Vec2();

      if (new.target === b2WorldManifold) this.b2WorldManifold();
   }
   b2WorldManifold(): void {
      this.m_points = new Array<(b2Vec2 | null)>(b2Settings.b2_maxManifoldPoints);
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         this.m_points![i] = new b2Vec2();
      }
   }
   Initialize(manifold: (b2Manifold | null), xfA: (b2Transform | null), radiusA: number, xfB: (b2Transform | null), radiusB: number): void {
      if (radiusA === undefined) radiusA = 0;
      if (radiusB === undefined) radiusB = 0;
      if (manifold!.m_pointCount == 0) {
         return;
      }
      var i: number = 0;
      var tVec: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) | undefined;
      var normalX: number = 0;
      var normalY: number = 0;
      var planePointX: number = 0;
      var planePointY: number = 0;
      var clipPointX: number = 0;
      var clipPointY: number = 0;
      switch (manifold!.m_type) {
      case b2Manifold.e_circles:
         {
            tMat = xfA!.R;
            tVec = manifold!.m_localPoint;
            var pointAX: number = xfA!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            var pointAY: number = xfA!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tMat = xfB!.R;
            tVec = manifold!.m_points![0]!.m_localPoint;
            var pointBX: number = xfB!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            var pointBY: number = xfB!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            var dX: number = pointBX - pointAX;
            var dY: number = pointBY - pointAY;
            var d2: number = dX * dX + dY * dY;
            if (d2 > Number.MIN_VALUE * Number.MIN_VALUE) {
               var d: number = Math.sqrt(d2);
               this.m_normal!.x = dX / d;
               this.m_normal!.y = dY / d;
            }
            else {
               this.m_normal!.x = 1;
               this.m_normal!.y = 0;
            }
            var cAX: number = pointAX + radiusA * this.m_normal!.x;
            var cAY: number = pointAY + radiusA * this.m_normal!.y;
            var cBX: number = pointBX - radiusB * this.m_normal!.x;
            var cBY: number = pointBY - radiusB * this.m_normal!.y;
            this.m_points![0]!.x = 0.5 * (cAX + cBX);
            this.m_points![0]!.y = 0.5 * (cAY + cBY);
         }
         break;
      case b2Manifold.e_faceA:
         {
            tMat = xfA!.R;
            tVec = manifold!.m_localPlaneNormal;
            normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tMat = xfA!.R;
            tVec = manifold!.m_localPoint;
            planePointX = xfA!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            planePointY = xfA!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            this.m_normal!.x = normalX;
            this.m_normal!.y = normalY;
            for (i = 0;
            i < manifold!.m_pointCount; i++) {
               tMat = xfB!.R;
               tVec = manifold!.m_points![i]!.m_localPoint;
               clipPointX = xfB!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
               clipPointY = xfB!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
               this.m_points![i]!.x = clipPointX + 0.5 * (radiusA - (clipPointX - planePointX) * normalX - (clipPointY - planePointY) * normalY - radiusB) * normalX;
               this.m_points![i]!.y = clipPointY + 0.5 * (radiusA - (clipPointX - planePointX) * normalX - (clipPointY - planePointY) * normalY - radiusB) * normalY;
            }
         }
         break;
      case b2Manifold.e_faceB:
         {
            tMat = xfB!.R;
            tVec = manifold!.m_localPlaneNormal;
            normalX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            normalY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tMat = xfB!.R;
            tVec = manifold!.m_localPoint;
            planePointX = xfB!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            planePointY = xfB!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            this.m_normal!.x = (-normalX);
            this.m_normal!.y = (-normalY);
            for (i = 0;
            i < manifold!.m_pointCount; i++) {
               tMat = xfA!.R;
               tVec = manifold!.m_points![i]!.m_localPoint;
               clipPointX = xfA!.position!.x + tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
               clipPointY = xfA!.position!.y + tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
               this.m_points![i]!.x = clipPointX + 0.5 * (radiusB - (clipPointX - planePointX) * normalX - (clipPointY - planePointY) * normalY - radiusA) * normalX;
               this.m_points![i]!.y = clipPointY + 0.5 * (radiusB - (clipPointX - planePointX) * normalX - (clipPointY - planePointY) * normalY - radiusA) * normalY;
            }
         }
         break;
      }
   }
}

class ClipVertex {
   declare v: (b2Vec2 | null);
   declare id: (b2ContactID | null);

   constructor() {

      this.v = new b2Vec2();
      this.id = new b2ContactID();

   }
   Set(other: (ClipVertex | null)): void {
      this.v!.SetV(other!.v);
      this.id!.Set(other!.id);
   }
}

class Features {
   declare _referenceEdge: number;
   declare _incidentEdge: number;
   declare _incidentVertex: number;
   declare _flip: number;
   declare _m_id: (b2ContactID | null);

   constructor() {

   }
   get referenceEdge(): number {
         return this._referenceEdge;
      }
   set referenceEdge(value: number) {
         if (value === undefined) value = 0;
         this._referenceEdge = value;
         this._m_id!._key = (this._m_id!._key & 0xffffff00) | (this._referenceEdge & 0x000000ff);
      }
   get incidentEdge(): number {
         return this._incidentEdge;
      }
   set incidentEdge(value: number) {
         if (value === undefined) value = 0;
         this._incidentEdge = value;
         this._m_id!._key = (this._m_id!._key & 0xffff00ff) | ((this._incidentEdge << 8) & 0x0000ff00);
      }
   get incidentVertex(): number {
         return this._incidentVertex;
      }
   set incidentVertex(value: number) {
         if (value === undefined) value = 0;
         this._incidentVertex = value;
         this._m_id!._key = (this._m_id!._key & 0xff00ffff) | ((this._incidentVertex << 16) & 0x00ff0000);
      }
   get flip(): number {
         return this._flip;
      }
   set flip(value: number) {
         if (value === undefined) value = 0;
         this._flip = value;
         this._m_id!._key = (this._m_id!._key & 0x00ffffff) | ((this._flip << 24) & 0xff000000);
      }
}

class b2Shape {
   declare m_type: number;
   declare m_radius: number;
   declare static e_unknownShape: number;
   declare static e_circleShape: number;
   declare static e_polygonShape: number;
   declare static e_edgeShape: number;
   declare static e_shapeTypeCount: number;
   declare static e_hitCollide: number;
   declare static e_missCollide: number;
   declare static e_startsInsideCollide: number;

   constructor() {

      if (new.target === b2Shape) this.b2Shape();
   }
   Copy(): (b2Shape | null) {
      return null;
   }
   Set(other: (b2Shape | null)): void {
      this.m_radius = other!.m_radius;
   }
   GetType(): number {
      return this.m_type;
   }
   TestPoint(xf: (b2Transform | null), p: (b2Vec2 | null)): boolean {
      return false;
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null), transform: (b2Transform | null)): boolean {
      return false;
   }
   ComputeAABB(aabb: (b2AABB | null), xf: (b2Transform | null)): void {}
   ComputeMass(massData: (b2MassData | null), density: number): void {
      if (density === undefined) density = 0;
   }
   ComputeSubmergedArea(normal: (b2Vec2 | null), offset: number, xf: (b2Transform | null), c: (b2Vec2 | null)): number {
      if (offset === undefined) offset = 0;
      return 0;
   }
   static TestOverlap(shape1: (b2Shape | null), transform1: (b2Transform | null), shape2: (b2Shape | null), transform2: (b2Transform | null)): boolean {
      var input: (b2DistanceInput | null) = new b2DistanceInput();
      input!.proxyA = new b2DistanceProxy();
      input!.proxyA!.Set(shape1);
      input!.proxyB = new b2DistanceProxy();
      input!.proxyB!.Set(shape2);
      input!.transformA = transform1;
      input!.transformB = transform2;
      input!.useRadii = true;
      var simplexCache: (b2SimplexCache | null) = new b2SimplexCache();
      simplexCache!.count = 0;
      var output: (b2DistanceOutput | null) = new b2DistanceOutput();
      b2Distance.Distance(output, simplexCache, input);
      return output!.distance < 10.0 * Number.MIN_VALUE;
   }
   b2Shape(): void {
      this.m_type = b2Shape.e_unknownShape;
      this.m_radius = b2Settings.b2_linearSlop;
   }
}

class b2CircleShape extends b2Shape {
   declare m_p: (b2Vec2 | null);

   constructor(radius?: number) {
      super();


      this.m_p = new b2Vec2();

      if (new.target === b2CircleShape) this.b2CircleShape(radius!);
   }
   Copy(): (b2Shape | null) {
      var s: (b2Shape | null) = new b2CircleShape();
      s!.Set(this);
      return s;
   }
   Set(other: (b2Shape | null)): void {
      super.Set(other);
      if ((other instanceof b2CircleShape)) {
         var other2: (b2CircleShape | null) = (other instanceof b2CircleShape ? (other) : null);
         this.m_p!.SetV(other2!.m_p);
      }
   }
   TestPoint(transform: (b2Transform | null), p: (b2Vec2 | null)): boolean {
      var tMat: (b2Mat22 | null) = transform!.R;
      var dX: number = transform!.position!.x + (tMat!.col1!.x * this.m_p!.x + tMat!.col2!.x * this.m_p!.y);
      var dY: number = transform!.position!.y + (tMat!.col1!.y * this.m_p!.x + tMat!.col2!.y * this.m_p!.y);
      dX = p!.x - dX;
      dY = p!.y - dY;
      return (dX * dX + dY * dY) <= this.m_radius * this.m_radius;
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null), transform: (b2Transform | null)): boolean {
      var tMat: (b2Mat22 | null) = transform!.R;
      var positionX: number = transform!.position!.x + (tMat!.col1!.x * this.m_p!.x + tMat!.col2!.x * this.m_p!.y);
      var positionY: number = transform!.position!.y + (tMat!.col1!.y * this.m_p!.x + tMat!.col2!.y * this.m_p!.y);
      var sX: number = input!.p1!.x - positionX;
      var sY: number = input!.p1!.y - positionY;
      var b: number = (sX * sX + sY * sY) - this.m_radius * this.m_radius;
      var rX: number = input!.p2!.x - input!.p1!.x;
      var rY: number = input!.p2!.y - input!.p1!.y;
      var c: number = (sX * rX + sY * rY);
      var rr: number = (rX * rX + rY * rY);
      var sigma: number = c * c - rr * b;
      if (sigma < 0.0 || rr < Number.MIN_VALUE) {
         return false;
      }
      var a: number = (-(c + Math.sqrt(sigma)));
      if (0.0 <= a && a <= input!.maxFraction * rr) {
         a /= rr;
         output!.fraction = a;
         output!.normal!.x = sX + a * rX;
         output!.normal!.y = sY + a * rY;
         output!.normal!.Normalize();
         return true;
      }
      return false;
   }
   ComputeAABB(aabb: (b2AABB | null), transform: (b2Transform | null)): void {
      var tMat: (b2Mat22 | null) = transform!.R;
      var pX: number = transform!.position!.x + (tMat!.col1!.x * this.m_p!.x + tMat!.col2!.x * this.m_p!.y);
      var pY: number = transform!.position!.y + (tMat!.col1!.y * this.m_p!.x + tMat!.col2!.y * this.m_p!.y);
      aabb!.lowerBound!.Set(pX - this.m_radius, pY - this.m_radius);
      aabb!.upperBound!.Set(pX + this.m_radius, pY + this.m_radius);
   }
   ComputeMass(massData: (b2MassData | null), density: number): void {
      if (density === undefined) density = 0;
      massData!.mass = density * b2Settings.b2_pi * this.m_radius * this.m_radius;
      massData!.center!.SetV(this.m_p);
      massData!.I = massData!.mass * (0.5 * this.m_radius * this.m_radius + (this.m_p!.x * this.m_p!.x + this.m_p!.y * this.m_p!.y));
   }
   ComputeSubmergedArea(normal: (b2Vec2 | null), offset: number, xf: (b2Transform | null), c: (b2Vec2 | null)): number {
      if (offset === undefined) offset = 0;
      var p: (b2Vec2 | null) = b2Math.MulX(xf, this.m_p);
      var l: number = (-(b2Math.Dot(normal, p) - offset));
      if (l < (-this.m_radius) + Number.MIN_VALUE) {
         return 0;
      }
      if (l > this.m_radius) {
         c!.SetV(p);
         return Math.PI * this.m_radius * this.m_radius;
      }
      var r2: number = this.m_radius * this.m_radius;
      var l2: number = l * l;
      var area: number = r2 * (Math.asin(l / this.m_radius) + Math.PI / 2) + l * Math.sqrt(r2 - l2);
      var com: number = (-2 / 3 * Math.pow(r2 - l2, 1.5) / area);
      c!.x = p!.x + normal!.x * com;
      c!.y = p!.y + normal!.y * com;
      return area;
   }
   GetLocalPosition(): (b2Vec2 | null) {
      return this.m_p;
   }
   SetLocalPosition(position: (b2Vec2 | null)): void {
      this.m_p!.SetV(position);
   }
   GetRadius(): number {
      return this.m_radius;
   }
   SetRadius(radius: number): void {
      if (radius === undefined) radius = 0;
      this.m_radius = radius;
   }
   b2CircleShape(radius: number = 0): void {
      if (radius === undefined) radius = 0;
      super.b2Shape();
      this.m_type = b2Shape.e_circleShape;
      this.m_radius = radius;
   }
}

class b2EdgeChainDef {
   declare vertices: Array<b2Vec2 | null>;
   declare vertexCount: number;
   declare isALoop: boolean;

   constructor() {

      if (new.target === b2EdgeChainDef) this.b2EdgeChainDef();
   }
   b2EdgeChainDef(): void {
      this.vertexCount = 0;
      this.isALoop = true;
      this.vertices = [];
   }
}

class b2EdgeShape extends b2Shape {
   declare s_supportVec: (b2Vec2 | null);
   declare m_v1: (b2Vec2 | null);
   declare m_v2: (b2Vec2 | null);
   declare m_coreV1: (b2Vec2 | null);
   declare m_coreV2: (b2Vec2 | null);
   declare m_length: number;
   declare m_normal: (b2Vec2 | null);
   declare m_direction: (b2Vec2 | null);
   declare m_cornerDir1: (b2Vec2 | null);
   declare m_cornerDir2: (b2Vec2 | null);
   declare m_cornerConvex1: boolean;
   declare m_cornerConvex2: boolean;
   declare m_nextEdge: (b2EdgeShape | null);
   declare m_prevEdge: (b2EdgeShape | null);

   constructor(v1?: (b2Vec2 | null), v2?: (b2Vec2 | null)) {
      super();


      this.s_supportVec = new b2Vec2();
      this.m_v1 = new b2Vec2();
      this.m_v2 = new b2Vec2();
      this.m_coreV1 = new b2Vec2();
      this.m_coreV2 = new b2Vec2();
      this.m_normal = new b2Vec2();
      this.m_direction = new b2Vec2();
      this.m_cornerDir1 = new b2Vec2();
      this.m_cornerDir2 = new b2Vec2();

      if (new.target === b2EdgeShape) this.b2EdgeShape(v1!, v2!);
   }
   TestPoint(transform: (b2Transform | null), p: (b2Vec2 | null)): boolean {
      return false;
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null), transform: (b2Transform | null)): boolean {
      var tMat: (b2Mat22 | null) | undefined;
      var rX: number = input!.p2!.x - input!.p1!.x;
      var rY: number = input!.p2!.y - input!.p1!.y;
      tMat = transform!.R;
      var v1X: number = transform!.position!.x + (tMat!.col1!.x * this.m_v1!.x + tMat!.col2!.x * this.m_v1!.y);
      var v1Y: number = transform!.position!.y + (tMat!.col1!.y * this.m_v1!.x + tMat!.col2!.y * this.m_v1!.y);
      var nX: number = transform!.position!.y + (tMat!.col1!.y * this.m_v2!.x + tMat!.col2!.y * this.m_v2!.y) - v1Y;
      var nY: number = (-(transform!.position!.x + (tMat!.col1!.x * this.m_v2!.x + tMat!.col2!.x * this.m_v2!.y) - v1X));
      var k_slop: number = 100.0 * Number.MIN_VALUE;
      var denom: number = (-(rX * nX + rY * nY));
      if (denom > k_slop) {
         var bX: number = input!.p1!.x - v1X;
         var bY: number = input!.p1!.y - v1Y;
         var a: number = (bX * nX + bY * nY);
         if (0.0 <= a && a <= input!.maxFraction * denom) {
            var mu2: number = (-rX * bY) + rY * bX;
            if ((-k_slop * denom) <= mu2 && mu2 <= denom * (1.0 + k_slop)) {
               a /= denom;
               output!.fraction = a;
               var nLen: number = Math.sqrt(nX * nX + nY * nY);
               output!.normal!.x = nX / nLen;
               output!.normal!.y = nY / nLen;
               return true;
            }
         }
      }
      return false;
   }
   ComputeAABB(aabb: (b2AABB | null), transform: (b2Transform | null)): void {
      var tMat: (b2Mat22 | null) = transform!.R;
      var v1X: number = transform!.position!.x + (tMat!.col1!.x * this.m_v1!.x + tMat!.col2!.x * this.m_v1!.y);
      var v1Y: number = transform!.position!.y + (tMat!.col1!.y * this.m_v1!.x + tMat!.col2!.y * this.m_v1!.y);
      var v2X: number = transform!.position!.x + (tMat!.col1!.x * this.m_v2!.x + tMat!.col2!.x * this.m_v2!.y);
      var v2Y: number = transform!.position!.y + (tMat!.col1!.y * this.m_v2!.x + tMat!.col2!.y * this.m_v2!.y);
      if (v1X < v2X) {
         aabb!.lowerBound!.x = v1X;
         aabb!.upperBound!.x = v2X;
      }
      else {
         aabb!.lowerBound!.x = v2X;
         aabb!.upperBound!.x = v1X;
      }
      if (v1Y < v2Y) {
         aabb!.lowerBound!.y = v1Y;
         aabb!.upperBound!.y = v2Y;
      }
      else {
         aabb!.lowerBound!.y = v2Y;
         aabb!.upperBound!.y = v1Y;
      }
   }
   ComputeMass(massData: (b2MassData | null), density: number): void {
      if (density === undefined) density = 0;
      massData!.mass = 0;
      massData!.center!.SetV(this.m_v1);
      massData!.I = 0;
   }
   ComputeSubmergedArea(normal: (b2Vec2 | null), offset: number, xf: (b2Transform | null), c: (b2Vec2 | null)): number {
      if (offset === undefined) offset = 0;
      var v0: (b2Vec2 | null) = new b2Vec2(normal!.x * offset, normal!.y * offset);
      var v1: (b2Vec2 | null) = b2Math.MulX(xf, this.m_v1);
      var v2: (b2Vec2 | null) = b2Math.MulX(xf, this.m_v2);
      var d1: number = b2Math.Dot(normal, v1) - offset;
      var d2: number = b2Math.Dot(normal, v2) - offset;
      if (d1 > 0) {
         if (d2 > 0) {
            return 0;
         }
         else {
            v1!.x = (-d2 / (d1 - d2) * v1!.x) + d1 / (d1 - d2) * v2!.x;
            v1!.y = (-d2 / (d1 - d2) * v1!.y) + d1 / (d1 - d2) * v2!.y;
         }
      }
      else {
         if (d2 > 0) {
            v2!.x = (-d2 / (d1 - d2) * v1!.x) + d1 / (d1 - d2) * v2!.x;
            v2!.y = (-d2 / (d1 - d2) * v1!.y) + d1 / (d1 - d2) * v2!.y;
         }
         else {}
      }
      c!.x = (v0!.x + v1!.x + v2!.x) / 3;
      c!.y = (v0!.y + v1!.y + v2!.y) / 3;
      return 0.5 * ((v1!.x - v0!.x) * (v2!.y - v0!.y) - (v1!.y - v0!.y) * (v2!.x - v0!.x));
   }
   GetLength(): number {
      return this.m_length;
   }
   GetVertex1(): (b2Vec2 | null) {
      return this.m_v1;
   }
   GetVertex2(): (b2Vec2 | null) {
      return this.m_v2;
   }
   GetCoreVertex1(): (b2Vec2 | null) {
      return this.m_coreV1;
   }
   GetCoreVertex2(): (b2Vec2 | null) {
      return this.m_coreV2;
   }
   GetNormalVector(): (b2Vec2 | null) {
      return this.m_normal;
   }
   GetDirectionVector(): (b2Vec2 | null) {
      return this.m_direction;
   }
   GetCorner1Vector(): (b2Vec2 | null) {
      return this.m_cornerDir1;
   }
   GetCorner2Vector(): (b2Vec2 | null) {
      return this.m_cornerDir2;
   }
   Corner1IsConvex(): boolean {
      return this.m_cornerConvex1;
   }
   Corner2IsConvex(): boolean {
      return this.m_cornerConvex2;
   }
   GetFirstVertex(xf: (b2Transform | null)): (b2Vec2 | null) {
      var tMat: (b2Mat22 | null) = xf!.R;
      return new b2Vec2(xf!.position!.x + (tMat!.col1!.x * this.m_coreV1!.x + tMat!.col2!.x * this.m_coreV1!.y), xf!.position!.y + (tMat!.col1!.y * this.m_coreV1!.x + tMat!.col2!.y * this.m_coreV1!.y));
   }
   GetNextEdge(): (b2EdgeShape | null) {
      return this.m_nextEdge;
   }
   GetPrevEdge(): (b2EdgeShape | null) {
      return this.m_prevEdge;
   }
   Support(xf: (b2Transform | null), dX: number, dY: number): (b2Vec2 | null) {
      if (dX === undefined) dX = 0;
      if (dY === undefined) dY = 0;
      var tMat: (b2Mat22 | null) = xf!.R;
      var v1X: number = xf!.position!.x + (tMat!.col1!.x * this.m_coreV1!.x + tMat!.col2!.x * this.m_coreV1!.y);
      var v1Y: number = xf!.position!.y + (tMat!.col1!.y * this.m_coreV1!.x + tMat!.col2!.y * this.m_coreV1!.y);
      var v2X: number = xf!.position!.x + (tMat!.col1!.x * this.m_coreV2!.x + tMat!.col2!.x * this.m_coreV2!.y);
      var v2Y: number = xf!.position!.y + (tMat!.col1!.y * this.m_coreV2!.x + tMat!.col2!.y * this.m_coreV2!.y);
      if ((v1X * dX + v1Y * dY) > (v2X * dX + v2Y * dY)) {
         this.s_supportVec!.x = v1X;
         this.s_supportVec!.y = v1Y;
      }
      else {
         this.s_supportVec!.x = v2X;
         this.s_supportVec!.y = v2Y;
      }
      return this.s_supportVec;
   }
   b2EdgeShape(v1: (b2Vec2 | null), v2: (b2Vec2 | null)): void {
      super.b2Shape();
      this.m_type = b2Shape.e_edgeShape;
      this.m_prevEdge = null;
      this.m_nextEdge = null;
      this.m_v1 = v1;
      this.m_v2 = v2;
      this.m_direction!.Set(this.m_v2!.x - this.m_v1!.x, this.m_v2!.y - this.m_v1!.y);
      this.m_length = this.m_direction!.Normalize();
      this.m_normal!.Set(this.m_direction!.y, (-this.m_direction!.x));
      this.m_coreV1!.Set((-b2Settings.b2_toiSlop * (this.m_normal!.x - this.m_direction!.x)) + this.m_v1!.x, (-b2Settings.b2_toiSlop * (this.m_normal!.y - this.m_direction!.y)) + this.m_v1!.y);
      this.m_coreV2!.Set((-b2Settings.b2_toiSlop * (this.m_normal!.x + this.m_direction!.x)) + this.m_v2!.x, (-b2Settings.b2_toiSlop * (this.m_normal!.y + this.m_direction!.y)) + this.m_v2!.y);
      this.m_cornerDir1 = this.m_normal;
      this.m_cornerDir2!.Set((-this.m_normal!.x), (-this.m_normal!.y));
   }
   SetPrevEdge(edge: (b2EdgeShape | null), core: (b2Vec2 | null), cornerDir: (b2Vec2 | null), convex: boolean): void {
      this.m_prevEdge = edge;
      this.m_coreV1 = core;
      this.m_cornerDir1 = cornerDir;
      this.m_cornerConvex1 = convex;
   }
   SetNextEdge(edge: (b2EdgeShape | null), core: (b2Vec2 | null), cornerDir: (b2Vec2 | null), convex: boolean): void {
      this.m_nextEdge = edge;
      this.m_coreV2 = core;
      this.m_cornerDir2 = cornerDir;
      this.m_cornerConvex2 = convex;
   }
}

class b2MassData {
   declare mass: number;
   declare center: (b2Vec2 | null);
   declare I: number;

   constructor() {

      this.mass = 0.0;
      this.center = new b2Vec2(0, 0);
      this.I = 0.0;

   }
}

class b2PolygonShape extends b2Shape {
   declare static s_mat: (b2Mat22 | null);
   declare m_centroid: (b2Vec2 | null);
   declare m_vertices: Array<(b2Vec2 | null)>;
   declare m_normals: Array<(b2Vec2 | null)>;
   declare m_vertexCount: number;

   constructor() {
      super();



      if (new.target === b2PolygonShape) this.b2PolygonShape();
   }
   Copy(): (b2Shape | null) {
      var s: (b2PolygonShape | null) = new b2PolygonShape();
      s!.Set(this);
      return s;
   }
   Set(other: (b2Shape | null)): void {
      super.Set(other);
      if ((other instanceof b2PolygonShape)) {
         var other2: (b2PolygonShape | null) = (other instanceof b2PolygonShape ? (other) : null);
         this.m_centroid!.SetV(other2!.m_centroid);
         this.m_vertexCount = other2!.m_vertexCount;
         this.Reserve(this.m_vertexCount);
         for (var i: number = 0; i < this.m_vertexCount; i++) {
            this.m_vertices![i]!.SetV(other2!.m_vertices![i]);
            this.m_normals![i]!.SetV(other2!.m_normals![i]);
         }
      }
   }
   SetAsArray(vertices: Array<b2Vec2 | null>, vertexCount: number = 0): void {
      if (vertexCount === undefined) vertexCount = 0;
      var v: Array<(b2Vec2 | null)> = new Array<(b2Vec2 | null)>();
      var i: number = 0,
         tVec: (b2Vec2 | null) | undefined;
      for (i = 0;
      i < vertices!.length; ++i) {
         tVec = vertices![i];
         v!.push(tVec);
      }
      this.SetAsVector(v, vertexCount);
   }
   static AsArray(vertices: Array<b2Vec2 | null>, vertexCount: number): (b2PolygonShape | null) {
      if (vertexCount === undefined) vertexCount = 0;
      var polygonShape: (b2PolygonShape | null) = new b2PolygonShape();
      polygonShape!.SetAsArray(vertices, vertexCount);
      return polygonShape;
   }
   SetAsVector(vertices: Array<(b2Vec2 | null)>, vertexCount: number = 0): void {
      if (vertexCount === undefined) vertexCount = 0;
      if (vertexCount == 0) vertexCount = vertices!.length;
      b2Settings.b2Assert(2 <= vertexCount);
      this.m_vertexCount = vertexCount;
      this.Reserve(vertexCount);
      var i: number = 0;
      for (i = 0;
      i < this.m_vertexCount; i++) {
         this.m_vertices![i]!.SetV(vertices![i]);
      }
      for (i = 0;
      i < this.m_vertexCount; ++i) {
         var i1: number = parseInt(String(i));
         var i2: number = parseInt(String(i + 1 < this.m_vertexCount ? i + 1 : 0));
         var edge: (b2Vec2 | null) = b2Math.SubtractVV(this.m_vertices![i2], this.m_vertices![i1]);
         b2Settings.b2Assert(edge!.LengthSquared() > Number.MIN_VALUE);
         this.m_normals![i]!.SetV(b2Math.CrossVF(edge, 1.0));
         this.m_normals![i]!.Normalize();
      }
      this.m_centroid = b2PolygonShape.ComputeCentroid(this.m_vertices, this.m_vertexCount);
   }
   static AsVector(vertices: Array<(b2Vec2 | null)>, vertexCount: number): (b2PolygonShape | null) {
      if (vertexCount === undefined) vertexCount = 0;
      var polygonShape: (b2PolygonShape | null) = new b2PolygonShape();
      polygonShape!.SetAsVector(vertices, vertexCount);
      return polygonShape;
   }
   SetAsBox(hx: number, hy: number): void {
      if (hx === undefined) hx = 0;
      if (hy === undefined) hy = 0;
      this.m_vertexCount = 4;
      this.Reserve(4);
      this.m_vertices![0]!.Set((-hx), (-hy));
      this.m_vertices![1]!.Set(hx, (-hy));
      this.m_vertices![2]!.Set(hx, hy);
      this.m_vertices![3]!.Set((-hx), hy);
      this.m_normals![0]!.Set(0.0, (-1.0));
      this.m_normals![1]!.Set(1.0, 0.0);
      this.m_normals![2]!.Set(0.0, 1.0);
      this.m_normals![3]!.Set((-1.0), 0.0);
      this.m_centroid!.SetZero();
   }
   static AsBox(hx: number, hy: number): (b2PolygonShape | null) {
      if (hx === undefined) hx = 0;
      if (hy === undefined) hy = 0;
      var polygonShape: (b2PolygonShape | null) = new b2PolygonShape();
      polygonShape!.SetAsBox(hx, hy);
      return polygonShape;
   }
   SetAsOrientedBox(hx: number, hy: number, center: (b2Vec2 | null) = null, angle: number = 0.0): void {
      if (hx === undefined) hx = 0;
      if (hy === undefined) hy = 0;
      if (center === undefined) center = null;
      if (angle === undefined) angle = 0.0;
      this.m_vertexCount = 4;
      this.Reserve(4);
      this.m_vertices![0]!.Set((-hx), (-hy));
      this.m_vertices![1]!.Set(hx, (-hy));
      this.m_vertices![2]!.Set(hx, hy);
      this.m_vertices![3]!.Set((-hx), hy);
      this.m_normals![0]!.Set(0.0, (-1.0));
      this.m_normals![1]!.Set(1.0, 0.0);
      this.m_normals![2]!.Set(0.0, 1.0);
      this.m_normals![3]!.Set((-1.0), 0.0);
      this.m_centroid = center;
      var xf: (b2Transform | null) = new b2Transform();
      xf!.position = center;
      xf!.R!.Set(angle);
      for (var i: number = 0; i < this.m_vertexCount; ++i) {
         this.m_vertices![i] = b2Math.MulX(xf, this.m_vertices![i]);
         this.m_normals![i] = b2Math.MulMV(xf!.R, this.m_normals![i]);
      }
   }
   static AsOrientedBox(hx: number, hy: number, center: (b2Vec2 | null) = null, angle: number = 0.0): (b2PolygonShape | null) {
      if (hx === undefined) hx = 0;
      if (hy === undefined) hy = 0;
      if (center === undefined) center = null;
      if (angle === undefined) angle = 0.0;
      var polygonShape: (b2PolygonShape | null) = new b2PolygonShape();
      polygonShape!.SetAsOrientedBox(hx, hy, center, angle);
      return polygonShape;
   }
   SetAsEdge(v1: (b2Vec2 | null), v2: (b2Vec2 | null)): void {
      this.m_vertexCount = 2;
      this.Reserve(2);
      this.m_vertices![0]!.SetV(v1);
      this.m_vertices![1]!.SetV(v2);
      this.m_centroid!.x = 0.5 * (v1!.x + v2!.x);
      this.m_centroid!.y = 0.5 * (v1!.y + v2!.y);
      this.m_normals![0] = b2Math.CrossVF(b2Math.SubtractVV(v2, v1), 1.0);
      this.m_normals![0]!.Normalize();
      this.m_normals![1]!.x = (-this.m_normals![0]!.x);
      this.m_normals![1]!.y = (-this.m_normals![0]!.y);
   }
   static AsEdge(v1: (b2Vec2 | null), v2: (b2Vec2 | null)): (b2PolygonShape | null) {
      var polygonShape: (b2PolygonShape | null) = new b2PolygonShape();
      polygonShape!.SetAsEdge(v1, v2);
      return polygonShape;
   }
   TestPoint(xf: (b2Transform | null), p: (b2Vec2 | null)): boolean {
      var tVec: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) = xf!.R;
      var tX: number = p!.x - xf!.position!.x;
      var tY: number = p!.y - xf!.position!.y;
      var pLocalX: number = (tX * tMat!.col1!.x + tY * tMat!.col1!.y);
      var pLocalY: number = (tX * tMat!.col2!.x + tY * tMat!.col2!.y);
      for (var i: number = 0; i < this.m_vertexCount; ++i) {
         tVec = this.m_vertices![i];
         tX = pLocalX - tVec!.x;
         tY = pLocalY - tVec!.y;
         tVec = this.m_normals![i];
         var dot: number = (tVec!.x * tX + tVec!.y * tY);
         if (dot > 0.0) {
            return false;
         }
      }
      return true;
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null), transform: (b2Transform | null)): boolean {
      var lower: number = 0.0;
      var upper: number = input!.maxFraction;
      var tX: number = 0;
      var tY: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      tX = input!.p1!.x - transform!.position!.x;
      tY = input!.p1!.y - transform!.position!.y;
      tMat = transform!.R;
      var p1X: number = (tX * tMat!.col1!.x + tY * tMat!.col1!.y);
      var p1Y: number = (tX * tMat!.col2!.x + tY * tMat!.col2!.y);
      tX = input!.p2!.x - transform!.position!.x;
      tY = input!.p2!.y - transform!.position!.y;
      tMat = transform!.R;
      var p2X: number = (tX * tMat!.col1!.x + tY * tMat!.col1!.y);
      var p2Y: number = (tX * tMat!.col2!.x + tY * tMat!.col2!.y);
      var dX: number = p2X - p1X;
      var dY: number = p2Y - p1Y;
      var index: number = parseInt((String(-1)));
      for (var i: number = 0; i < this.m_vertexCount; ++i) {
         tVec = this.m_vertices![i];
         tX = tVec!.x - p1X;
         tY = tVec!.y - p1Y;
         tVec = this.m_normals![i];
         var numerator: number = (tVec!.x * tX + tVec!.y * tY);
         var denominator: number = (tVec!.x * dX + tVec!.y * dY);
         if (denominator == 0.0) {
            if (numerator < 0.0) {
               return false;
            }
         }
         else {
            if (denominator < 0.0 && numerator < lower * denominator) {
               lower = numerator / denominator;
               index = i;
            }
            else if (denominator > 0.0 && numerator < upper * denominator) {
               upper = numerator / denominator;
            }
         }
         if (upper < lower - Number.MIN_VALUE) {
            return false;
         }
      }
      if (index >= 0) {
         output!.fraction = lower;
         tMat = transform!.R;
         tVec = this.m_normals![index];
         output!.normal!.x = (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         output!.normal!.y = (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         return true;
      }
      return false;
   }
   ComputeAABB(aabb: (b2AABB | null), xf: (b2Transform | null)): void {
      var tMat: (b2Mat22 | null) = xf!.R;
      var tVec: (b2Vec2 | null) = this.m_vertices![0];
      var lowerX: number = xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      var lowerY: number = xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      var upperX: number = lowerX;
      var upperY: number = lowerY;
      for (var i: number = 1; i < this.m_vertexCount; ++i) {
         tVec = this.m_vertices![i];
         var vX: number = xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
         var vY: number = xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
         lowerX = lowerX < vX ? lowerX : vX;
         lowerY = lowerY < vY ? lowerY : vY;
         upperX = upperX > vX ? upperX : vX;
         upperY = upperY > vY ? upperY : vY;
      }
      aabb!.lowerBound!.x = lowerX - this.m_radius;
      aabb!.lowerBound!.y = lowerY - this.m_radius;
      aabb!.upperBound!.x = upperX + this.m_radius;
      aabb!.upperBound!.y = upperY + this.m_radius;
   }
   ComputeMass(massData: (b2MassData | null), density: number): void {
      if (density === undefined) density = 0;
      if (this.m_vertexCount == 2) {
         massData!.center!.x = 0.5 * (this.m_vertices![0]!.x + this.m_vertices![1]!.x);
         massData!.center!.y = 0.5 * (this.m_vertices![0]!.y + this.m_vertices![1]!.y);
         massData!.mass = 0.0;
         massData!.I = 0.0;
         return;
      }
      var centerX: number = 0.0;
      var centerY: number = 0.0;
      var area: number = 0.0;
      var I: number = 0.0;
      var p1X: number = 0.0;
      var p1Y: number = 0.0;
      var k_inv3: number = 1.0 / 3.0;
      for (var i: number = 0; i < this.m_vertexCount; ++i) {
         var p2: (b2Vec2 | null) = this.m_vertices![i];
         var p3: (b2Vec2 | null) = i + 1 < this.m_vertexCount ? this.m_vertices![parseInt(String(i + 1))] : this.m_vertices![0];
         var e1X: number = p2!.x - p1X;
         var e1Y: number = p2!.y - p1Y;
         var e2X: number = p3!.x - p1X;
         var e2Y: number = p3!.y - p1Y;
         var D: number = e1X * e2Y - e1Y * e2X;
         var triangleArea: number = 0.5 * D;area += triangleArea;
         centerX += triangleArea * k_inv3 * (p1X + p2!.x + p3!.x);
         centerY += triangleArea * k_inv3 * (p1Y + p2!.y + p3!.y);
         var px: number = p1X;
         var py: number = p1Y;
         var ex1: number = e1X;
         var ey1: number = e1Y;
         var ex2: number = e2X;
         var ey2: number = e2Y;
         var intx2: number = k_inv3 * (0.25 * (ex1 * ex1 + ex2 * ex1 + ex2 * ex2) + (px * ex1 + px * ex2)) + 0.5 * px * px;
         var inty2: number = k_inv3 * (0.25 * (ey1 * ey1 + ey2 * ey1 + ey2 * ey2) + (py * ey1 + py * ey2)) + 0.5 * py * py;I += D * (intx2 + inty2);
      }
      massData!.mass = density * area;
      centerX *= 1.0 / area;
      centerY *= 1.0 / area;
      massData!.center!.Set(centerX, centerY);
      massData!.I = density * I;
   }
   ComputeSubmergedArea(normal: (b2Vec2 | null), offset: number, xf: (b2Transform | null), c: (b2Vec2 | null)): number {
      if (offset === undefined) offset = 0;
      var normalL: (b2Vec2 | null) = b2Math.MulTMV(xf!.R, normal);
      var offsetL: number = offset - b2Math.Dot(normal, xf!.position);
      var depths: Array<number> = numberVector();
      var diveCount: number = 0;
      var intoIndex: number = parseInt((String(-1)));
      var outoIndex: number = parseInt((String(-1)));
      var lastSubmerged: boolean = false;
      var i: number = 0;
      for (i = 0;
      i < this.m_vertexCount; ++i) {
         depths![i] = b2Math.Dot(normalL, this.m_vertices![i]) - offsetL;
         var isSubmerged: boolean = depths![i] < (-Number.MIN_VALUE);
         if (i > 0) {
            if (isSubmerged) {
               if (!lastSubmerged) {
                  intoIndex = i - 1;
                  diveCount++;
               }
            }
            else {
               if (lastSubmerged) {
                  outoIndex = i - 1;
                  diveCount++;
               }
            }
         }
         lastSubmerged = isSubmerged;
      }
      switch (diveCount) {
      case 0:
         if (lastSubmerged) {
            var md: (b2MassData | null) = new b2MassData();
            this.ComputeMass(md, 1);
            c!.SetV(b2Math.MulX(xf, md!.center));
            return md!.mass;
         }
         else {
            return 0;
         }
         break;
      case 1:
         if (intoIndex == (-1)) {
            intoIndex = this.m_vertexCount - 1;
         }
         else {
            outoIndex = this.m_vertexCount - 1;
         }
         break;
      }
      var intoIndex2: number = parseInt(String((intoIndex + 1) % this.m_vertexCount));
      var outoIndex2: number = parseInt(String((outoIndex + 1) % this.m_vertexCount));
      var intoLamdda: number = (0 - depths![intoIndex]) / (depths![intoIndex2] - depths![intoIndex]);
      var outoLamdda: number = (0 - depths![outoIndex]) / (depths![outoIndex2] - depths![outoIndex]);
      var intoVec: (b2Vec2 | null) = new b2Vec2(this.m_vertices![intoIndex]!.x * (1 - intoLamdda) + this.m_vertices![intoIndex2]!.x * intoLamdda, this.m_vertices![intoIndex]!.y * (1 - intoLamdda) + this.m_vertices![intoIndex2]!.y * intoLamdda);
      var outoVec: (b2Vec2 | null) = new b2Vec2(this.m_vertices![outoIndex]!.x * (1 - outoLamdda) + this.m_vertices![outoIndex2]!.x * outoLamdda, this.m_vertices![outoIndex]!.y * (1 - outoLamdda) + this.m_vertices![outoIndex2]!.y * outoLamdda);
      var area: number = 0;
      var center: (b2Vec2 | null) = new b2Vec2();
      var p2: (b2Vec2 | null) = this.m_vertices![intoIndex2];
      var p3: (b2Vec2 | null) | undefined;
      i = intoIndex2;
      while (i != outoIndex2) {
         i = (i + 1) % this.m_vertexCount;
         if (i == outoIndex2) p3 = outoVec;
         else p3 = this.m_vertices![i];
         var triangleArea: number = 0.5 * ((p2!.x - intoVec!.x) * (p3!.y - intoVec!.y) - (p2!.y - intoVec!.y) * (p3!.x - intoVec!.x));
         area += triangleArea;
         center!.x += triangleArea * (intoVec!.x + p2!.x + p3!.x) / 3;
         center!.y += triangleArea * (intoVec!.y + p2!.y + p3!.y) / 3;
         p2 = p3;
      }
      center!.Multiply(1 / area);
      c!.SetV(b2Math.MulX(xf, center));
      return area;
   }
   GetVertexCount(): number {
      return this.m_vertexCount;
   }
   GetVertices(): Array<(b2Vec2 | null)> {
      return this.m_vertices;
   }
   GetNormals(): Array<(b2Vec2 | null)> {
      return this.m_normals;
   }
   GetSupport(d: (b2Vec2 | null)): number {
      var bestIndex: number = 0;
      var bestValue: number = this.m_vertices![0]!.x * d!.x + this.m_vertices![0]!.y * d!.y;
      for (var i: number = 1; i < this.m_vertexCount; ++i) {
         var value: number = this.m_vertices![i]!.x * d!.x + this.m_vertices![i]!.y * d!.y;
         if (value > bestValue) {
            bestIndex = i;
            bestValue = value;
         }
      }
      return bestIndex;
   }
   GetSupportVertex(d: (b2Vec2 | null)): (b2Vec2 | null) {
      var bestIndex: number = 0;
      var bestValue: number = this.m_vertices![0]!.x * d!.x + this.m_vertices![0]!.y * d!.y;
      for (var i: number = 1; i < this.m_vertexCount; ++i) {
         var value: number = this.m_vertices![i]!.x * d!.x + this.m_vertices![i]!.y * d!.y;
         if (value > bestValue) {
            bestIndex = i;
            bestValue = value;
         }
      }
      return this.m_vertices![bestIndex];
   }
   Validate(): boolean {
      return false;
   }
   b2PolygonShape(): void {
      super.b2Shape();
      this.m_type = b2Shape.e_polygonShape;
      this.m_centroid = new b2Vec2();
      this.m_vertices = new Array<(b2Vec2 | null)>();
      this.m_normals = new Array<(b2Vec2 | null)>();
   }
   Reserve(count: number): void {
      if (count === undefined) count = 0;
      for (var i: number = parseInt(String(this.m_vertices!.length)); i < count; i++) {
         this.m_vertices![i] = new b2Vec2();
         this.m_normals![i] = new b2Vec2();
      }
   }
   static ComputeCentroid(vs: Array<(b2Vec2 | null)>, count: number): (b2Vec2 | null) {
      if (count === undefined) count = 0;
      var c: (b2Vec2 | null) = new b2Vec2();
      var area: number = 0.0;
      var p1X: number = 0.0;
      var p1Y: number = 0.0;
      var inv3: number = 1.0 / 3.0;
      for (var i: number = 0; i < count; ++i) {
         var p2: (b2Vec2 | null) = vs![i];
         var p3: (b2Vec2 | null) = i + 1 < count ? vs![parseInt(String(i + 1))] : vs![0];
         var e1X: number = p2!.x - p1X;
         var e1Y: number = p2!.y - p1Y;
         var e2X: number = p3!.x - p1X;
         var e2Y: number = p3!.y - p1Y;
         var D: number = (e1X * e2Y - e1Y * e2X);
         var triangleArea: number = 0.5 * D;area += triangleArea;
         c!.x += triangleArea * inv3 * (p1X + p2!.x + p3!.x);
         c!.y += triangleArea * inv3 * (p1Y + p2!.y + p3!.y);
      }
      c!.x *= 1.0 / area;
      c!.y *= 1.0 / area;
      return c;
   }
   static ComputeOBB(obb: (b2OBB | null), vs: Array<(b2Vec2 | null)>, count: number): void {
      if (count === undefined) count = 0;
      var i: number = 0;
      var p: Array<(b2Vec2 | null)> = new Array<(b2Vec2 | null)>(count + 1);
      for (i = 0;
      i < count; ++i) {
         p![i] = vs![i];
      }
      p![count] = p![0];
      var minArea: number = Number.MAX_VALUE;
      for (i = 1;
      i <= count; ++i) {
         var root: (b2Vec2 | null) = p![parseInt(String(i - 1))];
         var uxX: number = p![i]!.x - root!.x;
         var uxY: number = p![i]!.y - root!.y;
         var length: number = Math.sqrt(uxX * uxX + uxY * uxY);
         uxX /= length;
         uxY /= length;
         var uyX: number = (-uxY);
         var uyY: number = uxX;
         var lowerX: number = Number.MAX_VALUE;
         var lowerY: number = Number.MAX_VALUE;
         var upperX: number = (-Number.MAX_VALUE);
         var upperY: number = (-Number.MAX_VALUE);
         for (var j: number = 0; j < count; ++j) {
            var dX: number = p![j]!.x - root!.x;
            var dY: number = p![j]!.y - root!.y;
            var rX: number = (uxX * dX + uxY * dY);
            var rY: number = (uyX * dX + uyY * dY);
            if (rX < lowerX) lowerX = rX;
            if (rY < lowerY) lowerY = rY;
            if (rX > upperX) upperX = rX;
            if (rY > upperY) upperY = rY;
         }
         var area: number = (upperX - lowerX) * (upperY - lowerY);
         if (area < 0.95 * minArea) {
            minArea = area;
            obb!.R!.col1!.x = uxX;
            obb!.R!.col1!.y = uxY;
            obb!.R!.col2!.x = uyX;
            obb!.R!.col2!.y = uyY;
            var centerX: number = 0.5 * (lowerX + upperX);
            var centerY: number = 0.5 * (lowerY + upperY);
            var tMat: (b2Mat22 | null) = obb!.R;
            obb!.center!.x = root!.x + (tMat!.col1!.x * centerX + tMat!.col2!.x * centerY);
            obb!.center!.y = root!.y + (tMat!.col1!.y * centerX + tMat!.col2!.y * centerY);
            obb!.extents!.x = 0.5 * (upperX - lowerX);
            obb!.extents!.y = 0.5 * (upperY - lowerY);
         }
      }
   }
}

class b2Color {
   declare _r: number;
   declare _g: number;
   declare _b: number;

   constructor(rr?: number, gg?: number, bb?: number) {

      this._r = 0;
      this._g = 0;
      this._b = 0;

      if (new.target === b2Color) this.b2Color(rr!, gg!, bb!);
   }
   b2Color(rr: number, gg: number, bb: number): void {
      if (rr === undefined) rr = 0;
      if (gg === undefined) gg = 0;
      if (bb === undefined) bb = 0;
      this._r = parseUInt(255 * b2Math.Clamp(rr, 0.0, 1.0));
      this._g = parseUInt(255 * b2Math.Clamp(gg, 0.0, 1.0));
      this._b = parseUInt(255 * b2Math.Clamp(bb, 0.0, 1.0));
   }
   Set(rr: number, gg: number, bb: number): void {
      if (rr === undefined) rr = 0;
      if (gg === undefined) gg = 0;
      if (bb === undefined) bb = 0;
      this._r = parseUInt(255 * b2Math.Clamp(rr, 0.0, 1.0));
      this._g = parseUInt(255 * b2Math.Clamp(gg, 0.0, 1.0));
      this._b = parseUInt(255 * b2Math.Clamp(bb, 0.0, 1.0));
   }
   set r(rr: number) {
         if (rr === undefined) rr = 0;
         this._r = parseUInt(255 * b2Math.Clamp(rr, 0.0, 1.0));
      }
   set g(gg: number) {
         if (gg === undefined) gg = 0;
         this._g = parseUInt(255 * b2Math.Clamp(gg, 0.0, 1.0));
      }
   set b(bb: number) {
         if (bb === undefined) bb = 0;
         this._b = parseUInt(255 * b2Math.Clamp(bb, 0.0, 1.0));
      }
   get color(): number {
         return (this._r << 16) | (this._g << 8) | (this._b);
      }
}

class b2Settings {
   declare static VERSION: string;
   declare static USHRT_MAX: number;
   declare static b2_pi: number;
   declare static b2_maxManifoldPoints: number;
   declare static b2_aabbExtension: number;
   declare static b2_aabbMultiplier: number;
   declare static b2_polygonRadius: number;
   declare static b2_linearSlop: number;
   declare static b2_angularSlop: number;
   declare static b2_toiSlop: number;
   declare static b2_maxTOIContactsPerIsland: number;
   declare static b2_maxTOIJointsPerIsland: number;
   declare static b2_velocityThreshold: number;
   declare static b2_maxLinearCorrection: number;
   declare static b2_maxAngularCorrection: number;
   declare static b2_maxTranslation: number;
   declare static b2_maxTranslationSquared: number;
   declare static b2_maxRotation: number;
   declare static b2_maxRotationSquared: number;
   declare static b2_contactBaumgarte: number;
   declare static b2_timeToSleep: number;
   declare static b2_linearSleepTolerance: number;
   declare static b2_angularSleepTolerance: number;

   constructor() {

   }
   static b2MixFriction(friction1: number, friction2: number): number {
      if (friction1 === undefined) friction1 = 0;
      if (friction2 === undefined) friction2 = 0;
      return Math.sqrt(friction1 * friction2);
   }
   static b2MixRestitution(restitution1: number, restitution2: number): number {
      if (restitution1 === undefined) restitution1 = 0;
      if (restitution2 === undefined) restitution2 = 0;
      return restitution1 > restitution2 ? restitution1 : restitution2;
   }
   static b2Assert(a: boolean): void {
      if (!a) {
         throw "Assertion Failed";
      }
   }
}

class b2Mat22 {
   declare col1: (b2Vec2 | null);
   declare col2: (b2Vec2 | null);

   constructor() {

      this.col1 = new b2Vec2();
      this.col2 = new b2Vec2();

      if (new.target === b2Mat22) this.b2Mat22();
   }
   b2Mat22(): void {
      this.SetIdentity();
   }
   static FromAngle(angle: number): (b2Mat22 | null) {
      if (angle === undefined) angle = 0;
      var mat: (b2Mat22 | null) = new b2Mat22();
      mat!.Set(angle);
      return mat;
   }
   static FromVV(c1: (b2Vec2 | null), c2: (b2Vec2 | null)): (b2Mat22 | null) {
      var mat: (b2Mat22 | null) = new b2Mat22();
      mat!.SetVV(c1, c2);
      return mat;
   }
   Set(angle: number): void {
      if (angle === undefined) angle = 0;
      var c: number = Math.cos(angle);
      var s: number = Math.sin(angle);
      this.col1!.x = c;
      this.col2!.x = (-s);
      this.col1!.y = s;
      this.col2!.y = c;
   }
   SetVV(c1: (b2Vec2 | null), c2: (b2Vec2 | null)): void {
      this.col1!.SetV(c1);
      this.col2!.SetV(c2);
   }
   Copy(): (b2Mat22 | null) {
      var mat: (b2Mat22 | null) = new b2Mat22();
      mat!.SetM(this);
      return mat;
   }
   SetM(m: (b2Mat22 | null)): void {
      this.col1!.SetV(m!.col1);
      this.col2!.SetV(m!.col2);
   }
   AddM(m: (b2Mat22 | null)): void {
      this.col1!.x += m!.col1!.x;
      this.col1!.y += m!.col1!.y;
      this.col2!.x += m!.col2!.x;
      this.col2!.y += m!.col2!.y;
   }
   SetIdentity(): void {
      this.col1!.x = 1.0;
      this.col2!.x = 0.0;
      this.col1!.y = 0.0;
      this.col2!.y = 1.0;
   }
   SetZero(): void {
      this.col1!.x = 0.0;
      this.col2!.x = 0.0;
      this.col1!.y = 0.0;
      this.col2!.y = 0.0;
   }
   GetAngle(): number {
      return Math.atan2(this.col1!.y, this.col1!.x);
   }
   GetInverse(out: (b2Mat22 | null)): (b2Mat22 | null) {
      var a: number = this.col1!.x;
      var b: number = this.col2!.x;
      var c: number = this.col1!.y;
      var d: number = this.col2!.y;
      var det: number = a * d - b * c;
      if (det != 0.0) {
         det = 1.0 / det;
      }
      out!.col1!.x = det * d;
      out!.col2!.x = (-det * b);
      out!.col1!.y = (-det * c);
      out!.col2!.y = det * a;
      return out;
   }
   Solve(out: (b2Vec2 | null), bX: number, bY: number): (b2Vec2 | null) {
      if (bX === undefined) bX = 0;
      if (bY === undefined) bY = 0;
      var a11: number = this.col1!.x;
      var a12: number = this.col2!.x;
      var a21: number = this.col1!.y;
      var a22: number = this.col2!.y;
      var det: number = a11 * a22 - a12 * a21;
      if (det != 0.0) {
         det = 1.0 / det;
      }
      out!.x = det * (a22 * bX - a12 * bY);
      out!.y = det * (a11 * bY - a21 * bX);
      return out;
   }
   Abs(): void {
      this.col1!.Abs();
      this.col2!.Abs();
   }
}

class b2Mat33 {
   declare col1: (b2Vec3 | null);
   declare col2: (b2Vec3 | null);
   declare col3: (b2Vec3 | null);

   constructor(c1?: (b2Vec3 | null), c2?: (b2Vec3 | null), c3?: (b2Vec3 | null)) {

      this.col1 = new b2Vec3();
      this.col2 = new b2Vec3();
      this.col3 = new b2Vec3();

      if (new.target === b2Mat33) this.b2Mat33(c1!, c2!, c3!);
   }
   b2Mat33(c1: (b2Vec3 | null) = null, c2: (b2Vec3 | null) = null, c3: (b2Vec3 | null) = null): void {
      if (c1 === undefined) c1 = null;
      if (c2 === undefined) c2 = null;
      if (c3 === undefined) c3 = null;
      if (!c1 && !c2 && !c3) {
         this.col1!.SetZero();
         this.col2!.SetZero();
         this.col3!.SetZero();
      }
      else {
         this.col1!.SetV(c1);
         this.col2!.SetV(c2);
         this.col3!.SetV(c3);
      }
   }
   SetVVV(c1: (b2Vec3 | null), c2: (b2Vec3 | null), c3: (b2Vec3 | null)): void {
      this.col1!.SetV(c1);
      this.col2!.SetV(c2);
      this.col3!.SetV(c3);
   }
   Copy(): (b2Mat33 | null) {
      return new b2Mat33(this.col1, this.col2, this.col3);
   }
   SetM(m: (b2Mat33 | null)): void {
      this.col1!.SetV(m!.col1);
      this.col2!.SetV(m!.col2);
      this.col3!.SetV(m!.col3);
   }
   AddM(m: (b2Mat33 | null)): void {
      this.col1!.x += m!.col1!.x;
      this.col1!.y += m!.col1!.y;
      this.col1!.z += m!.col1!.z;
      this.col2!.x += m!.col2!.x;
      this.col2!.y += m!.col2!.y;
      this.col2!.z += m!.col2!.z;
      this.col3!.x += m!.col3!.x;
      this.col3!.y += m!.col3!.y;
      this.col3!.z += m!.col3!.z;
   }
   SetIdentity(): void {
      this.col1!.x = 1.0;
      this.col2!.x = 0.0;
      this.col3!.x = 0.0;
      this.col1!.y = 0.0;
      this.col2!.y = 1.0;
      this.col3!.y = 0.0;
      this.col1!.z = 0.0;
      this.col2!.z = 0.0;
      this.col3!.z = 1.0;
   }
   SetZero(): void {
      this.col1!.x = 0.0;
      this.col2!.x = 0.0;
      this.col3!.x = 0.0;
      this.col1!.y = 0.0;
      this.col2!.y = 0.0;
      this.col3!.y = 0.0;
      this.col1!.z = 0.0;
      this.col2!.z = 0.0;
      this.col3!.z = 0.0;
   }
   Solve22(out: (b2Vec2 | null), bX: number, bY: number): (b2Vec2 | null) {
      if (bX === undefined) bX = 0;
      if (bY === undefined) bY = 0;
      var a11: number = this.col1!.x;
      var a12: number = this.col2!.x;
      var a21: number = this.col1!.y;
      var a22: number = this.col2!.y;
      var det: number = a11 * a22 - a12 * a21;
      if (det != 0.0) {
         det = 1.0 / det;
      }
      out!.x = det * (a22 * bX - a12 * bY);
      out!.y = det * (a11 * bY - a21 * bX);
      return out;
   }
   Solve33(out: (b2Vec3 | null), bX: number, bY: number, bZ: number): (b2Vec3 | null) {
      if (bX === undefined) bX = 0;
      if (bY === undefined) bY = 0;
      if (bZ === undefined) bZ = 0;
      var a11: number = this.col1!.x;
      var a21: number = this.col1!.y;
      var a31: number = this.col1!.z;
      var a12: number = this.col2!.x;
      var a22: number = this.col2!.y;
      var a32: number = this.col2!.z;
      var a13: number = this.col3!.x;
      var a23: number = this.col3!.y;
      var a33: number = this.col3!.z;
      var det: number = a11 * (a22 * a33 - a32 * a23) + a21 * (a32 * a13 - a12 * a33) + a31 * (a12 * a23 - a22 * a13);
      if (det != 0.0) {
         det = 1.0 / det;
      }
      out!.x = det * (bX * (a22 * a33 - a32 * a23) + bY * (a32 * a13 - a12 * a33) + bZ * (a12 * a23 - a22 * a13));
      out!.y = det * (a11 * (bY * a33 - bZ * a23) + a21 * (bZ * a13 - bX * a33) + a31 * (bX * a23 - bY * a13));
      out!.z = det * (a11 * (a22 * bZ - a32 * bY) + a21 * (a32 * bX - a12 * bZ) + a31 * (a12 * bY - a22 * bX));
      return out;
   }
}

class b2Math {
   declare static b2Vec2_zero: (b2Vec2 | null);
   declare static b2Mat22_identity: (b2Mat22 | null);
   declare static b2Transform_identity: (b2Transform | null);

   constructor() {

   }
   static IsValid(x: number): boolean {
      if (x === undefined) x = 0;
      return isFinite(x);
   }
   static Dot(a: (b2Vec2 | null), b: (b2Vec2 | null)): number {
      return a!.x * b!.x + a!.y * b!.y;
   }
   static CrossVV(a: (b2Vec2 | null), b: (b2Vec2 | null)): number {
      return a!.x * b!.y - a!.y * b!.x;
   }
   static CrossVF(a: (b2Vec2 | null), s: number): (b2Vec2 | null) {
      if (s === undefined) s = 0;
      var v: (b2Vec2 | null) = new b2Vec2(s * a!.y, (-s * a!.x));
      return v;
   }
   static CrossFV(s: number, a: (b2Vec2 | null)): (b2Vec2 | null) {
      if (s === undefined) s = 0;
      var v: (b2Vec2 | null) = new b2Vec2((-s * a!.y), s * a!.x);
      return v;
   }
   static MulMV(A: (b2Mat22 | null), v: (b2Vec2 | null)): (b2Vec2 | null) {
      var u: (b2Vec2 | null) = new b2Vec2(A!.col1!.x * v!.x + A!.col2!.x * v!.y, A!.col1!.y * v!.x + A!.col2!.y * v!.y);
      return u;
   }
   static MulTMV(A: (b2Mat22 | null), v: (b2Vec2 | null)): (b2Vec2 | null) {
      var u: (b2Vec2 | null) = new b2Vec2(b2Math.Dot(v, A!.col1), b2Math.Dot(v, A!.col2));
      return u;
   }
   static MulX(T: (b2Transform | null), v: (b2Vec2 | null)): (b2Vec2 | null) {
      var a: (b2Vec2 | null) = b2Math.MulMV(T!.R, v);
      a!.x += T!.position!.x;
      a!.y += T!.position!.y;
      return a;
   }
   static MulXT(T: (b2Transform | null), v: (b2Vec2 | null)): (b2Vec2 | null) {
      var a: (b2Vec2 | null) = b2Math.SubtractVV(v, T!.position);
      var tX: number = (a!.x * T!.R!.col1!.x + a!.y * T!.R!.col1!.y);
      a!.y = (a!.x * T!.R!.col2!.x + a!.y * T!.R!.col2!.y);
      a!.x = tX;
      return a;
   }
   static AddVV(a: (b2Vec2 | null), b: (b2Vec2 | null)): (b2Vec2 | null) {
      var v: (b2Vec2 | null) = new b2Vec2(a!.x + b!.x, a!.y + b!.y);
      return v;
   }
   static SubtractVV(a: (b2Vec2 | null), b: (b2Vec2 | null)): (b2Vec2 | null) {
      var v: (b2Vec2 | null) = new b2Vec2(a!.x - b!.x, a!.y - b!.y);
      return v;
   }
   static Distance(a: (b2Vec2 | null), b: (b2Vec2 | null)): number {
      var cX: number = a!.x - b!.x;
      var cY: number = a!.y - b!.y;
      return Math.sqrt(cX * cX + cY * cY);
   }
   static DistanceSquared(a: (b2Vec2 | null), b: (b2Vec2 | null)): number {
      var cX: number = a!.x - b!.x;
      var cY: number = a!.y - b!.y;
      return (cX * cX + cY * cY);
   }
   static MulFV(s: number, a: (b2Vec2 | null)): (b2Vec2 | null) {
      if (s === undefined) s = 0;
      var v: (b2Vec2 | null) = new b2Vec2(s * a!.x, s * a!.y);
      return v;
   }
   static AddMM(A: (b2Mat22 | null), B: (b2Mat22 | null)): (b2Mat22 | null) {
      var C: (b2Mat22 | null) = b2Mat22.FromVV(b2Math.AddVV(A!.col1, B!.col1), b2Math.AddVV(A!.col2, B!.col2));
      return C;
   }
   static MulMM(A: (b2Mat22 | null), B: (b2Mat22 | null)): (b2Mat22 | null) {
      var C: (b2Mat22 | null) = b2Mat22.FromVV(b2Math.MulMV(A, B!.col1), b2Math.MulMV(A, B!.col2));
      return C;
   }
   static MulTMM(A: (b2Mat22 | null), B: (b2Mat22 | null)): (b2Mat22 | null) {
      var c1: (b2Vec2 | null) = new b2Vec2(b2Math.Dot(A!.col1, B!.col1), b2Math.Dot(A!.col2, B!.col1));
      var c2: (b2Vec2 | null) = new b2Vec2(b2Math.Dot(A!.col1, B!.col2), b2Math.Dot(A!.col2, B!.col2));
      var C: (b2Mat22 | null) = b2Mat22.FromVV(c1, c2);
      return C;
   }
   static Abs(a: number): number {
      if (a === undefined) a = 0;
      return a > 0.0 ? a : (-a);
   }
   static AbsV(a: (b2Vec2 | null)): (b2Vec2 | null) {
      var b: (b2Vec2 | null) = new b2Vec2(b2Math.Abs(a!.x), b2Math.Abs(a!.y));
      return b;
   }
   static AbsM(A: (b2Mat22 | null)): (b2Mat22 | null) {
      var B: (b2Mat22 | null) = b2Mat22.FromVV(b2Math.AbsV(A!.col1), b2Math.AbsV(A!.col2));
      return B;
   }
   static Min(a: number, b: number): number {
      if (a === undefined) a = 0;
      if (b === undefined) b = 0;
      return a < b ? a : b;
   }
   static MinV(a: (b2Vec2 | null), b: (b2Vec2 | null)): (b2Vec2 | null) {
      var c: (b2Vec2 | null) = new b2Vec2(b2Math.Min(a!.x, b!.x), b2Math.Min(a!.y, b!.y));
      return c;
   }
   static Max(a: number, b: number): number {
      if (a === undefined) a = 0;
      if (b === undefined) b = 0;
      return a > b ? a : b;
   }
   static MaxV(a: (b2Vec2 | null), b: (b2Vec2 | null)): (b2Vec2 | null) {
      var c: (b2Vec2 | null) = new b2Vec2(b2Math.Max(a!.x, b!.x), b2Math.Max(a!.y, b!.y));
      return c;
   }
   static Clamp(a: number, low: number, high: number): number {
      if (a === undefined) a = 0;
      if (low === undefined) low = 0;
      if (high === undefined) high = 0;
      return a < low ? low : a > high ? high : a;
   }
   static ClampV(a: (b2Vec2 | null), low: (b2Vec2 | null), high: (b2Vec2 | null)): (b2Vec2 | null) {
      return b2Math.MaxV(low, b2Math.MinV(a, high));
   }
   static Swap(a: Array<unknown>, b: Array<unknown>): void {
      var tmp = a![0];
      a![0] = b![0];
      b![0] = tmp;
   }
   static Random(): number {
      return Math.random() * 2 - 1;
   }
   static RandomRange(lo: number, hi: number): number {
      if (lo === undefined) lo = 0;
      if (hi === undefined) hi = 0;
      var r: number = Math.random();
      r = (hi - lo) * r + lo;
      return r;
   }
   static NextPowerOfTwo(x: number): number {
      if (x === undefined) x = 0;
      x |= (x >> 1) & 0x7FFFFFFF;
      x |= (x >> 2) & 0x3FFFFFFF;
      x |= (x >> 4) & 0x0FFFFFFF;
      x |= (x >> 8) & 0x00FFFFFF;
      x |= (x >> 16) & 0x0000FFFF;
      return x + 1;
   }
   static IsPowerOfTwo(x: number): boolean {
      if (x === undefined) x = 0;
      var result: boolean = x > 0 && (x & (x - 1)) == 0;
      return result;
   }
}

class b2Sweep {
   declare localCenter: (b2Vec2 | null);
   declare c0: (b2Vec2 | null);
   declare c: (b2Vec2 | null);
   declare a0: number;
   declare a: number;
   declare t0: number;

   constructor() {

      this.localCenter = new b2Vec2();
      this.c0 = new b2Vec2;
      this.c = new b2Vec2();

   }
   Set(other: (b2Sweep | null)): void {
      this.localCenter!.SetV(other!.localCenter);
      this.c0!.SetV(other!.c0);
      this.c!.SetV(other!.c);
      this.a0 = other!.a0;
      this.a = other!.a;
      this.t0 = other!.t0;
   }
   Copy(): (b2Sweep | null) {
      var copy: (b2Sweep | null) = new b2Sweep();
      copy!.localCenter!.SetV(this.localCenter);
      copy!.c0!.SetV(this.c0);
      copy!.c!.SetV(this.c);
      copy!.a0 = this.a0;
      copy!.a = this.a;
      copy!.t0 = this.t0;
      return copy;
   }
   GetTransform(xf: (b2Transform | null), alpha: number): void {
      if (alpha === undefined) alpha = 0;
      xf!.position!.x = (1.0 - alpha) * this.c0!.x + alpha * this.c!.x;
      xf!.position!.y = (1.0 - alpha) * this.c0!.y + alpha * this.c!.y;
      var angle: number = (1.0 - alpha) * this.a0 + alpha * this.a;
      xf!.R!.Set(angle);
      var tMat: (b2Mat22 | null) = xf!.R;
      xf!.position!.x -= (tMat!.col1!.x * this.localCenter!.x + tMat!.col2!.x * this.localCenter!.y);
      xf!.position!.y -= (tMat!.col1!.y * this.localCenter!.x + tMat!.col2!.y * this.localCenter!.y);
   }
   Advance(t: number): void {
      if (t === undefined) t = 0;
      if (this.t0 < t && 1.0 - this.t0 > Number.MIN_VALUE) {
         var alpha: number = (t - this.t0) / (1.0 - this.t0);
         this.c0!.x = (1.0 - alpha) * this.c0!.x + alpha * this.c!.x;
         this.c0!.y = (1.0 - alpha) * this.c0!.y + alpha * this.c!.y;
         this.a0 = (1.0 - alpha) * this.a0 + alpha * this.a;
         this.t0 = t;
      }
   }
}

class b2Transform {
   declare position: (b2Vec2 | null);
   declare R: (b2Mat22 | null);

   constructor(pos?: (b2Vec2 | null), r?: (b2Mat22 | null)) {

      this.position = new b2Vec2;
      this.R = new b2Mat22();

      if (new.target === b2Transform) this.b2Transform(pos!, r!);
   }
   b2Transform(pos: (b2Vec2 | null) = null, r: (b2Mat22 | null) = null): void {
      if (pos === undefined) pos = null;
      if (r === undefined) r = null;
      if (pos) {
         this.position!.SetV(pos);
         this.R!.SetM(r);
      }
   }
   Initialize(pos: (b2Vec2 | null), r: (b2Mat22 | null)): void {
      this.position!.SetV(pos);
      this.R!.SetM(r);
   }
   SetIdentity(): void {
      this.position!.SetZero();
      this.R!.SetIdentity();
   }
   Set(x: (b2Transform | null)): void {
      this.position!.SetV(x!.position);
      this.R!.SetM(x!.R);
   }
   GetAngle(): number {
      return Math.atan2(this.R!.col1!.y, this.R!.col1!.x);
   }
}

class b2Vec2 {
   declare x: number;
   declare y: number;

   constructor(x_?: number, y_?: number) {

      if (new.target === b2Vec2) this.b2Vec2(x_!, y_!);
   }
   b2Vec2(x_: number = 0, y_: number = 0): void {
      if (x_ === undefined) x_ = 0;
      if (y_ === undefined) y_ = 0;
      this.x = x_;
      this.y = y_;
   }
   SetZero(): void {
      this.x = 0.0;
      this.y = 0.0;
   }
   Set(x_: number = 0, y_: number = 0): void {
      if (x_ === undefined) x_ = 0;
      if (y_ === undefined) y_ = 0;
      this.x = x_;
      this.y = y_;
   }
   SetV(v: (b2Vec2 | null)): void {
      this.x = v!.x;
      this.y = v!.y;
   }
   GetNegative(): (b2Vec2 | null) {
      return new b2Vec2((-this.x), (-this.y));
   }
   NegativeSelf(): void {
      this.x = (-this.x);
      this.y = (-this.y);
   }
   static Make(x_: number, y_: number): (b2Vec2 | null) {
      if (x_ === undefined) x_ = 0;
      if (y_ === undefined) y_ = 0;
      return new b2Vec2(x_, y_);
   }
   Copy(): (b2Vec2 | null) {
      return new b2Vec2(this.x, this.y);
   }
   Add(v: (b2Vec2 | null)): void {
      this.x += v!.x;
      this.y += v!.y;
   }
   Subtract(v: (b2Vec2 | null)): void {
      this.x -= v!.x;
      this.y -= v!.y;
   }
   Multiply(a: number): void {
      if (a === undefined) a = 0;
      this.x *= a;
      this.y *= a;
   }
   MulM(A: (b2Mat22 | null)): void {
      var tX: number = this.x;
      this.x = A!.col1!.x * tX + A!.col2!.x * this.y;
      this.y = A!.col1!.y * tX + A!.col2!.y * this.y;
   }
   MulTM(A: (b2Mat22 | null)): void {
      var tX: number = b2Math.Dot(this, A!.col1);
      this.y = b2Math.Dot(this, A!.col2);
      this.x = tX;
   }
   CrossVF(s: number): void {
      if (s === undefined) s = 0;
      var tX: number = this.x;
      this.x = s * this.y;
      this.y = (-s * tX);
   }
   CrossFV(s: number): void {
      if (s === undefined) s = 0;
      var tX: number = this.x;
      this.x = (-s * this.y);
      this.y = s * tX;
   }
   MinV(b: (b2Vec2 | null)): void {
      this.x = this.x < b!.x ? this.x : b!.x;
      this.y = this.y < b!.y ? this.y : b!.y;
   }
   MaxV(b: (b2Vec2 | null)): void {
      this.x = this.x > b!.x ? this.x : b!.x;
      this.y = this.y > b!.y ? this.y : b!.y;
   }
   Abs(): void {
      if (this.x < 0) this.x = (-this.x);
      if (this.y < 0) this.y = (-this.y);
   }
   Length(): number {
      return Math.sqrt(this.x * this.x + this.y * this.y);
   }
   LengthSquared(): number {
      return (this.x * this.x + this.y * this.y);
   }
   Normalize(): number {
      var length: number = Math.sqrt(this.x * this.x + this.y * this.y);
      if (length < Number.MIN_VALUE) {
         return 0.0;
      }
      var invLength: number = 1.0 / length;
      this.x *= invLength;
      this.y *= invLength;
      return length;
   }
   IsValid(): boolean {
      return b2Math.IsValid(this.x) && b2Math.IsValid(this.y);
   }
}

class b2Vec3 {
   declare x: number;
   declare y: number;
   declare z: number;

   constructor(x?: number, y?: number, z?: number) {

      if (new.target === b2Vec3) this.b2Vec3(x!, y!, z!);
   }
   b2Vec3(x: number = 0, y: number = 0, z: number = 0): void {
      if (x === undefined) x = 0;
      if (y === undefined) y = 0;
      if (z === undefined) z = 0;
      this.x = x;
      this.y = y;
      this.z = z;
   }
   SetZero(): void {
      this.x = this.y = this.z = 0.0;
   }
   Set(x: number, y: number, z: number): void {
      if (x === undefined) x = 0;
      if (y === undefined) y = 0;
      if (z === undefined) z = 0;
      this.x = x;
      this.y = y;
      this.z = z;
   }
   SetV(v: (b2Vec3 | null)): void {
      this.x = v!.x;
      this.y = v!.y;
      this.z = v!.z;
   }
   GetNegative(): (b2Vec3 | null) {
      return new b2Vec3((-this.x), (-this.y), (-this.z));
   }
   NegativeSelf(): void {
      this.x = (-this.x);
      this.y = (-this.y);
      this.z = (-this.z);
   }
   Copy(): (b2Vec3 | null) {
      return new b2Vec3(this.x, this.y, this.z);
   }
   Add(v: (b2Vec3 | null)): void {
      this.x += v!.x;
      this.y += v!.y;
      this.z += v!.z;
   }
   Subtract(v: (b2Vec3 | null)): void {
      this.x -= v!.x;
      this.y -= v!.y;
      this.z -= v!.z;
   }
   Multiply(a: number): void {
      if (a === undefined) a = 0;
      this.x *= a;
      this.y *= a;
      this.z *= a;
   }
}

class b2Body {
   declare static s_xf1: (b2Transform | null);
   declare m_flags: number;
   declare m_type: number;
   declare m_islandIndex: number;
   declare m_xf: (b2Transform | null);
   declare m_sweep: (b2Sweep | null);
   declare m_linearVelocity: (b2Vec2 | null);
   declare m_angularVelocity: number;
   declare m_force: (b2Vec2 | null);
   declare m_torque: number;
   declare m_world: (b2World | null);
   declare m_prev: (b2Body | null);
   declare m_next: (b2Body | null);
   declare m_fixtureList: (b2Fixture | null);
   declare m_fixtureCount: number;
   declare m_controllerList: (b2ControllerEdge | null);
   declare m_controllerCount: number;
   declare m_jointList: (b2JointEdge | null);
   declare m_contactList: (b2ContactEdge | null);
   declare m_mass: number;
   declare m_I: number;
   declare m_inertiaScale: number;
   declare m_linearDamping: number;
   declare m_angularDamping: number;
   declare m_sleepTime: number;
   declare m_userData: unknown;
   declare static e_islandFlag: number;
   declare static e_awakeFlag: number;
   declare static e_allowSleepFlag: number;
   declare static e_bulletFlag: number;
   declare static e_fixedRotationFlag: number;
   declare static e_activeFlag: number;
   declare static b2_staticBody: number;
   declare static b2_kinematicBody: number;
   declare static b2_dynamicBody: number;
   declare m_invMass: number;
   declare m_invI: number;

   constructor(bd?: (b2BodyDef | null), world?: (b2World | null)) {

      this.m_xf = new b2Transform();
      this.m_sweep = new b2Sweep();
      this.m_linearVelocity = new b2Vec2();
      this.m_force = new b2Vec2();

      if (new.target === b2Body) this.b2Body(bd!, world!);
   }
   connectEdges(s1: (b2EdgeShape | null), s2: (b2EdgeShape | null), angle1: number): number {
      if (angle1 === undefined) angle1 = 0;
      var angle2: number = Math.atan2(s2!.GetDirectionVector()!.y, s2!.GetDirectionVector()!.x);
      var coreOffset: number = Math.tan((angle2 - angle1) * 0.5);
      var core: (b2Vec2 | null) = b2Math.MulFV(coreOffset, s2!.GetDirectionVector());
      core = b2Math.SubtractVV(core, s2!.GetNormalVector());
      core = b2Math.MulFV(b2Settings.b2_toiSlop, core);
      core = b2Math.AddVV(core, s2!.GetVertex1());
      var cornerDir: (b2Vec2 | null) = b2Math.AddVV(s1!.GetDirectionVector(), s2!.GetDirectionVector());
      cornerDir!.Normalize();
      var convex: boolean = b2Math.Dot(s1!.GetDirectionVector(), s2!.GetNormalVector()) > 0.0;
      s1!.SetNextEdge(s2, core, cornerDir, convex);
      s2!.SetPrevEdge(s1, core, cornerDir, convex);
      return angle2;
   }
   CreateFixture(def: (b2FixtureDef | null)): (b2Fixture | null) {
      if (this.m_world!.IsLocked() == true) {
         return null;
      }
      var fixture: (b2Fixture | null) = new b2Fixture();
      fixture!.Create(this, this.m_xf, def);
      if (this.m_flags & b2Body.e_activeFlag) {
         var broadPhase: (b2DynamicTreeBroadPhase | null) = this.m_world!.m_contactManager!.m_broadPhase;
         fixture!.CreateProxy(broadPhase, this.m_xf);
      }
      fixture!.m_next = this.m_fixtureList;
      this.m_fixtureList = fixture;
      ++this.m_fixtureCount;
      fixture!.m_body = this;
      if (fixture!.m_density > 0.0) {
         this.ResetMassData();
      }
      this.m_world!.m_flags |= b2World.e_newFixture;
      return fixture;
   }
   CreateFixture2(shape: (b2Shape | null), density: number = 0.0): (b2Fixture | null) {
      if (density === undefined) density = 0.0;
      var def: (b2FixtureDef | null) = new b2FixtureDef();
      def!.shape = shape;
      def!.density = density;
      return this.CreateFixture(def);
   }
   DestroyFixture(fixture: (b2Fixture | null)): void {
      if (this.m_world!.IsLocked() == true) {
         return;
      }
      var node: (b2Fixture | null) = this.m_fixtureList;
      var ppF: (b2Fixture | null) = null;
      var found: boolean = false;
      while (node != null) {
         if (node == fixture) {
            if (ppF) ppF!.m_next = fixture!.m_next;
            else this.m_fixtureList = fixture!.m_next;
            found = true;
            break;
         }
         ppF = node;
         node = node!.m_next;
      }
      var edge: (b2ContactEdge | null) = this.m_contactList;
      while (edge) {
         var c: (b2Contact | null) = edge!.contact;
         edge = edge!.next;
         var fixtureA: (b2Fixture | null) = c!.GetFixtureA();
         var fixtureB: (b2Fixture | null) = c!.GetFixtureB();
         if (fixture == fixtureA || fixture == fixtureB) {
            this.m_world!.m_contactManager!.Destroy(c);
         }
      }
      if (this.m_flags & b2Body.e_activeFlag) {
         var broadPhase: (b2DynamicTreeBroadPhase | null) = this.m_world!.m_contactManager!.m_broadPhase;
         fixture!.DestroyProxy(broadPhase);
      }
      else {}
      fixture!.Destroy();
      fixture!.m_body = null;
      fixture!.m_next = null;
      --this.m_fixtureCount;
      this.ResetMassData();
   }
   SetPositionAndAngle(position: (b2Vec2 | null), angle: number): void {
      if (angle === undefined) angle = 0;
      var f: (b2Fixture | null) | undefined;
      if (this.m_world!.IsLocked() == true) {
         return;
      }
      this.m_xf!.R!.Set(angle);
      this.m_xf!.position!.SetV(position);
      var tMat: (b2Mat22 | null) = this.m_xf!.R;
      var tVec: (b2Vec2 | null) = this.m_sweep!.localCenter;
      this.m_sweep!.c!.x = (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      this.m_sweep!.c!.y = (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      this.m_sweep!.c!.x += this.m_xf!.position!.x;
      this.m_sweep!.c!.y += this.m_xf!.position!.y;
      this.m_sweep!.c0!.SetV(this.m_sweep!.c);
      this.m_sweep!.a0 = this.m_sweep!.a = angle;
      var broadPhase: (b2DynamicTreeBroadPhase | null) = this.m_world!.m_contactManager!.m_broadPhase;
      for (f = this.m_fixtureList;
      f; f = f!.m_next) {
         f!.Synchronize(broadPhase, this.m_xf, this.m_xf);
      }
      this.m_world!.m_contactManager!.FindNewContacts();
   }
   SetTransform(xf: (b2Transform | null)): void {
      this.SetPositionAndAngle(xf!.position, xf!.GetAngle());
   }
   GetTransform(): (b2Transform | null) {
      return this.m_xf;
   }
   GetPosition(): (b2Vec2 | null) {
      return this.m_xf!.position;
   }
   SetPosition(position: (b2Vec2 | null)): void {
      this.SetPositionAndAngle(position, this.GetAngle());
   }
   GetAngle(): number {
      return this.m_sweep!.a;
   }
   SetAngle(angle: number): void {
      if (angle === undefined) angle = 0;
      this.SetPositionAndAngle(this.GetPosition(), angle);
   }
   GetWorldCenter(): (b2Vec2 | null) {
      return this.m_sweep!.c;
   }
   GetLocalCenter(): (b2Vec2 | null) {
      return this.m_sweep!.localCenter;
   }
   SetLinearVelocity(v: (b2Vec2 | null)): void {
      if (this.m_type == b2Body.b2_staticBody) {
         return;
      }
      this.m_linearVelocity!.SetV(v);
   }
   GetLinearVelocity(): (b2Vec2 | null) {
      return this.m_linearVelocity;
   }
   SetAngularVelocity(omega: number): void {
      if (omega === undefined) omega = 0;
      if (this.m_type == b2Body.b2_staticBody) {
         return;
      }
      this.m_angularVelocity = omega;
   }
   GetAngularVelocity(): number {
      return this.m_angularVelocity;
   }
   GetDefinition(): (b2BodyDef | null) {
      var bd: (b2BodyDef | null) = new b2BodyDef();
      bd!.type = this.GetType();
      bd!.allowSleep = (this.m_flags & b2Body.e_allowSleepFlag) == b2Body.e_allowSleepFlag;
      bd!.angle = this.GetAngle();
      bd!.angularDamping = this.m_angularDamping;
      bd!.angularVelocity = this.m_angularVelocity;
      bd!.fixedRotation = (this.m_flags & b2Body.e_fixedRotationFlag) == b2Body.e_fixedRotationFlag;
      bd!.bullet = (this.m_flags & b2Body.e_bulletFlag) == b2Body.e_bulletFlag;
      bd!.awake = (this.m_flags & b2Body.e_awakeFlag) == b2Body.e_awakeFlag;
      bd!.linearDamping = this.m_linearDamping;
      bd!.linearVelocity!.SetV(this.GetLinearVelocity());
      bd!.position = this.GetPosition();
      bd!.userData = this.GetUserData();
      return bd;
   }
   ApplyForce(force: (b2Vec2 | null), point: (b2Vec2 | null)): void {
      if (this.m_type != b2Body.b2_dynamicBody) {
         return;
      }
      if (this.IsAwake() == false) {
         this.SetAwake(true);
      }
      this.m_force!.x += force!.x;
      this.m_force!.y += force!.y;
      this.m_torque += ((point!.x - this.m_sweep!.c!.x) * force!.y - (point!.y - this.m_sweep!.c!.y) * force!.x);
   }
   ApplyTorque(torque: number): void {
      if (torque === undefined) torque = 0;
      if (this.m_type != b2Body.b2_dynamicBody) {
         return;
      }
      if (this.IsAwake() == false) {
         this.SetAwake(true);
      }
      this.m_torque += torque;
   }
   ApplyImpulse(impulse: (b2Vec2 | null), point: (b2Vec2 | null)): void {
      if (this.m_type != b2Body.b2_dynamicBody) {
         return;
      }
      if (this.IsAwake() == false) {
         this.SetAwake(true);
      }
      this.m_linearVelocity!.x += this.m_invMass * impulse!.x;
      this.m_linearVelocity!.y += this.m_invMass * impulse!.y;
      this.m_angularVelocity += this.m_invI * ((point!.x - this.m_sweep!.c!.x) * impulse!.y - (point!.y - this.m_sweep!.c!.y) * impulse!.x);
   }
   Split(callback: FixtureQueryCallback): (b2Body | null) {
      var linearVelocity: (b2Vec2 | null) = this.GetLinearVelocity()!.Copy();
      var angularVelocity: number = this.GetAngularVelocity();
      var center: (b2Vec2 | null) = this.GetWorldCenter();
      var body1: (b2Body | null) = this;
      var body2: (b2Body | null) = this.m_world!.CreateBody(this.GetDefinition());
      var prev: (b2Fixture | null) | undefined;
      for (var f: (b2Fixture | null) = body1!.m_fixtureList; f;) {
         if (callback(f!)) {
            var next: (b2Fixture | null) = f!.m_next;
            if (prev) {
               prev!.m_next = next;
            }
            else {
               body1!.m_fixtureList = next;
            }
            body1!.m_fixtureCount--;
            f!.m_next = body2!.m_fixtureList;
            body2!.m_fixtureList = f;
            body2!.m_fixtureCount++;
            f!.m_body = body2;
            f = next;
         }
         else {
            prev = f;
            f = f!.m_next;
         }
      }
      body1!.ResetMassData();
      body2!.ResetMassData();
      var center1: (b2Vec2 | null) = body1!.GetWorldCenter();
      var center2: (b2Vec2 | null) = body2!.GetWorldCenter();
      var velocity1: (b2Vec2 | null) = b2Math.AddVV(linearVelocity, b2Math.CrossFV(angularVelocity, b2Math.SubtractVV(center1, center)));
      var velocity2: (b2Vec2 | null) = b2Math.AddVV(linearVelocity, b2Math.CrossFV(angularVelocity, b2Math.SubtractVV(center2, center)));
      body1!.SetLinearVelocity(velocity1);
      body2!.SetLinearVelocity(velocity2);
      body1!.SetAngularVelocity(angularVelocity);
      body2!.SetAngularVelocity(angularVelocity);
      body1!.SynchronizeFixtures();
      body2!.SynchronizeFixtures();
      return body2;
   }
   Merge(other: (b2Body | null)): void {
      var f: (b2Fixture | null) | undefined;
      for (f = other!.m_fixtureList;
      f;) {
         var next: (b2Fixture | null) = f!.m_next;
         other!.m_fixtureCount--;
         f!.m_next = this.m_fixtureList;
         this.m_fixtureList = f;
         this.m_fixtureCount++;
         f!.m_body = body2!;
         f = next;
      }
      body1!.m_fixtureCount = 0;
      var body1: (b2Body | null) = this;
      var body2: b2Body | null | undefined = other;
      var center1: (b2Vec2 | null) = body1!.GetWorldCenter();
      var center2: (b2Vec2 | null) = body2!.GetWorldCenter();
      var velocity1: (b2Vec2 | null) = body1!.GetLinearVelocity()!.Copy();
      var velocity2: (b2Vec2 | null) = body2!.GetLinearVelocity()!.Copy();
      var angular1: number = body1!.GetAngularVelocity();
      var angular: number = body2!.GetAngularVelocity();
      body1!.ResetMassData();
      this.SynchronizeFixtures();
   }
   GetMass(): number {
      return this.m_mass;
   }
   GetInertia(): number {
      return this.m_I;
   }
   GetMassData(data: (b2MassData | null)): void {
      data!.mass = this.m_mass;
      data!.I = this.m_I;
      data!.center!.SetV(this.m_sweep!.localCenter);
   }
   SetMassData(massData: (b2MassData | null)): void {
      b2Settings.b2Assert(this.m_world!.IsLocked() == false);
      if (this.m_world!.IsLocked() == true) {
         return;
      }
      if (this.m_type != b2Body.b2_dynamicBody) {
         return;
      }
      this.m_invMass = 0.0;
      this.m_I = 0.0;
      this.m_invI = 0.0;
      this.m_mass = massData!.mass;
      if (this.m_mass <= 0.0) {
         this.m_mass = 1.0;
      }
      this.m_invMass = 1.0 / this.m_mass;
      if (massData!.I > 0.0 && (this.m_flags & b2Body.e_fixedRotationFlag) == 0) {
         this.m_I = massData!.I - this.m_mass * (massData!.center!.x * massData!.center!.x + massData!.center!.y * massData!.center!.y);
         this.m_invI = 1.0 / this.m_I;
      }
      var oldCenter: (b2Vec2 | null) = this.m_sweep!.c!.Copy();
      this.m_sweep!.localCenter!.SetV(massData!.center);
      this.m_sweep!.c0!.SetV(b2Math.MulX(this.m_xf, this.m_sweep!.localCenter));
      this.m_sweep!.c!.SetV(this.m_sweep!.c0);
      this.m_linearVelocity!.x += this.m_angularVelocity * (-(this.m_sweep!.c!.y - oldCenter!.y));
      this.m_linearVelocity!.y += this.m_angularVelocity * (+(this.m_sweep!.c!.x - oldCenter!.x));
   }
   ResetMassData(): void {
      this.m_mass = 0.0;
      this.m_invMass = 0.0;
      this.m_I = 0.0;
      this.m_invI = 0.0;
      this.m_sweep!.localCenter!.SetZero();
      if (this.m_type == b2Body.b2_staticBody || this.m_type == b2Body.b2_kinematicBody) {
         return;
      }
      var center: (b2Vec2 | null) = b2Vec2.Make(0, 0);
      for (var f: (b2Fixture | null) = this.m_fixtureList; f; f = f!.m_next) {
         if (f!.m_density == 0.0) {
            continue;
         }
         var massData: (b2MassData | null) = f!.GetMassData();
         this.m_mass += massData!.mass;
         center!.x += massData!.center!.x * massData!.mass;
         center!.y += massData!.center!.y * massData!.mass;
         this.m_I += massData!.I;
      }
      if (this.m_mass > 0.0) {
         this.m_invMass = 1.0 / this.m_mass;
         center!.x *= this.m_invMass;
         center!.y *= this.m_invMass;
      }
      else {
         this.m_mass = 1.0;
         this.m_invMass = 1.0;
      }
      if (this.m_I > 0.0 && (this.m_flags & b2Body.e_fixedRotationFlag) == 0) {
         this.m_I -= this.m_mass * (center!.x * center!.x + center!.y * center!.y);
         this.m_I *= this.m_inertiaScale;
         b2Settings.b2Assert(this.m_I > 0);
         this.m_invI = 1.0 / this.m_I;
      }
      else {
         this.m_I = 0.0;
         this.m_invI = 0.0;
      }
      var oldCenter: (b2Vec2 | null) = this.m_sweep!.c!.Copy();
      this.m_sweep!.localCenter!.SetV(center);
      this.m_sweep!.c0!.SetV(b2Math.MulX(this.m_xf, this.m_sweep!.localCenter));
      this.m_sweep!.c!.SetV(this.m_sweep!.c0);
      this.m_linearVelocity!.x += this.m_angularVelocity * (-(this.m_sweep!.c!.y - oldCenter!.y));
      this.m_linearVelocity!.y += this.m_angularVelocity * (+(this.m_sweep!.c!.x - oldCenter!.x));
   }
   GetWorldPoint(localPoint: (b2Vec2 | null)): (b2Vec2 | null) {
      var A: (b2Mat22 | null) = this.m_xf!.R;
      var u: (b2Vec2 | null) = new b2Vec2(A!.col1!.x * localPoint!.x + A!.col2!.x * localPoint!.y, A!.col1!.y * localPoint!.x + A!.col2!.y * localPoint!.y);
      u!.x += this.m_xf!.position!.x;
      u!.y += this.m_xf!.position!.y;
      return u;
   }
   GetWorldVector(localVector: (b2Vec2 | null)): (b2Vec2 | null) {
      return b2Math.MulMV(this.m_xf!.R, localVector);
   }
   GetLocalPoint(worldPoint: (b2Vec2 | null)): (b2Vec2 | null) {
      return b2Math.MulXT(this.m_xf, worldPoint);
   }
   GetLocalVector(worldVector: (b2Vec2 | null)): (b2Vec2 | null) {
      return b2Math.MulTMV(this.m_xf!.R, worldVector);
   }
   GetLinearVelocityFromWorldPoint(worldPoint: (b2Vec2 | null)): (b2Vec2 | null) {
      return new b2Vec2(this.m_linearVelocity!.x - this.m_angularVelocity * (worldPoint!.y - this.m_sweep!.c!.y), this.m_linearVelocity!.y + this.m_angularVelocity * (worldPoint!.x - this.m_sweep!.c!.x));
   }
   GetLinearVelocityFromLocalPoint(localPoint: (b2Vec2 | null)): (b2Vec2 | null) {
      var A: (b2Mat22 | null) = this.m_xf!.R;
      var worldPoint: (b2Vec2 | null) = new b2Vec2(A!.col1!.x * localPoint!.x + A!.col2!.x * localPoint!.y, A!.col1!.y * localPoint!.x + A!.col2!.y * localPoint!.y);
      worldPoint!.x += this.m_xf!.position!.x;
      worldPoint!.y += this.m_xf!.position!.y;
      return new b2Vec2(this.m_linearVelocity!.x - this.m_angularVelocity * (worldPoint!.y - this.m_sweep!.c!.y), this.m_linearVelocity!.y + this.m_angularVelocity * (worldPoint!.x - this.m_sweep!.c!.x));
   }
   GetLinearDamping(): number {
      return this.m_linearDamping;
   }
   SetLinearDamping(linearDamping: number): void {
      if (linearDamping === undefined) linearDamping = 0;
      this.m_linearDamping = linearDamping;
   }
   GetAngularDamping(): number {
      return this.m_angularDamping;
   }
   SetAngularDamping(angularDamping: number): void {
      if (angularDamping === undefined) angularDamping = 0;
      this.m_angularDamping = angularDamping;
   }
   SetType(type: number): void {
      if (type === undefined) type = 0;
      if (this.m_type == type) {
         return;
      }
      this.m_type = type;
      this.ResetMassData();
      if (this.m_type == b2Body.b2_staticBody) {
         this.m_linearVelocity!.SetZero();
         this.m_angularVelocity = 0.0;
      }
      this.SetAwake(true);
      this.m_force!.SetZero();
      this.m_torque = 0.0;
      for (var ce: (b2ContactEdge | null) = this.m_contactList; ce; ce = ce!.next) {
         ce!.contact!.FlagForFiltering();
      }
   }
   GetType(): number {
      return this.m_type;
   }
   SetBullet(flag: boolean): void {
      if (flag) {
         this.m_flags |= b2Body.e_bulletFlag;
      }
      else {
         this.m_flags &= ~b2Body.e_bulletFlag;
      }
   }
   IsBullet(): boolean {
      return (this.m_flags & b2Body.e_bulletFlag) == b2Body.e_bulletFlag;
   }
   SetSleepingAllowed(flag: boolean): void {
      if (flag) {
         this.m_flags |= b2Body.e_allowSleepFlag;
      }
      else {
         this.m_flags &= ~b2Body.e_allowSleepFlag;
         this.SetAwake(true);
      }
   }
   SetAwake(flag: boolean): void {
      if (flag) {
         this.m_flags |= b2Body.e_awakeFlag;
         this.m_sleepTime = 0.0;
      }
      else {
         this.m_flags &= ~b2Body.e_awakeFlag;
         this.m_sleepTime = 0.0;
         this.m_linearVelocity!.SetZero();
         this.m_angularVelocity = 0.0;
         this.m_force!.SetZero();
         this.m_torque = 0.0;
      }
   }
   IsAwake(): boolean {
      return (this.m_flags & b2Body.e_awakeFlag) == b2Body.e_awakeFlag;
   }
   SetFixedRotation(fixed: boolean): void {
      if (fixed) {
         this.m_flags |= b2Body.e_fixedRotationFlag;
      }
      else {
         this.m_flags &= ~b2Body.e_fixedRotationFlag;
      }
      this.ResetMassData();
   }
   IsFixedRotation(): boolean {
      return (this.m_flags & b2Body.e_fixedRotationFlag) == b2Body.e_fixedRotationFlag;
   }
   SetActive(flag: boolean): void {
      if (flag == this.IsActive()) {
         return;
      }
      var broadPhase: (b2DynamicTreeBroadPhase | null) | undefined;
      var f: (b2Fixture | null) | undefined;
      if (flag) {
         this.m_flags |= b2Body.e_activeFlag;
         broadPhase = this.m_world!.m_contactManager!.m_broadPhase;
         for (f = this.m_fixtureList;
         f; f = f!.m_next) {
            f!.CreateProxy(broadPhase, this.m_xf);
         }
      }
      else {
         this.m_flags &= ~b2Body.e_activeFlag;
         broadPhase = this.m_world!.m_contactManager!.m_broadPhase;
         for (f = this.m_fixtureList;
         f; f = f!.m_next) {
            f!.DestroyProxy(broadPhase);
         }
         var ce: (b2ContactEdge | null) = this.m_contactList;
         while (ce) {
            var ce0: (b2ContactEdge | null) = ce;
            ce = ce!.next;
            this.m_world!.m_contactManager!.Destroy(ce0!.contact);
         }
         this.m_contactList = null;
      }
   }
   IsActive(): boolean {
      return (this.m_flags & b2Body.e_activeFlag) == b2Body.e_activeFlag;
   }
   IsSleepingAllowed(): boolean {
      return (this.m_flags & b2Body.e_allowSleepFlag) == b2Body.e_allowSleepFlag;
   }
   GetFixtureList(): (b2Fixture | null) {
      return this.m_fixtureList;
   }
   GetJointList(): (b2JointEdge | null) {
      return this.m_jointList;
   }
   GetControllerList(): (b2ControllerEdge | null) {
      return this.m_controllerList;
   }
   GetContactList(): (b2ContactEdge | null) {
      return this.m_contactList;
   }
   GetNext(): (b2Body | null) {
      return this.m_next;
   }
   GetUserData(): unknown {
      return this.m_userData;
   }
   SetUserData(data: unknown): void {
      this.m_userData = data;
   }
   GetWorld(): (b2World | null) {
      return this.m_world;
   }
   b2Body(bd: (b2BodyDef | null), world: (b2World | null)): void {
      this.m_flags = 0;
      if (bd!.bullet) {
         this.m_flags |= b2Body.e_bulletFlag;
      }
      if (bd!.fixedRotation) {
         this.m_flags |= b2Body.e_fixedRotationFlag;
      }
      if (bd!.allowSleep) {
         this.m_flags |= b2Body.e_allowSleepFlag;
      }
      if (bd!.awake) {
         this.m_flags |= b2Body.e_awakeFlag;
      }
      if (bd!.active) {
         this.m_flags |= b2Body.e_activeFlag;
      }
      this.m_world = world;
      this.m_xf!.position!.SetV(bd!.position);
      this.m_xf!.R!.Set(bd!.angle);
      this.m_sweep!.localCenter!.SetZero();
      this.m_sweep!.t0 = 1.0;
      this.m_sweep!.a0 = this.m_sweep!.a = bd!.angle;
      var tMat: (b2Mat22 | null) = this.m_xf!.R;
      var tVec: (b2Vec2 | null) = this.m_sweep!.localCenter;
      this.m_sweep!.c!.x = (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      this.m_sweep!.c!.y = (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      this.m_sweep!.c!.x += this.m_xf!.position!.x;
      this.m_sweep!.c!.y += this.m_xf!.position!.y;
      this.m_sweep!.c0!.SetV(this.m_sweep!.c);
      this.m_jointList = null;
      this.m_controllerList = null;
      this.m_contactList = null;
      this.m_controllerCount = 0;
      this.m_prev = null;
      this.m_next = null;
      this.m_linearVelocity!.SetV(bd!.linearVelocity);
      this.m_angularVelocity = bd!.angularVelocity;
      this.m_linearDamping = bd!.linearDamping;
      this.m_angularDamping = bd!.angularDamping;
      this.m_force!.Set(0.0, 0.0);
      this.m_torque = 0.0;
      this.m_sleepTime = 0.0;
      this.m_type = bd!.type;
      if (this.m_type == b2Body.b2_dynamicBody) {
         this.m_mass = 1.0;
         this.m_invMass = 1.0;
      }
      else {
         this.m_mass = 0.0;
         this.m_invMass = 0.0;
      }
      this.m_I = 0.0;
      this.m_invI = 0.0;
      this.m_inertiaScale = bd!.inertiaScale;
      this.m_userData = bd!.userData;
      this.m_fixtureList = null;
      this.m_fixtureCount = 0;
   }
   SynchronizeFixtures(): void {
      var xf1: (b2Transform | null) = b2Body.s_xf1;
      xf1!.R!.Set(this.m_sweep!.a0);
      var tMat: (b2Mat22 | null) = xf1!.R;
      var tVec: (b2Vec2 | null) = this.m_sweep!.localCenter;
      xf1!.position!.x = this.m_sweep!.c0!.x - (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      xf1!.position!.y = this.m_sweep!.c0!.y - (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
      var f: (b2Fixture | null) | undefined;
      var broadPhase: (b2DynamicTreeBroadPhase | null) = this.m_world!.m_contactManager!.m_broadPhase;
      for (f = this.m_fixtureList;
      f; f = f!.m_next) {
         f!.Synchronize(broadPhase, xf1, this.m_xf);
      }
   }
   SynchronizeTransform(): void {
      this.m_xf!.R!.Set(this.m_sweep!.a);
      var tMat: (b2Mat22 | null) = this.m_xf!.R;
      var tVec: (b2Vec2 | null) = this.m_sweep!.localCenter;
      this.m_xf!.position!.x = this.m_sweep!.c!.x - (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
      this.m_xf!.position!.y = this.m_sweep!.c!.y - (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
   }
   ShouldCollide(other: (b2Body | null)): boolean {
      if (this.m_type != b2Body.b2_dynamicBody && other!.m_type != b2Body.b2_dynamicBody) {
         return false;
      }
      for (var jn: (b2JointEdge | null) = this.m_jointList; jn; jn = jn!.next) {
         if (jn!.other == other) if (jn!.joint!.m_collideConnected == false) {
            return false;
         }
      }
      return true;
   }
   Advance(t: number): void {
      if (t === undefined) t = 0;
      this.m_sweep!.Advance(t);
      this.m_sweep!.c!.SetV(this.m_sweep!.c0);
      this.m_sweep!.a = this.m_sweep!.a0;
      this.SynchronizeTransform();
   }
}

class b2BodyDef {
   declare type: number;
   declare position: (b2Vec2 | null);
   declare angle: number;
   declare linearVelocity: (b2Vec2 | null);
   declare angularVelocity: number;
   declare linearDamping: number;
   declare angularDamping: number;
   declare allowSleep: boolean;
   declare awake: boolean;
   declare fixedRotation: boolean;
   declare bullet: boolean;
   declare active: boolean;
   declare userData: unknown;
   declare inertiaScale: number;

   constructor() {

      this.position = new b2Vec2();
      this.linearVelocity = new b2Vec2();

      if (new.target === b2BodyDef) this.b2BodyDef();
   }
   b2BodyDef(): void {
      this.userData = null;
      this.position!.Set(0.0, 0.0);
      this.angle = 0.0;
      this.linearVelocity!.Set(0, 0);
      this.angularVelocity = 0.0;
      this.linearDamping = 0.0;
      this.angularDamping = 0.0;
      this.allowSleep = true;
      this.awake = true;
      this.fixedRotation = false;
      this.bullet = false;
      this.type = b2Body.b2_staticBody;
      this.active = true;
      this.inertiaScale = 1.0;
   }
}

class b2ContactFilter {
   declare static b2_defaultFilter: (b2ContactFilter | null);

   constructor() {

   }
   ShouldCollide(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): boolean {
      var filter1: (b2FilterData | null) = fixtureA!.GetFilterData();
      var filter2: (b2FilterData | null) = fixtureB!.GetFilterData();
      if (filter1!.groupIndex == filter2!.groupIndex && filter1!.groupIndex != 0) {
         return filter1!.groupIndex > 0;
      }
      var collide: boolean = (filter1!.maskBits & filter2!.categoryBits) != 0 && (filter1!.categoryBits & filter2!.maskBits) != 0;
      return collide;
   }
   RayCollide(userData: unknown, fixture: (b2Fixture | null)): boolean {
      if (!userData) return true;
      return this.ShouldCollide((userData instanceof b2Fixture ? (userData) : null), fixture);
   }
}

class b2ContactImpulse {
   declare normalImpulses: Array<number>;
   declare tangentImpulses: Array<number>;

   constructor() {

      this.normalImpulses = numberVector(b2Settings.b2_maxManifoldPoints);
      this.tangentImpulses = numberVector(b2Settings.b2_maxManifoldPoints);

   }
}

class b2ContactListener {
   declare static b2_defaultListener: (b2ContactListener | null);

   constructor() {

   }
   BeginContact(contact: (b2Contact | null)): void {}
   EndContact(contact: (b2Contact | null)): void {}
   PreSolve(contact: (b2Contact | null), oldManifold: (b2Manifold | null)): void {}
   PostSolve(contact: (b2Contact | null), impulse: (b2ContactImpulse | null)): void {}
}

class b2ContactManager {
   declare static s_evalCP: (b2ContactPoint | null);
   declare m_world: (b2World | null);
   declare m_broadPhase: (b2DynamicTreeBroadPhase | null);
   declare m_contactList: (b2Contact | null);
   declare m_contactCount: number;
   declare m_contactFilter: (b2ContactFilter | null);
   declare m_contactListener: (b2ContactListener | null);
   declare m_contactFactory: (b2ContactFactory | null);
   declare m_allocator: unknown;

   constructor() {

      if (new.target === b2ContactManager) this.b2ContactManager();
   }
   b2ContactManager(): void {
      this.m_world = null;
      this.m_contactCount = 0;
      this.m_contactFilter = b2ContactFilter.b2_defaultFilter;
      this.m_contactListener = b2ContactListener.b2_defaultListener;
      this.m_contactFactory = new b2ContactFactory(this.m_allocator);
      this.m_broadPhase = new b2DynamicTreeBroadPhase();
   }
   AddPair(proxyUserDataA: unknown, proxyUserDataB: unknown): void {
      var fixtureA: (b2Fixture | null) = (proxyUserDataA instanceof b2Fixture ? (proxyUserDataA) : null);
      var fixtureB: (b2Fixture | null) = (proxyUserDataB instanceof b2Fixture ? (proxyUserDataB) : null);
      var bodyA: (b2Body | null) = fixtureA!.GetBody();
      var bodyB: (b2Body | null) = fixtureB!.GetBody();
      if (bodyA == bodyB) return;
      var edge: (b2ContactEdge | null) = bodyB!.GetContactList();
      while (edge) {
         if (edge!.other == bodyA) {
            var fA: (b2Fixture | null) = edge!.contact!.GetFixtureA();
            var fB: (b2Fixture | null) = edge!.contact!.GetFixtureB();
            if (fA == fixtureA && fB == fixtureB) return;
            if (fA == fixtureB && fB == fixtureA) return;
         }
         edge = edge!.next;
      }
      if (bodyB!.ShouldCollide(bodyA) == false) {
         return;
      }
      if (this.m_contactFilter!.ShouldCollide(fixtureA, fixtureB) == false) {
         return;
      }
      var c: (b2Contact | null) = this.m_contactFactory!.Create(fixtureA, fixtureB);
      fixtureA = c!.GetFixtureA();
      fixtureB = c!.GetFixtureB();
      bodyA = fixtureA!.m_body;
      bodyB = fixtureB!.m_body;
      c!.m_prev = null;
      c!.m_next = this.m_world!.m_contactList;
      if (this.m_world!.m_contactList != null) {
         this.m_world!.m_contactList!.m_prev = c;
      }
      this.m_world!.m_contactList = c;
      c!.m_nodeA!.contact = c;
      c!.m_nodeA!.other = bodyB;
      c!.m_nodeA!.prev = null;
      c!.m_nodeA!.next = bodyA!.m_contactList;
      if (bodyA!.m_contactList != null) {
         bodyA!.m_contactList!.prev = c!.m_nodeA;
      }
      bodyA!.m_contactList = c!.m_nodeA;
      c!.m_nodeB!.contact = c;
      c!.m_nodeB!.other = bodyA;
      c!.m_nodeB!.prev = null;
      c!.m_nodeB!.next = bodyB!.m_contactList;
      if (bodyB!.m_contactList != null) {
         bodyB!.m_contactList!.prev = c!.m_nodeB;
      }
      bodyB!.m_contactList = c!.m_nodeB;
      ++this.m_world!.m_contactCount;
      return;
   }
   FindNewContacts(): void {
      this.m_broadPhase!.UpdatePairs(this.AddPair.bind(this));
   }
   Destroy(c: (b2Contact | null)): void {
      var fixtureA: (b2Fixture | null) = c!.GetFixtureA();
      var fixtureB: (b2Fixture | null) = c!.GetFixtureB();
      var bodyA: (b2Body | null) = fixtureA!.GetBody();
      var bodyB: (b2Body | null) = fixtureB!.GetBody();
      if (c!.IsTouching()) {
         this.m_contactListener!.EndContact(c);
      }
      if (c!.m_prev) {
         c!.m_prev!.m_next = c!.m_next;
      }
      if (c!.m_next) {
         c!.m_next!.m_prev = c!.m_prev;
      }
      if (c == this.m_world!.m_contactList) {
         this.m_world!.m_contactList = c!.m_next;
      }
      if (c!.m_nodeA!.prev) {
         c!.m_nodeA!.prev!.next = c!.m_nodeA!.next;
      }
      if (c!.m_nodeA!.next) {
         c!.m_nodeA!.next!.prev = c!.m_nodeA!.prev;
      }
      if (c!.m_nodeA == bodyA!.m_contactList) {
         bodyA!.m_contactList = c!.m_nodeA!.next;
      }
      if (c!.m_nodeB!.prev) {
         c!.m_nodeB!.prev!.next = c!.m_nodeB!.next;
      }
      if (c!.m_nodeB!.next) {
         c!.m_nodeB!.next!.prev = c!.m_nodeB!.prev;
      }
      if (c!.m_nodeB == bodyB!.m_contactList) {
         bodyB!.m_contactList = c!.m_nodeB!.next;
      }
      this.m_contactFactory!.Destroy(c);
      --this.m_contactCount;
   }
   Collide(): void {
      var c: (b2Contact | null) = this.m_world!.m_contactList;
      while (c) {
         var fixtureA: (b2Fixture | null) = c!.GetFixtureA();
         var fixtureB: (b2Fixture | null) = c!.GetFixtureB();
         var bodyA: (b2Body | null) = fixtureA!.GetBody();
         var bodyB: (b2Body | null) = fixtureB!.GetBody();
         if (bodyA!.IsAwake() == false && bodyB!.IsAwake() == false) {
            c = c!.GetNext();
            continue;
         }
         if (c!.m_flags & b2Contact.e_filterFlag) {
            if (bodyB!.ShouldCollide(bodyA) == false) {
               var cNuke: (b2Contact | null) = c;
               c = cNuke!.GetNext();
               this.Destroy(cNuke);
               continue;
            }
            if (this.m_contactFilter!.ShouldCollide(fixtureA, fixtureB) == false) {
               cNuke = c;
               c = cNuke!.GetNext();
               this.Destroy(cNuke);
               continue;
            }
            c!.m_flags &= ~b2Contact.e_filterFlag;
         }
         var proxyA = fixtureA!.m_proxy;
         var proxyB = fixtureB!.m_proxy;
         var overlap: boolean = this.m_broadPhase!.TestOverlap(proxyA, proxyB);
         if (overlap == false) {
            cNuke = c;
            c = cNuke!.GetNext();
            this.Destroy(cNuke);
            continue;
         }
         c!.Update(this.m_contactListener);
         c = c!.GetNext();
      }
   }
}

class b2DebugDraw {
   declare static e_shapeBit: number;
   declare static e_jointBit: number;
   declare static e_aabbBit: number;
   declare static e_pairBit: number;
   declare static e_centerOfMassBit: number;
   declare static e_controllerBit: number;
   declare m_drawFlags: number;
   declare m_sprite: DebugSprite;
   declare m_drawScale: number;
   declare m_lineThickness: number;
   declare m_alpha: number;
   declare m_fillAlpha: number;
   declare m_xformScale: number;
   declare m_ctx: DebugCanvas;

   constructor() {

      this.m_drawScale = 1.0;
      this.m_lineThickness = 1.0;
      this.m_alpha = 1.0;
      this.m_fillAlpha = 1.0;
      this.m_xformScale = 1.0;
      var __this: b2DebugDraw = this;
      //#WORKAROUND
      this.m_sprite = {
         graphics: {
            clear: function () {
               __this!.m_ctx!.clearRect(0, 0, __this!.m_ctx!.canvas!.width, __this!.m_ctx!.canvas!.height)
            }
         }
      };

      if (new.target === b2DebugDraw) this.b2DebugDraw();
   }
   b2DebugDraw(): void {
      this.m_drawFlags = 0;
   }
   SetFlags(flags: number): void {
      if (flags === undefined) flags = 0;
      this.m_drawFlags = flags;
   }
   GetFlags(): number {
      return this.m_drawFlags;
   }
   AppendFlags(flags: number): void {
      if (flags === undefined) flags = 0;
      this.m_drawFlags |= flags;
   }
   ClearFlags(flags: number): void {
      if (flags === undefined) flags = 0;
      this.m_drawFlags &= ~flags;
   }
   SetSprite(sprite: DebugCanvas): void {
      this.m_ctx = sprite;
   }
   GetSprite(): DebugCanvas {
      return this.m_ctx;
   }
   SetDrawScale(drawScale: number): void {
      if (drawScale === undefined) drawScale = 0;
      this.m_drawScale = drawScale;
   }
   GetDrawScale(): number {
      return this.m_drawScale;
   }
   SetLineThickness(lineThickness: number): void {
      if (lineThickness === undefined) lineThickness = 0;
      this.m_lineThickness = lineThickness;
      this.m_ctx!.strokeWidth = lineThickness;
   }
   GetLineThickness(): number {
      return this.m_lineThickness;
   }
   SetAlpha(alpha: number): void {
      if (alpha === undefined) alpha = 0;
      this.m_alpha = alpha;
   }
   GetAlpha(): number {
      return this.m_alpha;
   }
   SetFillAlpha(alpha: number): void {
      if (alpha === undefined) alpha = 0;
      this.m_fillAlpha = alpha;
   }
   GetFillAlpha(): number {
      return this.m_fillAlpha;
   }
   SetXFormScale(xformScale: number): void {
      if (xformScale === undefined) xformScale = 0;
      this.m_xformScale = xformScale;
   }
   GetXFormScale(): number {
      return this.m_xformScale;
   }
   DrawPolygon(vertices: Array<b2Vec2 | null>, vertexCount: number, color: (b2Color | null)): void {
      if (!vertexCount) return;
      var s = this.m_ctx;
      var drawScale = this.m_drawScale;
      s!.beginPath();
      s!.strokeStyle = this._color(color!.color, this.m_alpha);
      s!.moveTo(vertices![0]!.x * drawScale, vertices![0]!.y * drawScale);
      for (var i: number = 1; i < vertexCount; i++) {
         s!.lineTo(vertices![i]!.x * drawScale, vertices![i]!.y * drawScale);
      }
      s!.lineTo(vertices![0]!.x * drawScale, vertices![0]!.y * drawScale);
      s!.closePath();
      s!.stroke();
   }
   DrawSolidPolygon(vertices: Array<(b2Vec2 | null)>, vertexCount: number, color: (b2Color | null)): void {
      if (!vertexCount) return;
      var s = this.m_ctx;
      var drawScale = this.m_drawScale;
      s!.beginPath();
      s!.strokeStyle = this._color(color!.color, this.m_alpha);
      s!.fillStyle = this._color(color!.color, this.m_fillAlpha);
      s!.moveTo(vertices![0]!.x * drawScale, vertices![0]!.y * drawScale);
      for (var i: number = 1; i < vertexCount; i++) {
         s!.lineTo(vertices![i]!.x * drawScale, vertices![i]!.y * drawScale);
      }
      s!.lineTo(vertices![0]!.x * drawScale, vertices![0]!.y * drawScale);
      s!.closePath();
      s!.fill();
      s!.stroke();
   }
   DrawCircle(center: (b2Vec2 | null), radius: number, color: (b2Color | null)): void {
      if (!radius) return;
      var s = this.m_ctx;
      var drawScale = this.m_drawScale;
      s!.beginPath();
      s!.strokeStyle = this._color(color!.color, this.m_alpha);
      s!.arc(center!.x * drawScale, center!.y * drawScale, radius * drawScale, 0, Math.PI * 2, true);
      s!.closePath();
      s!.stroke();
   }
   DrawSolidCircle(center: (b2Vec2 | null), radius: number, axis: (b2Vec2 | null), color: (b2Color | null)): void {
      if (!radius) return;
      var s = this.m_ctx,
         drawScale = this.m_drawScale,
         cx = center!.x * drawScale,
         cy = center!.y * drawScale;
      s!.moveTo(0, 0);
      s!.beginPath();
      s!.strokeStyle = this._color(color!.color, this.m_alpha);
      s!.fillStyle = this._color(color!.color, this.m_fillAlpha);
      s!.arc(cx, cy, radius * drawScale, 0, Math.PI * 2, true);
      s!.moveTo(cx, cy);
      s!.lineTo((center!.x + axis!.x * radius) * drawScale, (center!.y + axis!.y * radius) * drawScale);
      s!.closePath();
      s!.fill();
      s!.stroke();
   }
   DrawSegment(p1: (b2Vec2 | null), p2: (b2Vec2 | null), color: (b2Color | null)): void {
      var s = this.m_ctx,
         drawScale = this.m_drawScale;
      s!.strokeStyle = this._color(color!.color, this.m_alpha);
      s!.beginPath();
      s!.moveTo(p1!.x * drawScale, p1!.y * drawScale);
      s!.lineTo(p2!.x * drawScale, p2!.y * drawScale);
      s!.closePath();
      s!.stroke();
   }
   DrawTransform(xf: (b2Transform | null)): void {
      var s = this.m_ctx,
         drawScale = this.m_drawScale;
      s!.beginPath();
      s!.strokeStyle = this._color(0xff0000, this.m_alpha);
      s!.moveTo(xf!.position!.x * drawScale, xf!.position!.y * drawScale);
      s!.lineTo((xf!.position!.x + this.m_xformScale * xf!.R!.col1!.x) * drawScale, (xf!.position!.y + this.m_xformScale * xf!.R!.col1!.y) * drawScale);

      s!.strokeStyle = this._color(0xff00, this.m_alpha);
      s!.moveTo(xf!.position!.x * drawScale, xf!.position!.y * drawScale);
      s!.lineTo((xf!.position!.x + this.m_xformScale * xf!.R!.col2!.x) * drawScale, (xf!.position!.y + this.m_xformScale * xf!.R!.col2!.y) * drawScale);
      s!.closePath();
      s!.stroke();
   }
   _color(color: number, alpha: number): string {
      return "rgba(" + ((color & 0xFF0000) >> 16) + "," + ((color & 0xFF00) >> 8) + "," + (color & 0xFF) + "," + alpha + ")";
   }
}

class b2DestructionListener {

   constructor() {

   }
   SayGoodbyeJoint(joint: (b2Joint | null)): void {}
   SayGoodbyeFixture(fixture: (b2Fixture | null)): void {}
}

class b2FilterData {
   declare categoryBits: number;
   declare maskBits: number;
   declare groupIndex: number;

   constructor() {

      this.categoryBits = 0x0001;
      this.maskBits = 0xFFFF;
      this.groupIndex = 0;

   }
   Copy(): (b2FilterData | null) {
      var copy: (b2FilterData | null) = new b2FilterData();
      copy!.categoryBits = this.categoryBits;
      copy!.maskBits = this.maskBits;
      copy!.groupIndex = this.groupIndex;
      return copy;
   }
}

class b2Fixture {
   declare m_massData: (b2MassData | null);
   declare m_aabb: (b2AABB | null);
   declare m_density: number;
   declare m_next: (b2Fixture | null);
   declare m_body: (b2Body | null);
   declare m_shape: (b2Shape | null);
   declare m_friction: number;
   declare m_restitution: number;
   declare m_proxy: b2DynamicTreeNode | null;
   declare m_filter: (b2FilterData | null);
   declare m_isSensor: boolean;
   declare m_userData: unknown;

   constructor() {

      this.m_filter = new b2FilterData();

      if (new.target === b2Fixture) this.b2Fixture();
   }
   GetType(): number {
      return this.m_shape!.GetType();
   }
   GetShape(): (b2Shape | null) {
      return this.m_shape;
   }
   SetSensor(sensor: boolean): void {
      if (this.m_isSensor == sensor) return;
      this.m_isSensor = sensor;
      if (this.m_body == null) return;
      var edge: (b2ContactEdge | null) = this.m_body!.GetContactList();
      while (edge) {
         var contact: (b2Contact | null) = edge!.contact;
         var fixtureA: (b2Fixture | null) = contact!.GetFixtureA();
         var fixtureB: (b2Fixture | null) = contact!.GetFixtureB();
         if (fixtureA == this || fixtureB == this) contact!.SetSensor(fixtureA!.IsSensor() || fixtureB!.IsSensor());
         edge = edge!.next;
      }
   }
   IsSensor(): boolean {
      return this.m_isSensor;
   }
   SetFilterData(filter: (b2FilterData | null)): void {
      this.m_filter = filter!.Copy();
      if (this.m_body) return;
      var edge: (b2ContactEdge | null) = this.m_body!.GetContactList();
      while (edge) {
         var contact: (b2Contact | null) = edge!.contact;
         var fixtureA: (b2Fixture | null) = contact!.GetFixtureA();
         var fixtureB: (b2Fixture | null) = contact!.GetFixtureB();
         if (fixtureA == this || fixtureB == this) contact!.FlagForFiltering();
         edge = edge!.next;
      }
   }
   GetFilterData(): (b2FilterData | null) {
      return this.m_filter!.Copy();
   }
   GetBody(): (b2Body | null) {
      return this.m_body;
   }
   GetNext(): (b2Fixture | null) {
      return this.m_next;
   }
   GetUserData(): unknown {
      return this.m_userData;
   }
   SetUserData(data: unknown): void {
      this.m_userData = data;
   }
   TestPoint(p: (b2Vec2 | null)): boolean {
      return this.m_shape!.TestPoint(this.m_body!.GetTransform(), p);
   }
   RayCast(output: (b2RayCastOutput | null), input: (b2RayCastInput | null)): boolean {
      return this.m_shape!.RayCast(output, input, this.m_body!.GetTransform());
   }
   GetMassData(massData: (b2MassData | null) = null): (b2MassData | null) {
      if (massData === undefined) massData = null;
      if (massData == null) {
         massData = new b2MassData();
      }
      this.m_shape!.ComputeMass(massData, this.m_density);
      return massData;
   }
   SetDensity(density: number): void {
      if (density === undefined) density = 0;
      this.m_density = density;
   }
   GetDensity(): number {
      return this.m_density;
   }
   GetFriction(): number {
      return this.m_friction;
   }
   SetFriction(friction: number): void {
      if (friction === undefined) friction = 0;
      this.m_friction = friction;
   }
   GetRestitution(): number {
      return this.m_restitution;
   }
   SetRestitution(restitution: number): void {
      if (restitution === undefined) restitution = 0;
      this.m_restitution = restitution;
   }
   GetAABB(): (b2AABB | null) {
      return this.m_aabb;
   }
   b2Fixture(): void {
      this.m_aabb = new b2AABB();
      this.m_userData = null;
      this.m_body = null;
      this.m_next = null;
      this.m_shape = null;
      this.m_density = 0.0;
      this.m_friction = 0.0;
      this.m_restitution = 0.0;
   }
   Create(body: (b2Body | null), xf: (b2Transform | null), def: (b2FixtureDef | null)): void {
      this.m_userData = def!.userData;
      this.m_friction = def!.friction;
      this.m_restitution = def!.restitution;
      this.m_body = body;
      this.m_next = null;
      this.m_filter = def!.filter!.Copy();
      this.m_isSensor = def!.isSensor;
      this.m_shape = def!.shape!.Copy();
      this.m_density = def!.density;
   }
   Destroy(): void {
      this.m_shape = null;
   }
   CreateProxy(broadPhase: (b2DynamicTreeBroadPhase | null), xf: (b2Transform | null)): void {
      this.m_shape!.ComputeAABB(this.m_aabb, xf);
      this.m_proxy = broadPhase!.CreateProxy(this.m_aabb, this);
   }
   DestroyProxy(broadPhase: (b2DynamicTreeBroadPhase | null)): void {
      if (this.m_proxy == null) {
         return;
      }
      broadPhase!.DestroyProxy(this.m_proxy);
      this.m_proxy = null;
   }
   Synchronize(broadPhase: (b2DynamicTreeBroadPhase | null), transform1: (b2Transform | null), transform2: (b2Transform | null)): void {
      if (!this.m_proxy) return;
      var aabb1: (b2AABB | null) = new b2AABB();
      var aabb2: (b2AABB | null) = new b2AABB();
      this.m_shape!.ComputeAABB(aabb1, transform1);
      this.m_shape!.ComputeAABB(aabb2, transform2);
      this.m_aabb!.Combine(aabb1, aabb2);
      var displacement: (b2Vec2 | null) = b2Math.SubtractVV(transform2!.position, transform1!.position);
      broadPhase!.MoveProxy(this.m_proxy, this.m_aabb, displacement);
   }
}

class b2FixtureDef {
   declare shape: (b2Shape | null);
   declare userData: unknown;
   declare friction: number;
   declare restitution: number;
   declare density: number;
   declare isSensor: boolean;
   declare filter: (b2FilterData | null);

   constructor() {

      this.filter = new b2FilterData();

      if (new.target === b2FixtureDef) this.b2FixtureDef();
   }
   b2FixtureDef(): void {
      this.shape = null;
      this.userData = null;
      this.friction = 0.2;
      this.restitution = 0.0;
      this.density = 0.0;
      this.filter!.categoryBits = 0x0001;
      this.filter!.maskBits = 0xFFFF;
      this.filter!.groupIndex = 0;
      this.isSensor = false;
   }
}

class b2Island {
   declare static s_impulse: (b2ContactImpulse | null);
   declare m_allocator: unknown;
   declare m_listener: (b2ContactListener | null);
   declare m_contactSolver: (b2ContactSolver | null);
   declare m_bodies: Array<(b2Body | null)>;
   declare m_contacts: Array<(b2Contact | null)>;
   declare m_joints: Array<(b2Joint | null)>;
   declare m_bodyCount: number;
   declare m_jointCount: number;
   declare m_contactCount: number;
   declare m_bodyCapacity: number;
   declare m_contactCapacity: number;
   declare m_jointCapacity: number;

   constructor() {

      if (new.target === b2Island) this.b2Island();
   }
   b2Island(): void {
      this.m_bodies = new Array<(b2Body | null)>();
      this.m_contacts = new Array<(b2Contact | null)>();
      this.m_joints = new Array<(b2Joint | null)>();
   }
   Initialize(bodyCapacity: number, contactCapacity: number, jointCapacity: number, allocator: unknown, listener: (b2ContactListener | null), contactSolver: (b2ContactSolver | null)): void {
      if (bodyCapacity === undefined) bodyCapacity = 0;
      if (contactCapacity === undefined) contactCapacity = 0;
      if (jointCapacity === undefined) jointCapacity = 0;
      var i: number = 0;
      this.m_bodyCapacity = bodyCapacity;
      this.m_contactCapacity = contactCapacity;
      this.m_jointCapacity = jointCapacity;
      this.m_bodyCount = 0;
      this.m_contactCount = 0;
      this.m_jointCount = 0;
      this.m_allocator = allocator;
      this.m_listener = listener;
      this.m_contactSolver = contactSolver;
      for (i = this.m_bodies!.length;
      i < bodyCapacity; i++)
      this.m_bodies![i] = null;
      for (i = this.m_contacts!.length;
      i < contactCapacity; i++)
      this.m_contacts![i] = null;
      for (i = this.m_joints!.length;
      i < jointCapacity; i++)
      this.m_joints![i] = null;
   }
   Clear(): void {
      this.m_bodyCount = 0;
      this.m_contactCount = 0;
      this.m_jointCount = 0;
   }
   Solve(step: (b2TimeStep | null), gravity: (b2Vec2 | null), allowSleep: boolean): void {
      var i: number = 0;
      var j: number = 0;
      var b: (b2Body | null) | undefined;
      var joint: (b2Joint | null) | undefined;
      for (i = 0;
      i < this.m_bodyCount; ++i) {
         b = this.m_bodies![i];
         if (b!.GetType() != b2Body.b2_dynamicBody) continue;
         b!.m_linearVelocity!.x += step!.dt * (gravity!.x + b!.m_invMass * b!.m_force!.x);
         b!.m_linearVelocity!.y += step!.dt * (gravity!.y + b!.m_invMass * b!.m_force!.y);
         b!.m_angularVelocity += step!.dt * b!.m_invI * b!.m_torque;
         b!.m_linearVelocity!.Multiply(b2Math.Clamp(1.0 - step!.dt * b!.m_linearDamping, 0.0, 1.0));
         b!.m_angularVelocity *= b2Math.Clamp(1.0 - step!.dt * b!.m_angularDamping, 0.0, 1.0);
      }
      this.m_contactSolver!.Initialize(step, this.m_contacts, this.m_contactCount, this.m_allocator);
      var contactSolver: (b2ContactSolver | null) = this.m_contactSolver;
      contactSolver!.InitVelocityConstraints(step);
      for (i = 0;
      i < this.m_jointCount; ++i) {
         joint = this.m_joints![i];
         joint!.InitVelocityConstraints(step);
      }
      for (i = 0;
      i < step!.velocityIterations; ++i) {
         for (j = 0;
         j < this.m_jointCount; ++j) {
            joint = this.m_joints![j];
            joint!.SolveVelocityConstraints(step);
         }
         contactSolver!.SolveVelocityConstraints();
      }
      for (i = 0;
      i < this.m_jointCount; ++i) {
         joint = this.m_joints![i];
         joint!.FinalizeVelocityConstraints();
      }
      contactSolver!.FinalizeVelocityConstraints();
      for (i = 0;
      i < this.m_bodyCount; ++i) {
         b = this.m_bodies![i];
         if (b!.GetType() == b2Body.b2_staticBody) continue;
         var translationX: number = step!.dt * b!.m_linearVelocity!.x;
         var translationY: number = step!.dt * b!.m_linearVelocity!.y;
         if ((translationX * translationX + translationY * translationY) > b2Settings.b2_maxTranslationSquared) {
            b!.m_linearVelocity!.Normalize();
            b!.m_linearVelocity!.x *= b2Settings.b2_maxTranslation * step!.inv_dt;
            b!.m_linearVelocity!.y *= b2Settings.b2_maxTranslation * step!.inv_dt;
         }
         var rotation: number = step!.dt * b!.m_angularVelocity;
         if (rotation * rotation > b2Settings.b2_maxRotationSquared) {
            if (b!.m_angularVelocity < 0.0) {
               b!.m_angularVelocity = (-b2Settings.b2_maxRotation * step!.inv_dt);
            }
            else {
               b!.m_angularVelocity = b2Settings.b2_maxRotation * step!.inv_dt;
            }
         }
         b!.m_sweep!.c0!.SetV(b!.m_sweep!.c);
         b!.m_sweep!.a0 = b!.m_sweep!.a;
         b!.m_sweep!.c!.x += step!.dt * b!.m_linearVelocity!.x;
         b!.m_sweep!.c!.y += step!.dt * b!.m_linearVelocity!.y;
         b!.m_sweep!.a += step!.dt * b!.m_angularVelocity;
         b!.SynchronizeTransform();
      }
      for (i = 0;
      i < step!.positionIterations; ++i) {
         var contactsOkay: boolean = contactSolver!.SolvePositionConstraints(b2Settings.b2_contactBaumgarte);
         var jointsOkay: boolean = true;
         for (j = 0;
         j < this.m_jointCount; ++j) {
            joint = this.m_joints![j];
            var jointOkay: boolean = joint!.SolvePositionConstraints(b2Settings.b2_contactBaumgarte);
            jointsOkay = jointsOkay && jointOkay;
         }
         if (contactsOkay && jointsOkay) {
            break;
         }
      }
      this.Report(contactSolver!.m_constraints);
      if (allowSleep) {
         var minSleepTime: number = Number.MAX_VALUE;
         var linTolSqr: number = b2Settings.b2_linearSleepTolerance * b2Settings.b2_linearSleepTolerance;
         var angTolSqr: number = b2Settings.b2_angularSleepTolerance * b2Settings.b2_angularSleepTolerance;
         for (i = 0;
         i < this.m_bodyCount; ++i) {
            b = this.m_bodies![i];
            if (b!.GetType() == b2Body.b2_staticBody) {
               continue;
            }
            if ((b!.m_flags & b2Body.e_allowSleepFlag) == 0) {
               b!.m_sleepTime = 0.0;
               minSleepTime = 0.0;
            }
            if ((b!.m_flags & b2Body.e_allowSleepFlag) == 0 || b!.m_angularVelocity * b!.m_angularVelocity > angTolSqr || b2Math.Dot(b!.m_linearVelocity, b!.m_linearVelocity) > linTolSqr) {
               b!.m_sleepTime = 0.0;
               minSleepTime = 0.0;
            }
            else {
               b!.m_sleepTime += step!.dt;
               minSleepTime = b2Math.Min(minSleepTime, b!.m_sleepTime);
            }
         }
         if (minSleepTime >= b2Settings.b2_timeToSleep) {
            for (i = 0;
            i < this.m_bodyCount; ++i) {
               b = this.m_bodies![i];
               b!.SetAwake(false);
            }
         }
      }
   }
   SolveTOI(subStep: (b2TimeStep | null)): void {
      var i: number = 0;
      var j: number = 0;
      this.m_contactSolver!.Initialize(subStep, this.m_contacts, this.m_contactCount, this.m_allocator);
      var contactSolver: (b2ContactSolver | null) = this.m_contactSolver;
      for (i = 0;
      i < this.m_jointCount; ++i) {
         this.m_joints![i]!.InitVelocityConstraints(subStep);
      }
      for (i = 0;
      i < subStep!.velocityIterations; ++i) {
         contactSolver!.SolveVelocityConstraints();
         for (j = 0;
         j < this.m_jointCount; ++j) {
            this.m_joints![j]!.SolveVelocityConstraints(subStep);
         }
      }
      for (i = 0;
      i < this.m_bodyCount; ++i) {
         var b: (b2Body | null) = this.m_bodies![i];
         if (b!.GetType() == b2Body.b2_staticBody) continue;
         var translationX: number = subStep!.dt * b!.m_linearVelocity!.x;
         var translationY: number = subStep!.dt * b!.m_linearVelocity!.y;
         if ((translationX * translationX + translationY * translationY) > b2Settings.b2_maxTranslationSquared) {
            b!.m_linearVelocity!.Normalize();
            b!.m_linearVelocity!.x *= b2Settings.b2_maxTranslation * subStep!.inv_dt;
            b!.m_linearVelocity!.y *= b2Settings.b2_maxTranslation * subStep!.inv_dt;
         }
         var rotation: number = subStep!.dt * b!.m_angularVelocity;
         if (rotation * rotation > b2Settings.b2_maxRotationSquared) {
            if (b!.m_angularVelocity < 0.0) {
               b!.m_angularVelocity = (-b2Settings.b2_maxRotation * subStep!.inv_dt);
            }
            else {
               b!.m_angularVelocity = b2Settings.b2_maxRotation * subStep!.inv_dt;
            }
         }
         b!.m_sweep!.c0!.SetV(b!.m_sweep!.c);
         b!.m_sweep!.a0 = b!.m_sweep!.a;
         b!.m_sweep!.c!.x += subStep!.dt * b!.m_linearVelocity!.x;
         b!.m_sweep!.c!.y += subStep!.dt * b!.m_linearVelocity!.y;
         b!.m_sweep!.a += subStep!.dt * b!.m_angularVelocity;
         b!.SynchronizeTransform();
      }
      var k_toiBaumgarte: number = 0.75;
      for (i = 0;
      i < subStep!.positionIterations; ++i) {
         var contactsOkay: boolean = contactSolver!.SolvePositionConstraints(k_toiBaumgarte);
         var jointsOkay: boolean = true;
         for (j = 0;
         j < this.m_jointCount; ++j) {
            var jointOkay: boolean = this.m_joints![j]!.SolvePositionConstraints(b2Settings.b2_contactBaumgarte);
            jointsOkay = jointsOkay && jointOkay;
         }
         if (contactsOkay && jointsOkay) {
            break;
         }
      }
      this.Report(contactSolver!.m_constraints);
   }
   Report(constraints: Array<(b2ContactConstraint | null)>): void {
      if (this.m_listener == null) {
         return;
      }
      for (var i: number = 0; i < this.m_contactCount; ++i) {
         var c: (b2Contact | null) = this.m_contacts![i];
         var cc: (b2ContactConstraint | null) = constraints![i];
         for (var j: number = 0; j < cc!.pointCount; ++j) {
            b2Island.s_impulse!.normalImpulses![j] = cc!.points![j]!.normalImpulse;
            b2Island.s_impulse!.tangentImpulses![j] = cc!.points![j]!.tangentImpulse;
         }
         this.m_listener!.PostSolve(c, b2Island.s_impulse);
      }
   }
   AddBody(body: (b2Body | null)): void {
      body!.m_islandIndex = this.m_bodyCount;
      this.m_bodies![this.m_bodyCount++] = body;
   }
   AddContact(contact: (b2Contact | null)): void {
      this.m_contacts![this.m_contactCount++] = contact;
   }
   AddJoint(joint: (b2Joint | null)): void {
      this.m_joints![this.m_jointCount++] = joint;
   }
}

class b2TimeStep {
   declare dt: number;
   declare inv_dt: number;
   declare dtRatio: number;
   declare velocityIterations: number;
   declare positionIterations: number;
   declare warmStarting: boolean;

   constructor() {

   }
   Set(step: (b2TimeStep | null)): void {
      this.dt = step!.dt;
      this.inv_dt = step!.inv_dt;
      this.positionIterations = step!.positionIterations;
      this.velocityIterations = step!.velocityIterations;
      this.warmStarting = step!.warmStarting;
   }
}

class b2World {
   declare static s_timestep2: (b2TimeStep | null);
   declare static s_xf: (b2Transform | null);
   declare s_stack: Array<(b2Body | null)>;
   declare static s_backupA: (b2Sweep | null);
   declare static s_backupB: (b2Sweep | null);
   declare static s_timestep: (b2TimeStep | null);
   declare static s_queue: Array<(b2Body | null)>;
   declare static s_jointColor: (b2Color | null);
   declare m_flags: number;
   declare m_contactManager: (b2ContactManager | null);
   declare m_contactSolver: (b2ContactSolver | null);
   declare m_island: (b2Island | null);
   declare m_bodyList: (b2Body | null);
   declare m_jointList: (b2Joint | null);
   declare m_contactList: (b2Contact | null);
   declare m_bodyCount: number;
   declare m_contactCount: number;
   declare m_jointCount: number;
   declare m_controllerList: (b2Controller | null);
   declare m_controllerCount: number;
   declare m_gravity: (b2Vec2 | null);
   declare m_allowSleep: boolean;
   declare m_groundBody: (b2Body | null);
   declare m_destructionListener: (b2DestructionListener | null);
   declare m_debugDraw: (b2DebugDraw | null);
   declare m_inv_dt0: number;
   declare static m_warmStarting: boolean;
   declare static m_continuousPhysics: boolean;
   declare static e_newFixture: number;
   declare static e_locked: number;

   constructor(gravity?: (b2Vec2 | null), doSleep?: boolean) {

      this.s_stack = new Array<(b2Body | null)>();
      this.m_contactManager = new b2ContactManager();
      this.m_contactSolver = new b2ContactSolver();
      this.m_island = new b2Island();

      if (new.target === b2World) this.b2World(gravity!, doSleep!);
   }
   b2World(gravity: (b2Vec2 | null), doSleep: boolean): void {
      this.m_destructionListener = null;
      this.m_debugDraw = null;
      this.m_bodyList = null;
      this.m_contactList = null;
      this.m_jointList = null;
      this.m_controllerList = null;
      this.m_bodyCount = 0;
      this.m_contactCount = 0;
      this.m_jointCount = 0;
      this.m_controllerCount = 0;
      b2World.m_warmStarting = true;
      b2World.m_continuousPhysics = true;
      this.m_allowSleep = doSleep;
      this.m_gravity = gravity;
      this.m_inv_dt0 = 0.0;
      this.m_contactManager!.m_world = this;
      var bd: (b2BodyDef | null) = new b2BodyDef();
      this.m_groundBody = this.CreateBody(bd);
   }
   SetDestructionListener(listener: (b2DestructionListener | null)): void {
      this.m_destructionListener = listener;
   }
   SetContactFilter(filter: (b2ContactFilter | null)): void {
      this.m_contactManager!.m_contactFilter = filter;
   }
   SetContactListener(listener: (b2ContactListener | null)): void {
      this.m_contactManager!.m_contactListener = listener;
   }
   SetDebugDraw(debugDraw: (b2DebugDraw | null)): void {
      this.m_debugDraw = debugDraw;
   }
   SetBroadPhase(broadPhase: (b2DynamicTreeBroadPhase | null)): void {
      var oldBroadPhase: (b2DynamicTreeBroadPhase | null) = this.m_contactManager!.m_broadPhase;
      this.m_contactManager!.m_broadPhase = broadPhase;
      for (var b: (b2Body | null) = this.m_bodyList; b; b = b!.m_next) {
         for (var f: (b2Fixture | null) = b!.m_fixtureList; f; f = f!.m_next) {
            f!.m_proxy = broadPhase!.CreateProxy(oldBroadPhase!.GetFatAABB(f!.m_proxy), f);
         }
      }
   }
   Validate(): void {
      this.m_contactManager!.m_broadPhase!.Validate();
   }
   GetProxyCount(): number {
      return this.m_contactManager!.m_broadPhase!.GetProxyCount();
   }
   CreateBody(def: (b2BodyDef | null)): (b2Body | null) {
      if (this.IsLocked() == true) {
         return null;
      }
      var b: (b2Body | null) = new b2Body(def, this);
      b!.m_prev = null;
      b!.m_next = this.m_bodyList;
      if (this.m_bodyList) {
         this.m_bodyList!.m_prev = b;
      }
      this.m_bodyList = b;
      ++this.m_bodyCount;
      return b;
   }
   DestroyBody(b: (b2Body | null)): void {
      if (this.IsLocked() == true) {
         return;
      }
      var jn: (b2JointEdge | null) = b!.m_jointList;
      while (jn) {
         var jn0: (b2JointEdge | null) = jn;
         jn = jn!.next;
         if (this.m_destructionListener) {
            this.m_destructionListener!.SayGoodbyeJoint(jn0!.joint);
         }
         this.DestroyJoint(jn0!.joint);
      }
      var coe: (b2ControllerEdge | null) = b!.m_controllerList;
      while (coe) {
         var coe0: (b2ControllerEdge | null) = coe;
         coe = coe!.nextController;
         coe0!.controller!.RemoveBody(b);
      }
      var ce: (b2ContactEdge | null) = b!.m_contactList;
      while (ce) {
         var ce0: (b2ContactEdge | null) = ce;
         ce = ce!.next;
         this.m_contactManager!.Destroy(ce0!.contact);
      }
      b!.m_contactList = null;
      var f: (b2Fixture | null) = b!.m_fixtureList;
      while (f) {
         var f0: (b2Fixture | null) = f;
         f = f!.m_next;
         if (this.m_destructionListener) {
            this.m_destructionListener!.SayGoodbyeFixture(f0);
         }
         f0!.DestroyProxy(this.m_contactManager!.m_broadPhase);
         f0!.Destroy();
      }
      b!.m_fixtureList = null;
      b!.m_fixtureCount = 0;
      if (b!.m_prev) {
         b!.m_prev!.m_next = b!.m_next;
      }
      if (b!.m_next) {
         b!.m_next!.m_prev = b!.m_prev;
      }
      if (b == this.m_bodyList) {
         this.m_bodyList = b!.m_next;
      }--this.m_bodyCount;
   }
   CreateJoint(def: (b2JointDef | null)): (b2Joint | null) {
      var j: (b2Joint | null) = b2Joint.Create(def, null);
      j!.m_prev = null;
      j!.m_next = this.m_jointList;
      if (this.m_jointList) {
         this.m_jointList!.m_prev = j;
      }
      this.m_jointList = j;
      ++this.m_jointCount;
      j!.m_edgeA!.joint = j;
      j!.m_edgeA!.other = j!.m_bodyB;
      j!.m_edgeA!.prev = null;
      j!.m_edgeA!.next = j!.m_bodyA!.m_jointList;
      if (j!.m_bodyA!.m_jointList) j!.m_bodyA!.m_jointList!.prev = j!.m_edgeA;
      j!.m_bodyA!.m_jointList = j!.m_edgeA;
      j!.m_edgeB!.joint = j;
      j!.m_edgeB!.other = j!.m_bodyA;
      j!.m_edgeB!.prev = null;
      j!.m_edgeB!.next = j!.m_bodyB!.m_jointList;
      if (j!.m_bodyB!.m_jointList) j!.m_bodyB!.m_jointList!.prev = j!.m_edgeB;
      j!.m_bodyB!.m_jointList = j!.m_edgeB;
      var bodyA: (b2Body | null) = def!.bodyA;
      var bodyB: (b2Body | null) = def!.bodyB;
      if (def!.collideConnected == false) {
         var edge: (b2ContactEdge | null) = bodyB!.GetContactList();
         while (edge) {
            if (edge!.other == bodyA) {
               edge!.contact!.FlagForFiltering();
            }
            edge = edge!.next;
         }
      }
      return j;
   }
   DestroyJoint(j: (b2Joint | null)): void {
      var collideConnected: boolean = j!.m_collideConnected;
      if (j!.m_prev) {
         j!.m_prev!.m_next = j!.m_next;
      }
      if (j!.m_next) {
         j!.m_next!.m_prev = j!.m_prev;
      }
      if (j == this.m_jointList) {
         this.m_jointList = j!.m_next;
      }
      var bodyA: (b2Body | null) = j!.m_bodyA;
      var bodyB: (b2Body | null) = j!.m_bodyB;
      bodyA!.SetAwake(true);
      bodyB!.SetAwake(true);
      if (j!.m_edgeA!.prev) {
         j!.m_edgeA!.prev!.next = j!.m_edgeA!.next;
      }
      if (j!.m_edgeA!.next) {
         j!.m_edgeA!.next!.prev = j!.m_edgeA!.prev;
      }
      if (j!.m_edgeA == bodyA!.m_jointList) {
         bodyA!.m_jointList = j!.m_edgeA!.next;
      }
      j!.m_edgeA!.prev = null;
      j!.m_edgeA!.next = null;
      if (j!.m_edgeB!.prev) {
         j!.m_edgeB!.prev!.next = j!.m_edgeB!.next;
      }
      if (j!.m_edgeB!.next) {
         j!.m_edgeB!.next!.prev = j!.m_edgeB!.prev;
      }
      if (j!.m_edgeB == bodyB!.m_jointList) {
         bodyB!.m_jointList = j!.m_edgeB!.next;
      }
      j!.m_edgeB!.prev = null;
      j!.m_edgeB!.next = null;
      b2Joint.Destroy(j, null);
      --this.m_jointCount;
      if (collideConnected == false) {
         var edge: (b2ContactEdge | null) = bodyB!.GetContactList();
         while (edge) {
            if (edge!.other == bodyA) {
               edge!.contact!.FlagForFiltering();
            }
            edge = edge!.next;
         }
      }
   }
   AddController(c: (b2Controller | null)): (b2Controller | null) {
      c!.m_next = this.m_controllerList;
      c!.m_prev = null;
      this.m_controllerList = c;
      c!.m_world = this;
      this.m_controllerCount++;
      return c;
   }
   RemoveController(c: (b2Controller | null)): void {
      if (c!.m_prev) c!.m_prev!.m_next = c!.m_next;
      if (c!.m_next) c!.m_next!.m_prev = c!.m_prev;
      if (this.m_controllerList == c) this.m_controllerList = c!.m_next;
      this.m_controllerCount--;
   }
   CreateController(controller: (b2Controller | null)): (b2Controller | null) {
      if (controller!.m_world != this) throw new Error("Controller can only be a member of one world");
      controller!.m_next = this.m_controllerList;
      controller!.m_prev = null;
      if (this.m_controllerList) this.m_controllerList!.m_prev = controller;
      this.m_controllerList = controller;
      ++this.m_controllerCount;
      controller!.m_world = this;
      return controller;
   }
   DestroyController(controller: (b2Controller | null)): void {
      controller!.Clear();
      if (controller!.m_next) controller!.m_next!.m_prev = controller!.m_prev;
      if (controller!.m_prev) controller!.m_prev!.m_next = controller!.m_next;
      if (controller == this.m_controllerList) this.m_controllerList = controller!.m_next;
      --this.m_controllerCount;
   }
   SetWarmStarting(flag: boolean): void {
      b2World.m_warmStarting = flag;
   }
   SetContinuousPhysics(flag: boolean): void {
      b2World.m_continuousPhysics = flag;
   }
   GetBodyCount(): number {
      return this.m_bodyCount;
   }
   GetJointCount(): number {
      return this.m_jointCount;
   }
   GetContactCount(): number {
      return this.m_contactCount;
   }
   SetGravity(gravity: (b2Vec2 | null)): void {
      this.m_gravity = gravity;
   }
   GetGravity(): (b2Vec2 | null) {
      return this.m_gravity;
   }
   GetGroundBody(): (b2Body | null) {
      return this.m_groundBody;
   }
   Step(dt: number, velocityIterations: number, positionIterations: number): void {
      if (dt === undefined) dt = 0;
      if (velocityIterations === undefined) velocityIterations = 0;
      if (positionIterations === undefined) positionIterations = 0;
      if (this.m_flags & b2World.e_newFixture) {
         this.m_contactManager!.FindNewContacts();
         this.m_flags &= ~b2World.e_newFixture;
      }
      this.m_flags |= b2World.e_locked;
      var step: (b2TimeStep | null) = b2World.s_timestep2;
      step!.dt = dt;
      step!.velocityIterations = velocityIterations;
      step!.positionIterations = positionIterations;
      if (dt > 0.0) {
         step!.inv_dt = 1.0 / dt;
      }
      else {
         step!.inv_dt = 0.0;
      }
      step!.dtRatio = this.m_inv_dt0 * dt;
      step!.warmStarting = b2World.m_warmStarting;
      this.m_contactManager!.Collide();
      if (step!.dt > 0.0) {
         this.Solve(step);
      }
      if (b2World.m_continuousPhysics && step!.dt > 0.0) {
         this.SolveTOI(step);
      }
      if (step!.dt > 0.0) {
         this.m_inv_dt0 = step!.inv_dt;
      }
      this.m_flags &= ~b2World.e_locked;
   }
   ClearForces(): void {
      for (var body: (b2Body | null) = this.m_bodyList; body; body = body!.m_next) {
         body!.m_force!.SetZero();
         body!.m_torque = 0.0;
      }
   }
   DrawDebugData(): void {
      if (this.m_debugDraw == null) {
         return;
      }
      this.m_debugDraw!.m_sprite!.graphics!.clear();
      var flags: number = this.m_debugDraw!.GetFlags();
      var i: number = 0;
      var b: (b2Body | null) | undefined;
      var f: (b2Fixture | null) | undefined;
      var s: (b2Shape | null) | undefined;
      var j: (b2Joint | null) | undefined;
      var bp: (b2DynamicTreeBroadPhase | null) | undefined;
      var invQ: (b2Vec2 | null) = new b2Vec2;
      var x1: (b2Vec2 | null) = new b2Vec2;
      var x2: (b2Vec2 | null) = new b2Vec2;
      var xf: (b2Transform | null) | undefined;
      var b1: (b2AABB | null) = new b2AABB();
      var b2: (b2AABB | null) = new b2AABB();
      var vs: Array<b2Vec2 | null> = [new b2Vec2(), new b2Vec2(), new b2Vec2(), new b2Vec2()];
      var color: (b2Color | null) = new b2Color(0, 0, 0);
      if (flags & b2DebugDraw.e_shapeBit) {
         for (b = this.m_bodyList;
         b; b = b!.m_next) {
            xf = b!.m_xf;
            for (f = b!.GetFixtureList();
            f; f = f!.m_next) {
               s = f!.GetShape();
               if (b!.IsActive() == false) {
                  color!.Set(0.5, 0.5, 0.3);
                  this.DrawShape(s, xf, color);
               }
               else if (b!.GetType() == b2Body.b2_staticBody) {
                  color!.Set(0.5, 0.9, 0.5);
                  this.DrawShape(s, xf, color);
               }
               else if (b!.GetType() == b2Body.b2_kinematicBody) {
                  color!.Set(0.5, 0.5, 0.9);
                  this.DrawShape(s, xf, color);
               }
               else if (b!.IsAwake() == false) {
                  color!.Set(0.6, 0.6, 0.6);
                  this.DrawShape(s, xf, color);
               }
               else {
                  color!.Set(0.9, 0.7, 0.7);
                  this.DrawShape(s, xf, color);
               }
            }
         }
      }
      if (flags & b2DebugDraw.e_jointBit) {
         for (j = this.m_jointList;
         j; j = j!.m_next) {
            this.DrawJoint(j);
         }
      }
      if (flags & b2DebugDraw.e_controllerBit) {
         for (var c: (b2Controller | null) = this.m_controllerList; c; c = c!.m_next) {
            c!.Draw(this.m_debugDraw);
         }
      }
      if (flags & b2DebugDraw.e_pairBit) {
         color!.Set(0.3, 0.9, 0.9);
         for (var contact: (b2Contact | null) = this.m_contactManager!.m_contactList; contact; contact = contact!.GetNext()) {
            var fixtureA: (b2Fixture | null) = contact!.GetFixtureA();
            var fixtureB: (b2Fixture | null) = contact!.GetFixtureB();
            var cA: (b2Vec2 | null) = fixtureA!.GetAABB()!.GetCenter();
            var cB: (b2Vec2 | null) = fixtureB!.GetAABB()!.GetCenter();
            this.m_debugDraw!.DrawSegment(cA, cB, color);
         }
      }
      if (flags & b2DebugDraw.e_aabbBit) {
         bp = this.m_contactManager!.m_broadPhase;
         vs = [new b2Vec2(), new b2Vec2(), new b2Vec2(), new b2Vec2()];
         for (b = this.m_bodyList;
         b; b = b!.GetNext()) {
            if (b!.IsActive() == false) {
               continue;
            }
            for (f = b!.GetFixtureList();
            f; f = f!.GetNext()) {
               var aabb: (b2AABB | null) = bp!.GetFatAABB(f!.m_proxy);
               vs![0]!.Set(aabb!.lowerBound!.x, aabb!.lowerBound!.y);
               vs![1]!.Set(aabb!.upperBound!.x, aabb!.lowerBound!.y);
               vs![2]!.Set(aabb!.upperBound!.x, aabb!.upperBound!.y);
               vs![3]!.Set(aabb!.lowerBound!.x, aabb!.upperBound!.y);
               this.m_debugDraw!.DrawPolygon(vs, 4, color);
            }
         }
      }
      if (flags & b2DebugDraw.e_centerOfMassBit) {
         for (b = this.m_bodyList;
         b; b = b!.m_next) {
            xf = b2World.s_xf;
            xf!.R = b!.m_xf!.R;
            xf!.position = b!.GetWorldCenter();
            this.m_debugDraw!.DrawTransform(xf);
         }
      }
   }
   QueryAABB(callback: FixtureQueryCallback, aabb: (b2AABB | null)): void {
      var __this: b2World = this;
      var broadPhase: (b2DynamicTreeBroadPhase | null) = __this!.m_contactManager!.m_broadPhase;

      function WorldQueryWrapper(proxy: b2DynamicTreeNode) {
         var fixture = broadPhase!.GetUserData(proxy);
         if (!(fixture instanceof b2Fixture)) {
            throw new Error("Box2D world query: proxy payload is not a fixture");
         }
         return callback(fixture);
      };
      broadPhase!.Query(WorldQueryWrapper, aabb);
   }
   QueryShape(callback: FixtureQueryCallback, shape: (b2Shape | null), transform: (b2Transform | null) = null): void {
      var __this: b2World = this;
      if (transform === undefined) transform = null;
      if (transform == null) {
         transform = new b2Transform();
         transform!.SetIdentity();
      }
      var broadPhase: (b2DynamicTreeBroadPhase | null) = __this!.m_contactManager!.m_broadPhase;

      function WorldQueryWrapper(proxy: b2DynamicTreeNode) {
         var userData = broadPhase!.GetUserData(proxy);
         var fixture: (b2Fixture | null) = userData instanceof b2Fixture ? userData : null;
         if (b2Shape.TestOverlap(shape, transform, fixture!.GetShape(), fixture!.GetBody()!.GetTransform())) return callback(fixture!);
         return true;
      };
      var aabb: (b2AABB | null) = new b2AABB();
      shape!.ComputeAABB(aabb, transform);
      broadPhase!.Query(WorldQueryWrapper, aabb);
   }
   QueryPoint(callback: FixtureQueryCallback, p: (b2Vec2 | null)): void {
      var __this: b2World = this;
      var broadPhase: (b2DynamicTreeBroadPhase | null) = __this!.m_contactManager!.m_broadPhase;

      function WorldQueryWrapper(proxy: b2DynamicTreeNode) {
         var userData = broadPhase!.GetUserData(proxy);
         var fixture: (b2Fixture | null) = userData instanceof b2Fixture ? userData : null;
         if (fixture!.TestPoint(p)) return callback(fixture!);
         return true;
      };
      var aabb: (b2AABB | null) = new b2AABB();
      aabb!.lowerBound!.Set(p!.x - b2Settings.b2_linearSlop, p!.y - b2Settings.b2_linearSlop);
      aabb!.upperBound!.Set(p!.x + b2Settings.b2_linearSlop, p!.y + b2Settings.b2_linearSlop);
      broadPhase!.Query(WorldQueryWrapper, aabb);
   }
   RayCast(callback: FixtureRayCallback, point1: (b2Vec2 | null), point2: (b2Vec2 | null)): void {
      var __this: b2World = this;
      var broadPhase: (b2DynamicTreeBroadPhase | null) = __this!.m_contactManager!.m_broadPhase;
      var output: (b2RayCastOutput | null) = new b2RayCastOutput;

      function RayCastWrapper(input: (b2RayCastInput | null), proxy: b2DynamicTreeNode) {
         var userData = (broadPhase!.GetUserData(proxy));
         var fixture: (b2Fixture | null) = (userData instanceof b2Fixture ? (userData) : null);
         var hit: boolean = fixture!.RayCast(output, input);
         if (hit) {
            var fraction: number = output!.fraction;
            var point: (b2Vec2 | null) = new b2Vec2((1.0 - fraction) * point1!.x + fraction * point2!.x, (1.0 - fraction) * point1!.y + fraction * point2!.y);
            return callback(fixture!, point!, output!.normal!, fraction!);
         }
         return input!.maxFraction;
      };
      var input: (b2RayCastInput | null) = new b2RayCastInput(point1, point2);
      broadPhase!.RayCast(RayCastWrapper, input);
   }
   RayCastOne(point1: (b2Vec2 | null), point2: (b2Vec2 | null)): b2Fixture | null | undefined {
      var __this: b2World = this;
      var result: (b2Fixture | null) | undefined;

      function RayCastOneWrapper(fixture: (b2Fixture | null), point: (b2Vec2 | null), normal: (b2Vec2 | null), fraction: number) {
         if (fraction === undefined) fraction = 0;
         result = fixture;
         return fraction;
      };
      __this!.RayCast(RayCastOneWrapper, point1, point2);
      return result;
   }
   RayCastAll(point1: (b2Vec2 | null), point2: (b2Vec2 | null)): Array<(b2Fixture | null)> {
      var __this: b2World = this;
      var result: Array<(b2Fixture | null)> = new Array<(b2Fixture | null)>();

      function RayCastAllWrapper(fixture: (b2Fixture | null), point: (b2Vec2 | null), normal: (b2Vec2 | null), fraction: number) {
         if (fraction === undefined) fraction = 0;
         result![result!.length] = fixture;
         return 1;
      };
      __this!.RayCast(RayCastAllWrapper, point1, point2);
      return result;
   }
   GetBodyList(): (b2Body | null) {
      return this.m_bodyList;
   }
   GetJointList(): (b2Joint | null) {
      return this.m_jointList;
   }
   GetContactList(): (b2Contact | null) {
      return this.m_contactList;
   }
   IsLocked(): boolean {
      return (this.m_flags & b2World.e_locked) > 0;
   }
   Solve(step: (b2TimeStep | null)): void {
      var b: (b2Body | null) | undefined;
      for (var controller: (b2Controller | null) = this.m_controllerList; controller; controller = controller!.m_next) {
         controller!.Step(step);
      }
      var island: (b2Island | null) = this.m_island;
      island!.Initialize(this.m_bodyCount, this.m_contactCount, this.m_jointCount, null, this.m_contactManager!.m_contactListener, this.m_contactSolver);
      for (b = this.m_bodyList;
      b; b = b!.m_next) {
         b!.m_flags &= ~b2Body.e_islandFlag;
      }
      for (var c: (b2Contact | null) = this.m_contactList; c; c = c!.m_next) {
         c!.m_flags &= ~b2Contact.e_islandFlag;
      }
      for (var j: (b2Joint | null) = this.m_jointList; j; j = j!.m_next) {
         j!.m_islandFlag = false;
      }
      var stackSize: number = parseInt(String(this.m_bodyCount));
      var stack: Array<(b2Body | null)> = this.s_stack;
      for (var seed: (b2Body | null) = this.m_bodyList; seed; seed = seed!.m_next) {
         if (seed!.m_flags & b2Body.e_islandFlag) {
            continue;
         }
         if (seed!.IsAwake() == false || seed!.IsActive() == false) {
            continue;
         }
         if (seed!.GetType() == b2Body.b2_staticBody) {
            continue;
         }
         island!.Clear();
         var stackCount: number = 0;
         stack![stackCount++] = seed;
         seed!.m_flags |= b2Body.e_islandFlag;
         while (stackCount > 0) {
            b = stack![--stackCount];
            island!.AddBody(b);
            if (b!.IsAwake() == false) {
               b!.SetAwake(true);
            }
            if (b!.GetType() == b2Body.b2_staticBody) {
               continue;
            }
            var other: (b2Body | null) | undefined;
            for (var ce: (b2ContactEdge | null) = b!.m_contactList; ce; ce = ce!.next) {
               if (ce!.contact!.m_flags & b2Contact.e_islandFlag) {
                  continue;
               }
               if (ce!.contact!.IsSensor() == true || ce!.contact!.IsEnabled() == false || ce!.contact!.IsTouching() == false) {
                  continue;
               }
               island!.AddContact(ce!.contact);
               ce!.contact!.m_flags |= b2Contact.e_islandFlag;
               other = ce!.other;
               if (other!.m_flags & b2Body.e_islandFlag) {
                  continue;
               }
               stack![stackCount++] = other;
               other!.m_flags |= b2Body.e_islandFlag;
            }
            for (var jn: (b2JointEdge | null) = b!.m_jointList; jn; jn = jn!.next) {
               if (jn!.joint!.m_islandFlag == true) {
                  continue;
               }
               other = jn!.other;
               if (other!.IsActive() == false) {
                  continue;
               }
               island!.AddJoint(jn!.joint);
               jn!.joint!.m_islandFlag = true;
               if (other!.m_flags & b2Body.e_islandFlag) {
                  continue;
               }
               stack![stackCount++] = other;
               other!.m_flags |= b2Body.e_islandFlag;
            }
         }
         island!.Solve(step, this.m_gravity, this.m_allowSleep);
         for (var i: number = 0; i < island!.m_bodyCount; ++i) {
            b = island!.m_bodies![i];
            if (b!.GetType() == b2Body.b2_staticBody) {
               b!.m_flags &= ~b2Body.e_islandFlag;
            }
         }
      }
      for (i = 0;
      i < stack!.length; ++i) {
         if (!stack![i]) break;
         stack![i] = null;
      }
      for (b = this.m_bodyList;
      b; b = b!.m_next) {
         if (b!.IsAwake() == false || b!.IsActive() == false) {
            continue;
         }
         if (b!.GetType() == b2Body.b2_staticBody) {
            continue;
         }
         b!.SynchronizeFixtures();
      }
      this.m_contactManager!.FindNewContacts();
   }
   SolveTOI(step: (b2TimeStep | null)): void {
      var b: (b2Body | null) | undefined;
      var fA: (b2Fixture | null) | undefined;
      var fB: (b2Fixture | null) | undefined;
      var bA: (b2Body | null) | undefined;
      var bB: (b2Body | null) | undefined;
      var cEdge: (b2ContactEdge | null) | undefined;
      var j: (b2Joint | null) | undefined;
      var island: (b2Island | null) = this.m_island;
      island!.Initialize(this.m_bodyCount, b2Settings.b2_maxTOIContactsPerIsland, b2Settings.b2_maxTOIJointsPerIsland, null, this.m_contactManager!.m_contactListener, this.m_contactSolver);
      var queue: Array<(b2Body | null)> = b2World.s_queue;
      for (b = this.m_bodyList;
      b; b = b!.m_next) {
         b!.m_flags &= ~b2Body.e_islandFlag;
         b!.m_sweep!.t0 = 0.0;
      }
      var c: (b2Contact | null) | undefined;
      for (c = this.m_contactList;
      c; c = c!.m_next) {
         c!.m_flags &= ~ (b2Contact.e_toiFlag | b2Contact.e_islandFlag);
      }
      for (j = this.m_jointList;
      j; j = j!.m_next) {
         j!.m_islandFlag = false;
      }
      for (;;) {
         var minContact: (b2Contact | null) = null;
         var minTOI: number = 1.0;
         for (c = this.m_contactList;
         c; c = c!.m_next) {
            if (c!.IsSensor() == true || c!.IsEnabled() == false || c!.IsContinuous() == false) {
               continue;
            }
            var toi: number = 1.0;
            if (c!.m_flags & b2Contact.e_toiFlag) {
               toi = c!.m_toi;
            }
            else {
               fA = c!.m_fixtureA;
               fB = c!.m_fixtureB;
               bA = fA!.m_body;
               bB = fB!.m_body;
               if ((bA!.GetType() != b2Body.b2_dynamicBody || bA!.IsAwake() == false) && (bB!.GetType() != b2Body.b2_dynamicBody || bB!.IsAwake() == false)) {
                  continue;
               }
               var t0: number = bA!.m_sweep!.t0;
               if (bA!.m_sweep!.t0 < bB!.m_sweep!.t0) {
                  t0 = bB!.m_sweep!.t0;
                  bA!.m_sweep!.Advance(t0);
               }
               else if (bB!.m_sweep!.t0 < bA!.m_sweep!.t0) {
                  t0 = bA!.m_sweep!.t0;
                  bB!.m_sweep!.Advance(t0);
               }
               toi = c!.ComputeTOI(bA!.m_sweep, bB!.m_sweep);
               b2Settings.b2Assert(0.0 <= toi && toi <= 1.0);
               if (toi > 0.0 && toi < 1.0) {
                  toi = (1.0 - toi) * t0 + toi;
                  if (toi > 1) toi = 1;
               }
               c!.m_toi = toi;
               c!.m_flags |= b2Contact.e_toiFlag;
            }
            if (Number.MIN_VALUE < toi && toi < minTOI) {
               minContact = c;
               minTOI = toi;
            }
         }
         if (minContact == null || 1.0 - 100.0 * Number.MIN_VALUE < minTOI) {
            break;
         }
         fA = minContact!.m_fixtureA;
         fB = minContact!.m_fixtureB;
         bA = fA!.m_body;
         bB = fB!.m_body;
         b2World.s_backupA!.Set(bA!.m_sweep);
         b2World.s_backupB!.Set(bB!.m_sweep);
         bA!.Advance(minTOI);
         bB!.Advance(minTOI);
         minContact!.Update(this.m_contactManager!.m_contactListener);
         minContact!.m_flags &= ~b2Contact.e_toiFlag;
         if (minContact!.IsSensor() == true || minContact!.IsEnabled() == false) {
            bA!.m_sweep!.Set(b2World.s_backupA);
            bB!.m_sweep!.Set(b2World.s_backupB);
            bA!.SynchronizeTransform();
            bB!.SynchronizeTransform();
            continue;
         }
         if (minContact!.IsTouching() == false) {
            continue;
         }
         var seed: (b2Body | null) = bA;
         if (seed!.GetType() != b2Body.b2_dynamicBody) {
            seed = bB;
         }
         island!.Clear();
         var queueStart: number = 0;
         var queueSize: number = 0;
         queue![queueStart + queueSize++] = seed;
         seed!.m_flags |= b2Body.e_islandFlag;
         while (queueSize > 0) {
            b = queue![queueStart++];
            --queueSize;
            island!.AddBody(b);
            if (b!.IsAwake() == false) {
               b!.SetAwake(true);
            }
            if (b!.GetType() != b2Body.b2_dynamicBody) {
               continue;
            }
            for (cEdge = b!.m_contactList;
            cEdge; cEdge = cEdge!.next) {
               if (island!.m_contactCount == island!.m_contactCapacity) {
                  break;
               }
               if (cEdge!.contact!.m_flags & b2Contact.e_islandFlag) {
                  continue;
               }
               if (cEdge!.contact!.IsSensor() == true || cEdge!.contact!.IsEnabled() == false || cEdge!.contact!.IsTouching() == false) {
                  continue;
               }
               island!.AddContact(cEdge!.contact);
               cEdge!.contact!.m_flags |= b2Contact.e_islandFlag;
               var other: (b2Body | null) = cEdge!.other;
               if (other!.m_flags & b2Body.e_islandFlag) {
                  continue;
               }
               if (other!.GetType() != b2Body.b2_staticBody) {
                  other!.Advance(minTOI);
                  other!.SetAwake(true);
               }
               queue![queueStart + queueSize] = other;
               ++queueSize;
               other!.m_flags |= b2Body.e_islandFlag;
            }
            for (var jEdge: (b2JointEdge | null) = b!.m_jointList; jEdge; jEdge = jEdge!.next) {
               if (island!.m_jointCount == island!.m_jointCapacity) continue;
               if (jEdge!.joint!.m_islandFlag == true) continue;
               other = jEdge!.other;
               if (other!.IsActive() == false) {
                  continue;
               }
               island!.AddJoint(jEdge!.joint);
               jEdge!.joint!.m_islandFlag = true;
               if (other!.m_flags & b2Body.e_islandFlag) continue;
               if (other!.GetType() != b2Body.b2_staticBody) {
                  other!.Advance(minTOI);
                  other!.SetAwake(true);
               }
               queue![queueStart + queueSize] = other;
               ++queueSize;
               other!.m_flags |= b2Body.e_islandFlag;
            }
         }
         var subStep: (b2TimeStep | null) = b2World.s_timestep;
         subStep!.warmStarting = false;
         subStep!.dt = (1.0 - minTOI) * step!.dt;
         subStep!.inv_dt = 1.0 / subStep!.dt;
         subStep!.dtRatio = 0.0;
         subStep!.velocityIterations = step!.velocityIterations;
         subStep!.positionIterations = step!.positionIterations;
         island!.SolveTOI(subStep);
         var i: number = 0;
         for (i = 0;
         i < island!.m_bodyCount; ++i) {
            b = island!.m_bodies![i];
            b!.m_flags &= ~b2Body.e_islandFlag;
            if (b!.IsAwake() == false) {
               continue;
            }
            if (b!.GetType() != b2Body.b2_dynamicBody) {
               continue;
            }
            b!.SynchronizeFixtures();
            for (cEdge = b!.m_contactList;
            cEdge; cEdge = cEdge!.next) {
               cEdge!.contact!.m_flags &= ~b2Contact.e_toiFlag;
            }
         }
         for (i = 0;
         i < island!.m_contactCount; ++i) {
            c = island!.m_contacts![i];
            c!.m_flags &= ~ (b2Contact.e_toiFlag | b2Contact.e_islandFlag);
         }
         for (i = 0;
         i < island!.m_jointCount; ++i) {
            j = island!.m_joints![i];
            j!.m_islandFlag = false;
         }
         this.m_contactManager!.FindNewContacts();
      }
   }
   DrawJoint(joint: (b2Joint | null)): void {
      var b1: (b2Body | null) = joint!.GetBodyA();
      var b2: (b2Body | null) = joint!.GetBodyB();
      var xf1: (b2Transform | null) = b1!.m_xf;
      var xf2: (b2Transform | null) = b2!.m_xf;
      var x1: (b2Vec2 | null) = xf1!.position;
      var x2: (b2Vec2 | null) = xf2!.position;
      var p1: (b2Vec2 | null) = joint!.GetAnchorA();
      var p2: (b2Vec2 | null) = joint!.GetAnchorB();
      var color: (b2Color | null) = b2World.s_jointColor;
      switch (joint!.m_type) {
      case b2Joint.e_distanceJoint:
         this.m_debugDraw!.DrawSegment(p1, p2, color);
         break;
      case b2Joint.e_pulleyJoint:
         {
            var pulley: (b2PulleyJoint | null) = ((joint instanceof b2PulleyJoint ? (joint) : null));
            var s1: (b2Vec2 | null) = pulley!.GetGroundAnchorA();
            var s2: (b2Vec2 | null) = pulley!.GetGroundAnchorB();
            this.m_debugDraw!.DrawSegment(s1, p1, color);
            this.m_debugDraw!.DrawSegment(s2, p2, color);
            this.m_debugDraw!.DrawSegment(s1, s2, color);
         }
         break;
      case b2Joint.e_mouseJoint:
         this.m_debugDraw!.DrawSegment(p1, p2, color);
         break;
      default:
         if (b1 != this.m_groundBody) this.m_debugDraw!.DrawSegment(x1, p1, color);
         this.m_debugDraw!.DrawSegment(p1, p2, color);
         if (b2 != this.m_groundBody) this.m_debugDraw!.DrawSegment(x2, p2, color);
      }
   }
   DrawShape(shape: (b2Shape | null), xf: (b2Transform | null), color: (b2Color | null)): void {
      switch (shape!.m_type) {
      case b2Shape.e_circleShape:
         {
            var circle: (b2CircleShape | null) = ((shape instanceof b2CircleShape ? (shape) : null));
            var center: (b2Vec2 | null) = b2Math.MulX(xf, circle!.m_p);
            var radius: number = circle!.m_radius;
            var axis: (b2Vec2 | null) = xf!.R!.col1;
            this.m_debugDraw!.DrawSolidCircle(center, radius, axis, color);
         }
         break;
      case b2Shape.e_polygonShape:
         {
            var i: number = 0;
            var poly: (b2PolygonShape | null) = ((shape instanceof b2PolygonShape ? (shape) : null));
            var vertexCount: number = parseInt(String(poly!.GetVertexCount()));
            var localVertices: Array<(b2Vec2 | null)> = poly!.GetVertices();
            var vertices: Array<(b2Vec2 | null)> = new Array<(b2Vec2 | null)>(vertexCount);
            for (i = 0;
            i < vertexCount; ++i) {
               vertices![i] = b2Math.MulX(xf, localVertices![i]);
            }
            this.m_debugDraw!.DrawSolidPolygon(vertices, vertexCount, color);
         }
         break;
      case b2Shape.e_edgeShape:
         {
            var edge: (b2EdgeShape | null) = (shape instanceof b2EdgeShape ? (shape) : null);
            this.m_debugDraw!.DrawSegment(b2Math.MulX(xf, edge!.GetVertex1()), b2Math.MulX(xf, edge!.GetVertex2()), color);
         }
         break;
      }
   }
}

class b2Contact {
   declare static e_sensorFlag: number;
   declare static e_continuousFlag: number;
   declare static e_islandFlag: number;
   declare static e_toiFlag: number;
   declare static e_touchingFlag: number;
   declare static e_enabledFlag: number;
   declare static e_filterFlag: number;
   declare static s_input: (b2TOIInput | null);
   declare m_flags: number;
   declare m_prev: (b2Contact | null);
   declare m_next: (b2Contact | null);
   declare m_nodeA: (b2ContactEdge | null);
   declare m_nodeB: (b2ContactEdge | null);
   declare m_fixtureA: (b2Fixture | null);
   declare m_fixtureB: (b2Fixture | null);
   declare m_manifold: (b2Manifold | null);
   declare m_oldManifold: (b2Manifold | null);
   declare m_toi: number;

   constructor() {

      this.m_nodeA = new b2ContactEdge();
      this.m_nodeB = new b2ContactEdge();
      this.m_manifold = new b2Manifold();
      this.m_oldManifold = new b2Manifold();

      if (new.target === b2Contact) this.b2Contact();
   }
   GetManifold(): (b2Manifold | null) {
      return this.m_manifold;
   }
   GetWorldManifold(worldManifold: (b2WorldManifold | null)): void {
      var bodyA: (b2Body | null) = this.m_fixtureA!.GetBody();
      var bodyB: (b2Body | null) = this.m_fixtureB!.GetBody();
      var shapeA: (b2Shape | null) = this.m_fixtureA!.GetShape();
      var shapeB: (b2Shape | null) = this.m_fixtureB!.GetShape();
      worldManifold!.Initialize(this.m_manifold, bodyA!.GetTransform(), shapeA!.m_radius, bodyB!.GetTransform(), shapeB!.m_radius);
   }
   IsTouching(): boolean {
      return (this.m_flags & b2Contact.e_touchingFlag) == b2Contact.e_touchingFlag;
   }
   IsContinuous(): boolean {
      return (this.m_flags & b2Contact.e_continuousFlag) == b2Contact.e_continuousFlag;
   }
   SetSensor(sensor: boolean): void {
      if (sensor) {
         this.m_flags |= b2Contact.e_sensorFlag;
      }
      else {
         this.m_flags &= ~b2Contact.e_sensorFlag;
      }
   }
   IsSensor(): boolean {
      return (this.m_flags & b2Contact.e_sensorFlag) == b2Contact.e_sensorFlag;
   }
   SetEnabled(flag: boolean): void {
      if (flag) {
         this.m_flags |= b2Contact.e_enabledFlag;
      }
      else {
         this.m_flags &= ~b2Contact.e_enabledFlag;
      }
   }
   IsEnabled(): boolean {
      return (this.m_flags & b2Contact.e_enabledFlag) == b2Contact.e_enabledFlag;
   }
   GetNext(): (b2Contact | null) {
      return this.m_next;
   }
   GetFixtureA(): (b2Fixture | null) {
      return this.m_fixtureA;
   }
   GetFixtureB(): (b2Fixture | null) {
      return this.m_fixtureB;
   }
   FlagForFiltering(): void {
      this.m_flags |= b2Contact.e_filterFlag;
   }
   b2Contact(): void {}
   Reset(fixtureA: (b2Fixture | null) = null, fixtureB: (b2Fixture | null) = null): void {
      if (fixtureA === undefined) fixtureA = null;
      if (fixtureB === undefined) fixtureB = null;
      this.m_flags = b2Contact.e_enabledFlag;
      if (!fixtureA || !fixtureB) {
         this.m_fixtureA = null;
         this.m_fixtureB = null;
         return;
      }
      if (fixtureA!.IsSensor() || fixtureB!.IsSensor()) {
         this.m_flags |= b2Contact.e_sensorFlag;
      }
      var bodyA: (b2Body | null) = fixtureA!.GetBody();
      var bodyB: (b2Body | null) = fixtureB!.GetBody();
      if (bodyA!.GetType() != b2Body.b2_dynamicBody || bodyA!.IsBullet() || bodyB!.GetType() != b2Body.b2_dynamicBody || bodyB!.IsBullet()) {
         this.m_flags |= b2Contact.e_continuousFlag;
      }
      this.m_fixtureA = fixtureA;
      this.m_fixtureB = fixtureB;
      this.m_manifold!.m_pointCount = 0;
      this.m_prev = null;
      this.m_next = null;
      this.m_nodeA!.contact = null;
      this.m_nodeA!.prev = null;
      this.m_nodeA!.next = null;
      this.m_nodeA!.other = null;
      this.m_nodeB!.contact = null;
      this.m_nodeB!.prev = null;
      this.m_nodeB!.next = null;
      this.m_nodeB!.other = null;
   }
   Update(listener: (b2ContactListener | null)): void {
      var tManifold: (b2Manifold | null) = this.m_oldManifold;
      this.m_oldManifold = this.m_manifold;
      this.m_manifold = tManifold;
      this.m_flags |= b2Contact.e_enabledFlag;
      var touching: boolean = false;
      var wasTouching: boolean = (this.m_flags & b2Contact.e_touchingFlag) == b2Contact.e_touchingFlag;
      var bodyA: (b2Body | null) = this.m_fixtureA!.m_body;
      var bodyB: (b2Body | null) = this.m_fixtureB!.m_body;
      var aabbOverlap: boolean = this.m_fixtureA!.m_aabb!.TestOverlap(this.m_fixtureB!.m_aabb);
      if (this.m_flags & b2Contact.e_sensorFlag) {
         if (aabbOverlap) {
            var shapeA: (b2Shape | null) = this.m_fixtureA!.GetShape();
            var shapeB: (b2Shape | null) = this.m_fixtureB!.GetShape();
            var xfA: (b2Transform | null) = bodyA!.GetTransform();
            var xfB: (b2Transform | null) = bodyB!.GetTransform();
            touching = b2Shape.TestOverlap(shapeA, xfA, shapeB, xfB);
         }
         this.m_manifold!.m_pointCount = 0;
      }
      else {
         if (bodyA!.GetType() != b2Body.b2_dynamicBody || bodyA!.IsBullet() || bodyB!.GetType() != b2Body.b2_dynamicBody || bodyB!.IsBullet()) {
            this.m_flags |= b2Contact.e_continuousFlag;
         }
         else {
            this.m_flags &= ~b2Contact.e_continuousFlag;
         }
         if (aabbOverlap) {
            this.Evaluate();
            touching = this.m_manifold!.m_pointCount > 0;
            for (var i: number = 0; i < this.m_manifold!.m_pointCount; ++i) {
               var mp2: (b2ManifoldPoint | null) = this.m_manifold!.m_points![i];
               mp2!.m_normalImpulse = 0.0;
               mp2!.m_tangentImpulse = 0.0;
               var id2: (b2ContactID | null) = mp2!.m_id;
               for (var j: number = 0; j < this.m_oldManifold!.m_pointCount; ++j) {
                  var mp1: (b2ManifoldPoint | null) = this.m_oldManifold!.m_points![j];
                  if (mp1!.m_id!.key == id2!.key) {
                     mp2!.m_normalImpulse = mp1!.m_normalImpulse;
                     mp2!.m_tangentImpulse = mp1!.m_tangentImpulse;
                     break;
                  }
               }
            }
         }
         else {
            this.m_manifold!.m_pointCount = 0;
         }
         if (touching != wasTouching) {
            bodyA!.SetAwake(true);
            bodyB!.SetAwake(true);
         }
      }
      if (touching) {
         this.m_flags |= b2Contact.e_touchingFlag;
      }
      else {
         this.m_flags &= ~b2Contact.e_touchingFlag;
      }
      if (wasTouching == false && touching == true) {
         listener!.BeginContact(this);
      }
      if (wasTouching == true && touching == false) {
         listener!.EndContact(this);
      }
      if ((this.m_flags & b2Contact.e_sensorFlag) == 0) {
         listener!.PreSolve(this, this.m_oldManifold);
      }
   }
   Evaluate(): void {}
   ComputeTOI(sweepA: (b2Sweep | null), sweepB: (b2Sweep | null)): number {
      b2Contact.s_input!.proxyA!.Set(this.m_fixtureA!.GetShape());
      b2Contact.s_input!.proxyB!.Set(this.m_fixtureB!.GetShape());
      b2Contact.s_input!.sweepA = sweepA;
      b2Contact.s_input!.sweepB = sweepB;
      b2Contact.s_input!.tolerance = b2Settings.b2_linearSlop;
      return b2TimeOfImpact.TimeOfImpact(b2Contact.s_input);
   }
}

class b2CircleContact extends b2Contact {

   constructor() {
      super();



   }
   static Create(allocator: unknown): (b2Contact | null) {
      return new b2CircleContact();
   }
   static Destroy(contact: (b2Contact | null), allocator: unknown): void {}
   Reset(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): void {
      super.Reset(fixtureA, fixtureB);
   }
   Evaluate(): void {
      var bA: (b2Body | null) = this.m_fixtureA!.GetBody();
      var bB: (b2Body | null) = this.m_fixtureB!.GetBody();
      var shapeA: b2Shape | null = this.m_fixtureA!.GetShape();
      var shapeB: b2Shape | null = this.m_fixtureB!.GetShape();
      b2Collision.CollideCircles(this.m_manifold, (shapeA instanceof b2CircleShape ? (shapeA) : null), bA!.m_xf, (shapeB instanceof b2CircleShape ? (shapeB) : null), bB!.m_xf);
   }
}

class b2ContactConstraint {
   declare points: Array<(b2ContactConstraintPoint | null)>;
   declare localPlaneNormal: (b2Vec2 | null);
   declare localPoint: (b2Vec2 | null);
   declare normal: (b2Vec2 | null);
   declare normalMass: (b2Mat22 | null);
   declare K: (b2Mat22 | null);
   declare bodyA: (b2Body | null);
   declare bodyB: (b2Body | null);
   declare type: number;
   declare radius: number;
   declare friction: number;
   declare restitution: number;
   declare pointCount: number;
   declare manifold: (b2Manifold | null);

   constructor() {

      this.localPlaneNormal = new b2Vec2();
      this.localPoint = new b2Vec2();
      this.normal = new b2Vec2();
      this.normalMass = new b2Mat22();
      this.K = new b2Mat22();

      if (new.target === b2ContactConstraint) this.b2ContactConstraint();
   }
   b2ContactConstraint(): void {
      this.points = new Array<(b2ContactConstraintPoint | null)>(b2Settings.b2_maxManifoldPoints);
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         this.points![i] = new b2ContactConstraintPoint();
      }
   }
}

class b2ContactConstraintPoint {
   declare localPoint: (b2Vec2 | null);
   declare rA: (b2Vec2 | null);
   declare rB: (b2Vec2 | null);
   declare normalImpulse: number;
   declare tangentImpulse: number;
   declare normalMass: number;
   declare tangentMass: number;
   declare equalizedMass: number;
   declare velocityBias: number;

   constructor() {

      this.localPoint = new b2Vec2();
      this.rA = new b2Vec2();
      this.rB = new b2Vec2();

   }
}

class b2ContactEdge {
   declare other: (b2Body | null);
   declare contact: (b2Contact | null);
   declare prev: (b2ContactEdge | null);
   declare next: (b2ContactEdge | null);

   constructor() {

   }
}

class b2ContactFactory {
   declare m_registers: Array<Array<(b2ContactRegister | null)>>;
   declare m_allocator: unknown;

   constructor(allocator?: unknown) {

      if (new.target === b2ContactFactory) this.b2ContactFactory(allocator!);
   }
   b2ContactFactory(allocator: unknown): void {
      this.m_allocator = allocator;
      this.InitializeRegisters();
   }
   AddType(createFcn: ContactCreate, destroyFcn: ContactDestroy, type1: number, type2: number): void {
      if (type1 === undefined) type1 = 0;
      if (type2 === undefined) type2 = 0;
      this.m_registers![type1]![type2]!.createFcn = createFcn;
      this.m_registers![type1]![type2]!.destroyFcn = destroyFcn;
      this.m_registers![type1]![type2]!.primary = true;
      if (type1 != type2) {
         this.m_registers![type2]![type1]!.createFcn = createFcn;
         this.m_registers![type2]![type1]!.destroyFcn = destroyFcn;
         this.m_registers![type2]![type1]!.primary = false;
      }
   }
   InitializeRegisters(): void {
      this.m_registers = new Array<Array<(b2ContactRegister | null)>>(b2Shape.e_shapeTypeCount);
      for (var i: number = 0; i < b2Shape.e_shapeTypeCount; i++) {
         this.m_registers![i] = new Array<b2ContactRegister | null>(b2Shape.e_shapeTypeCount);
         for (var j: number = 0; j < b2Shape.e_shapeTypeCount; j++) {
            this.m_registers![i]![j] = new b2ContactRegister();
         }
      }
      this.AddType(b2CircleContact.Create, b2CircleContact.Destroy, b2Shape.e_circleShape, b2Shape.e_circleShape);
      this.AddType(b2PolyAndCircleContact.Create, b2PolyAndCircleContact.Destroy, b2Shape.e_polygonShape, b2Shape.e_circleShape);
      this.AddType(b2PolygonContact.Create, b2PolygonContact.Destroy, b2Shape.e_polygonShape, b2Shape.e_polygonShape);
      this.AddType(b2EdgeAndCircleContact.Create, b2EdgeAndCircleContact.Destroy, b2Shape.e_edgeShape, b2Shape.e_circleShape);
      this.AddType(b2PolyAndEdgeContact.Create, b2PolyAndEdgeContact.Destroy, b2Shape.e_polygonShape, b2Shape.e_edgeShape);
   }
   Create(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): (b2Contact | null) {
      var type1: number = parseInt(String(fixtureA!.GetType()));
      var type2: number = parseInt(String(fixtureB!.GetType()));
      var reg: (b2ContactRegister | null) = this.m_registers![type1]![type2];
      var c: (b2Contact | null) | undefined;
      if (reg!.pool) {
         c = reg!.pool;
         reg!.pool = c!.m_next;
         reg!.poolCount--;
         c!.Reset(fixtureA, fixtureB);
         return c;
      }
      var createFcn: ContactCreate = reg!.createFcn;
      if (createFcn != null) {
         if (reg!.primary) {
            c = createFcn(this.m_allocator);
            c!.Reset(fixtureA, fixtureB);
            return c;
         }
         else {
            c = createFcn(this.m_allocator);
            c!.Reset(fixtureB, fixtureA);
            return c;
         }
      }
      else {
         return null;
      }
   }
   Destroy(contact: (b2Contact | null)): void {
      if (contact!.m_manifold!.m_pointCount > 0) {
         contact!.m_fixtureA!.m_body!.SetAwake(true);
         contact!.m_fixtureB!.m_body!.SetAwake(true);
      }
      var type1: number = parseInt(String(contact!.m_fixtureA!.GetType()));
      var type2: number = parseInt(String(contact!.m_fixtureB!.GetType()));
      var reg: (b2ContactRegister | null) = this.m_registers![type1]![type2];
      if (true) {
         reg!.poolCount++;
         contact!.m_next = reg!.pool;
         reg!.pool = contact;
      }
      var destroyFcn: ContactDestroy = reg!.destroyFcn;
      destroyFcn(contact, this.m_allocator);
   }
}

class b2ContactRegister {
   declare createFcn: ContactCreate;
   declare destroyFcn: ContactDestroy;
   declare primary: boolean;
   declare pool: (b2Contact | null);
   declare poolCount: number;

   constructor() {

   }
}

class b2ContactResult {
   declare shape1: (b2Shape | null);
   declare shape2: (b2Shape | null);
   declare position: (b2Vec2 | null);
   declare normal: (b2Vec2 | null);
   declare normalImpulse: number;
   declare tangentImpulse: number;
   declare id: (b2ContactID | null);

   constructor() {

      this.position = new b2Vec2();
      this.normal = new b2Vec2();
      this.id = new b2ContactID();

   }
}

class b2ContactSolver {
   declare static s_worldManifold: (b2WorldManifold | null);
   declare static s_psm: (b2PositionSolverManifold | null);
   declare m_step: (b2TimeStep | null);
   declare m_allocator: unknown;
   declare m_constraints: Array<(b2ContactConstraint | null)>;
   declare m_constraintCount: number;

   constructor() {

      this.m_step = new b2TimeStep();
      this.m_constraints = new Array<(b2ContactConstraint | null)>();

      if (new.target === b2ContactSolver) this.b2ContactSolver();
   }
   b2ContactSolver(): void {}
   Initialize(step: (b2TimeStep | null), contacts: Array<(b2Contact | null)>, contactCount: number, allocator: unknown): void {
      if (contactCount === undefined) contactCount = 0;
      var contact: (b2Contact | null) | undefined;
      this.m_step!.Set(step);
      this.m_allocator = allocator;
      var i: number = 0;
      var tVec: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) | undefined;
      this.m_constraintCount = contactCount;
      while (this.m_constraints!.length < this.m_constraintCount) {
         this.m_constraints![this.m_constraints!.length] = new b2ContactConstraint();
      }
      for (i = 0;
      i < contactCount; ++i) {
         contact = contacts![i];
         var fixtureA: (b2Fixture | null) = contact!.m_fixtureA;
         var fixtureB: (b2Fixture | null) = contact!.m_fixtureB;
         var shapeA: (b2Shape | null) = fixtureA!.m_shape;
         var shapeB: (b2Shape | null) = fixtureB!.m_shape;
         var radiusA: number = shapeA!.m_radius;
         var radiusB: number = shapeB!.m_radius;
         var bodyA: (b2Body | null) = fixtureA!.m_body;
         var bodyB: (b2Body | null) = fixtureB!.m_body;
         var manifold: (b2Manifold | null) = contact!.GetManifold();
         var friction: number = b2Settings.b2MixFriction(fixtureA!.GetFriction(), fixtureB!.GetFriction());
         var restitution: number = b2Settings.b2MixRestitution(fixtureA!.GetRestitution(), fixtureB!.GetRestitution());
         var vAX: number = bodyA!.m_linearVelocity!.x;
         var vAY: number = bodyA!.m_linearVelocity!.y;
         var vBX: number = bodyB!.m_linearVelocity!.x;
         var vBY: number = bodyB!.m_linearVelocity!.y;
         var wA: number = bodyA!.m_angularVelocity;
         var wB: number = bodyB!.m_angularVelocity;
         b2Settings.b2Assert(manifold!.m_pointCount > 0);
         b2ContactSolver.s_worldManifold!.Initialize(manifold, bodyA!.m_xf, radiusA, bodyB!.m_xf, radiusB);
         var normalX: number = b2ContactSolver.s_worldManifold!.m_normal!.x;
         var normalY: number = b2ContactSolver.s_worldManifold!.m_normal!.y;
         var cc: (b2ContactConstraint | null) = this.m_constraints![i];
         cc!.bodyA = bodyA;
         cc!.bodyB = bodyB;
         cc!.manifold = manifold;
         cc!.normal!.x = normalX;
         cc!.normal!.y = normalY;
         cc!.pointCount = manifold!.m_pointCount;
         cc!.friction = friction;
         cc!.restitution = restitution;
         cc!.localPlaneNormal!.x = manifold!.m_localPlaneNormal!.x;
         cc!.localPlaneNormal!.y = manifold!.m_localPlaneNormal!.y;
         cc!.localPoint!.x = manifold!.m_localPoint!.x;
         cc!.localPoint!.y = manifold!.m_localPoint!.y;
         cc!.radius = radiusA + radiusB;
         cc!.type = manifold!.m_type;
         for (var k: number = 0; k < cc!.pointCount; ++k) {
            var cp: (b2ManifoldPoint | null) = manifold!.m_points![k];
            var ccp: (b2ContactConstraintPoint | null) = cc!.points![k];
            ccp!.normalImpulse = cp!.m_normalImpulse;
            ccp!.tangentImpulse = cp!.m_tangentImpulse;
            ccp!.localPoint!.SetV(cp!.m_localPoint);
            var rAX: number = ccp!.rA!.x = b2ContactSolver.s_worldManifold!.m_points![k]!.x - bodyA!.m_sweep!.c!.x;
            var rAY: number = ccp!.rA!.y = b2ContactSolver.s_worldManifold!.m_points![k]!.y - bodyA!.m_sweep!.c!.y;
            var rBX: number = ccp!.rB!.x = b2ContactSolver.s_worldManifold!.m_points![k]!.x - bodyB!.m_sweep!.c!.x;
            var rBY: number = ccp!.rB!.y = b2ContactSolver.s_worldManifold!.m_points![k]!.y - bodyB!.m_sweep!.c!.y;
            var rnA: number = rAX * normalY - rAY * normalX;
            var rnB: number = rBX * normalY - rBY * normalX;
            rnA *= rnA;
            rnB *= rnB;
            var kNormal: number = bodyA!.m_invMass + bodyB!.m_invMass + bodyA!.m_invI * rnA + bodyB!.m_invI * rnB;
            ccp!.normalMass = 1.0 / kNormal;
            var kEqualized: number = bodyA!.m_mass * bodyA!.m_invMass + bodyB!.m_mass * bodyB!.m_invMass;
            kEqualized += bodyA!.m_mass * bodyA!.m_invI * rnA + bodyB!.m_mass * bodyB!.m_invI * rnB;
            ccp!.equalizedMass = 1.0 / kEqualized;
            var tangentX: number = normalY;
            var tangentY: number = (-normalX);
            var rtA: number = rAX * tangentY - rAY * tangentX;
            var rtB: number = rBX * tangentY - rBY * tangentX;
            rtA *= rtA;
            rtB *= rtB;
            var kTangent: number = bodyA!.m_invMass + bodyB!.m_invMass + bodyA!.m_invI * rtA + bodyB!.m_invI * rtB;
            ccp!.tangentMass = 1.0 / kTangent;
            ccp!.velocityBias = 0.0;
            var tX: number = vBX + ((-wB * rBY)) - vAX - ((-wA * rAY));
            var tY: number = vBY + (wB * rBX) - vAY - (wA * rAX);
            var vRel: number = cc!.normal!.x * tX + cc!.normal!.y * tY;
            if (vRel < (-b2Settings.b2_velocityThreshold)) {
               ccp!.velocityBias += (-cc!.restitution * vRel);
            }
         }
         if (cc!.pointCount == 2) {
            var ccp1: (b2ContactConstraintPoint | null) = cc!.points![0];
            var ccp2: (b2ContactConstraintPoint | null) = cc!.points![1];
            var invMassA: number = bodyA!.m_invMass;
            var invIA: number = bodyA!.m_invI;
            var invMassB: number = bodyB!.m_invMass;
            var invIB: number = bodyB!.m_invI;
            var rn1A: number = ccp1!.rA!.x * normalY - ccp1!.rA!.y * normalX;
            var rn1B: number = ccp1!.rB!.x * normalY - ccp1!.rB!.y * normalX;
            var rn2A: number = ccp2!.rA!.x * normalY - ccp2!.rA!.y * normalX;
            var rn2B: number = ccp2!.rB!.x * normalY - ccp2!.rB!.y * normalX;
            var k11: number = invMassA + invMassB + invIA * rn1A * rn1A + invIB * rn1B * rn1B;
            var k22: number = invMassA + invMassB + invIA * rn2A * rn2A + invIB * rn2B * rn2B;
            var k12: number = invMassA + invMassB + invIA * rn1A * rn2A + invIB * rn1B * rn2B;
            var k_maxConditionNumber: number = 100.0;
            if (k11 * k11 < k_maxConditionNumber * (k11 * k22 - k12 * k12)) {
               cc!.K!.col1!.Set(k11, k12);
               cc!.K!.col2!.Set(k12, k22);
               cc!.K!.GetInverse(cc!.normalMass);
            }
            else {
               cc!.pointCount = 1;
            }
         }
      }
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var tVec: (b2Vec2 | null) | undefined;
      var tVec2: (b2Vec2 | null) | undefined;
      var tMat: (b2Mat22 | null) | undefined;
      for (var i: number = 0; i < this.m_constraintCount; ++i) {
         var c: (b2ContactConstraint | null) = this.m_constraints![i];
         var bodyA: (b2Body | null) = c!.bodyA;
         var bodyB: (b2Body | null) = c!.bodyB;
         var invMassA: number = bodyA!.m_invMass;
         var invIA: number = bodyA!.m_invI;
         var invMassB: number = bodyB!.m_invMass;
         var invIB: number = bodyB!.m_invI;
         var normalX: number = c!.normal!.x;
         var normalY: number = c!.normal!.y;
         var tangentX: number = normalY;
         var tangentY: number = (-normalX);
         var tX: number = 0;
         var j: number = 0;
         var tCount: number = 0;
         if (step!.warmStarting) {
            tCount = c!.pointCount;
            for (j = 0;
            j < tCount; ++j) {
               var ccp: (b2ContactConstraintPoint | null) = c!.points![j];
               ccp!.normalImpulse *= step!.dtRatio;
               ccp!.tangentImpulse *= step!.dtRatio;
               var PX: number = ccp!.normalImpulse * normalX + ccp!.tangentImpulse * tangentX;
               var PY: number = ccp!.normalImpulse * normalY + ccp!.tangentImpulse * tangentY;
               bodyA!.m_angularVelocity -= invIA * (ccp!.rA!.x * PY - ccp!.rA!.y * PX);
               bodyA!.m_linearVelocity!.x -= invMassA * PX;
               bodyA!.m_linearVelocity!.y -= invMassA * PY;
               bodyB!.m_angularVelocity += invIB * (ccp!.rB!.x * PY - ccp!.rB!.y * PX);
               bodyB!.m_linearVelocity!.x += invMassB * PX;
               bodyB!.m_linearVelocity!.y += invMassB * PY;
            }
         }
         else {
            tCount = c!.pointCount;
            for (j = 0;
            j < tCount; ++j) {
               var ccp2: (b2ContactConstraintPoint | null) = c!.points![j];
               ccp2!.normalImpulse = 0.0;
               ccp2!.tangentImpulse = 0.0;
            }
         }
      }
   }
   SolveVelocityConstraints(): void {
      var j: number = 0;
      var ccp: (b2ContactConstraintPoint | null) | undefined;
      var rAX: number = 0;
      var rAY: number = 0;
      var rBX: number = 0;
      var rBY: number = 0;
      var dvX: number = 0;
      var dvY: number = 0;
      var vn: number = 0;
      var vt: number = 0;
      var lambda: number = 0;
      var maxFriction: number = 0;
      var newImpulse: number = 0;
      var PX: number = 0;
      var PY: number = 0;
      var dX: number = 0;
      var dY: number = 0;
      var P1X: number = 0;
      var P1Y: number = 0;
      var P2X: number = 0;
      var P2Y: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      for (var i: number = 0; i < this.m_constraintCount; ++i) {
         var c: (b2ContactConstraint | null) = this.m_constraints![i];
         var bodyA: (b2Body | null) = c!.bodyA;
         var bodyB: (b2Body | null) = c!.bodyB;
         var wA: number = bodyA!.m_angularVelocity;
         var wB: number = bodyB!.m_angularVelocity;
         var vA: (b2Vec2 | null) = bodyA!.m_linearVelocity;
         var vB: (b2Vec2 | null) = bodyB!.m_linearVelocity;
         var invMassA: number = bodyA!.m_invMass;
         var invIA: number = bodyA!.m_invI;
         var invMassB: number = bodyB!.m_invMass;
         var invIB: number = bodyB!.m_invI;
         var normalX: number = c!.normal!.x;
         var normalY: number = c!.normal!.y;
         var tangentX: number = normalY;
         var tangentY: number = (-normalX);
         var friction: number = c!.friction;
         var tX: number = 0;
         for (j = 0;
         j < c!.pointCount; j++) {
            ccp = c!.points![j];
            dvX = vB!.x - wB * ccp!.rB!.y - vA!.x + wA * ccp!.rA!.y;
            dvY = vB!.y + wB * ccp!.rB!.x - vA!.y - wA * ccp!.rA!.x;
            vt = dvX * tangentX + dvY * tangentY;
            lambda = ccp!.tangentMass * (-vt);
            maxFriction = friction * ccp!.normalImpulse;
            newImpulse = b2Math.Clamp(ccp!.tangentImpulse + lambda, (-maxFriction), maxFriction);
            lambda = newImpulse - ccp!.tangentImpulse;
            PX = lambda * tangentX;
            PY = lambda * tangentY;
            vA!.x -= invMassA * PX;
            vA!.y -= invMassA * PY;
            wA -= invIA * (ccp!.rA!.x * PY - ccp!.rA!.y * PX);
            vB!.x += invMassB * PX;
            vB!.y += invMassB * PY;
            wB += invIB * (ccp!.rB!.x * PY - ccp!.rB!.y * PX);
            ccp!.tangentImpulse = newImpulse;
         }
         var tCount: number = parseInt(String(c!.pointCount));
         if (c!.pointCount == 1) {
            ccp = c!.points![0];
            dvX = vB!.x + ((-wB * ccp!.rB!.y)) - vA!.x - ((-wA * ccp!.rA!.y));
            dvY = vB!.y + (wB * ccp!.rB!.x) - vA!.y - (wA * ccp!.rA!.x);
            vn = dvX * normalX + dvY * normalY;
            lambda = (-ccp!.normalMass * (vn - ccp!.velocityBias));
            newImpulse = ccp!.normalImpulse + lambda;
            newImpulse = newImpulse > 0 ? newImpulse : 0.0;
            lambda = newImpulse - ccp!.normalImpulse;
            PX = lambda * normalX;
            PY = lambda * normalY;
            vA!.x -= invMassA * PX;
            vA!.y -= invMassA * PY;
            wA -= invIA * (ccp!.rA!.x * PY - ccp!.rA!.y * PX);
            vB!.x += invMassB * PX;
            vB!.y += invMassB * PY;
            wB += invIB * (ccp!.rB!.x * PY - ccp!.rB!.y * PX);
            ccp!.normalImpulse = newImpulse;
         }
         else {
            var cp1: (b2ContactConstraintPoint | null) = c!.points![0];
            var cp2: (b2ContactConstraintPoint | null) = c!.points![1];
            var aX: number = cp1!.normalImpulse;
            var aY: number = cp2!.normalImpulse;
            var dv1X: number = vB!.x - wB * cp1!.rB!.y - vA!.x + wA * cp1!.rA!.y;
            var dv1Y: number = vB!.y + wB * cp1!.rB!.x - vA!.y - wA * cp1!.rA!.x;
            var dv2X: number = vB!.x - wB * cp2!.rB!.y - vA!.x + wA * cp2!.rA!.y;
            var dv2Y: number = vB!.y + wB * cp2!.rB!.x - vA!.y - wA * cp2!.rA!.x;
            var vn1: number = dv1X * normalX + dv1Y * normalY;
            var vn2: number = dv2X * normalX + dv2Y * normalY;
            var bX: number = vn1 - cp1!.velocityBias;
            var bY: number = vn2 - cp2!.velocityBias;
            tMat = c!.K;
            bX -= tMat!.col1!.x * aX + tMat!.col2!.x * aY;
            bY -= tMat!.col1!.y * aX + tMat!.col2!.y * aY;
            var k_errorTol: number = 0.001;
            for (;;) {
               tMat = c!.normalMass;
               var xX: number = (-(tMat!.col1!.x * bX + tMat!.col2!.x * bY));
               var xY: number = (-(tMat!.col1!.y * bX + tMat!.col2!.y * bY));
               if (xX >= 0.0 && xY >= 0.0) {
                  dX = xX - aX;
                  dY = xY - aY;
                  P1X = dX * normalX;
                  P1Y = dX * normalY;
                  P2X = dY * normalX;
                  P2Y = dY * normalY;
                  vA!.x -= invMassA * (P1X + P2X);
                  vA!.y -= invMassA * (P1Y + P2Y);
                  wA -= invIA * (cp1!.rA!.x * P1Y - cp1!.rA!.y * P1X + cp2!.rA!.x * P2Y - cp2!.rA!.y * P2X);
                  vB!.x += invMassB * (P1X + P2X);
                  vB!.y += invMassB * (P1Y + P2Y);
                  wB += invIB * (cp1!.rB!.x * P1Y - cp1!.rB!.y * P1X + cp2!.rB!.x * P2Y - cp2!.rB!.y * P2X);
                  cp1!.normalImpulse = xX;
                  cp2!.normalImpulse = xY;
                  break;
               }
               xX = (-cp1!.normalMass * bX);
               xY = 0.0;
               vn1 = 0.0;
               vn2 = c!.K!.col1!.y * xX + bY;
               if (xX >= 0.0 && vn2 >= 0.0) {
                  dX = xX - aX;
                  dY = xY - aY;
                  P1X = dX * normalX;
                  P1Y = dX * normalY;
                  P2X = dY * normalX;
                  P2Y = dY * normalY;
                  vA!.x -= invMassA * (P1X + P2X);
                  vA!.y -= invMassA * (P1Y + P2Y);
                  wA -= invIA * (cp1!.rA!.x * P1Y - cp1!.rA!.y * P1X + cp2!.rA!.x * P2Y - cp2!.rA!.y * P2X);
                  vB!.x += invMassB * (P1X + P2X);
                  vB!.y += invMassB * (P1Y + P2Y);
                  wB += invIB * (cp1!.rB!.x * P1Y - cp1!.rB!.y * P1X + cp2!.rB!.x * P2Y - cp2!.rB!.y * P2X);
                  cp1!.normalImpulse = xX;
                  cp2!.normalImpulse = xY;
                  break;
               }
               xX = 0.0;
               xY = (-cp2!.normalMass * bY);
               vn1 = c!.K!.col2!.x * xY + bX;
               vn2 = 0.0;
               if (xY >= 0.0 && vn1 >= 0.0) {
                  dX = xX - aX;
                  dY = xY - aY;
                  P1X = dX * normalX;
                  P1Y = dX * normalY;
                  P2X = dY * normalX;
                  P2Y = dY * normalY;
                  vA!.x -= invMassA * (P1X + P2X);
                  vA!.y -= invMassA * (P1Y + P2Y);
                  wA -= invIA * (cp1!.rA!.x * P1Y - cp1!.rA!.y * P1X + cp2!.rA!.x * P2Y - cp2!.rA!.y * P2X);
                  vB!.x += invMassB * (P1X + P2X);
                  vB!.y += invMassB * (P1Y + P2Y);
                  wB += invIB * (cp1!.rB!.x * P1Y - cp1!.rB!.y * P1X + cp2!.rB!.x * P2Y - cp2!.rB!.y * P2X);
                  cp1!.normalImpulse = xX;
                  cp2!.normalImpulse = xY;
                  break;
               }
               xX = 0.0;
               xY = 0.0;
               vn1 = bX;
               vn2 = bY;
               if (vn1 >= 0.0 && vn2 >= 0.0) {
                  dX = xX - aX;
                  dY = xY - aY;
                  P1X = dX * normalX;
                  P1Y = dX * normalY;
                  P2X = dY * normalX;
                  P2Y = dY * normalY;
                  vA!.x -= invMassA * (P1X + P2X);
                  vA!.y -= invMassA * (P1Y + P2Y);
                  wA -= invIA * (cp1!.rA!.x * P1Y - cp1!.rA!.y * P1X + cp2!.rA!.x * P2Y - cp2!.rA!.y * P2X);
                  vB!.x += invMassB * (P1X + P2X);
                  vB!.y += invMassB * (P1Y + P2Y);
                  wB += invIB * (cp1!.rB!.x * P1Y - cp1!.rB!.y * P1X + cp2!.rB!.x * P2Y - cp2!.rB!.y * P2X);
                  cp1!.normalImpulse = xX;
                  cp2!.normalImpulse = xY;
                  break;
               }
               break;
            }
         }
         bodyA!.m_angularVelocity = wA;
         bodyB!.m_angularVelocity = wB;
      }
   }
   FinalizeVelocityConstraints(): void {
      for (var i: number = 0; i < this.m_constraintCount; ++i) {
         var c: (b2ContactConstraint | null) = this.m_constraints![i];
         var m: (b2Manifold | null) = c!.manifold;
         for (var j: number = 0; j < c!.pointCount; ++j) {
            var point1: (b2ManifoldPoint | null) = m!.m_points![j];
            var point2: (b2ContactConstraintPoint | null) = c!.points![j];
            point1!.m_normalImpulse = point2!.normalImpulse;
            point1!.m_tangentImpulse = point2!.tangentImpulse;
         }
      }
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var minSeparation: number = 0.0;
      for (var i: number = 0; i < this.m_constraintCount; i++) {
         var c: (b2ContactConstraint | null) = this.m_constraints![i];
         var bodyA: (b2Body | null) = c!.bodyA;
         var bodyB: (b2Body | null) = c!.bodyB;
         var invMassA: number = bodyA!.m_mass * bodyA!.m_invMass;
         var invIA: number = bodyA!.m_mass * bodyA!.m_invI;
         var invMassB: number = bodyB!.m_mass * bodyB!.m_invMass;
         var invIB: number = bodyB!.m_mass * bodyB!.m_invI;
         b2ContactSolver.s_psm!.Initialize(c);
         var normal: (b2Vec2 | null) = b2ContactSolver.s_psm!.m_normal;
         for (var j: number = 0; j < c!.pointCount; j++) {
            var ccp: (b2ContactConstraintPoint | null) = c!.points![j];
            var point: (b2Vec2 | null) = b2ContactSolver.s_psm!.m_points![j];
            var separation: number = b2ContactSolver.s_psm!.m_separations![j];
            var rAX: number = point!.x - bodyA!.m_sweep!.c!.x;
            var rAY: number = point!.y - bodyA!.m_sweep!.c!.y;
            var rBX: number = point!.x - bodyB!.m_sweep!.c!.x;
            var rBY: number = point!.y - bodyB!.m_sweep!.c!.y;
            minSeparation = minSeparation < separation ? minSeparation : separation;
            var C: number = b2Math.Clamp(baumgarte * (separation + b2Settings.b2_linearSlop), (-b2Settings.b2_maxLinearCorrection), 0.0);
            var impulse: number = (-ccp!.equalizedMass * C);
            var PX: number = impulse * normal!.x;
            var PY: number = impulse * normal!.y;bodyA!.m_sweep!.c!.x -= invMassA * PX;
            bodyA!.m_sweep!.c!.y -= invMassA * PY;
            bodyA!.m_sweep!.a -= invIA * (rAX * PY - rAY * PX);
            bodyA!.SynchronizeTransform();
            bodyB!.m_sweep!.c!.x += invMassB * PX;
            bodyB!.m_sweep!.c!.y += invMassB * PY;
            bodyB!.m_sweep!.a += invIB * (rBX * PY - rBY * PX);
            bodyB!.SynchronizeTransform();
         }
      }
      return minSeparation > (-1.5 * b2Settings.b2_linearSlop);
   }
}

class b2EdgeAndCircleContact extends b2Contact {

   constructor() {
      super();



   }
   static Create(allocator: unknown): (b2Contact | null) {
      return new b2EdgeAndCircleContact();
   }
   static Destroy(contact: (b2Contact | null), allocator: unknown): void {}
   Reset(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): void {
      super.Reset(fixtureA, fixtureB);
   }
   Evaluate(): void {
      var bA: (b2Body | null) = this.m_fixtureA!.GetBody();
      var bB: (b2Body | null) = this.m_fixtureB!.GetBody();
      var shapeA: b2Shape | null = this.m_fixtureA!.GetShape();
      var shapeB: b2Shape | null = this.m_fixtureB!.GetShape();
      this.b2CollideEdgeAndCircle(this.m_manifold, (shapeA instanceof b2EdgeShape ? (shapeA) : null), bA!.m_xf, (shapeB instanceof b2CircleShape ? (shapeB) : null), bB!.m_xf);
   }
   b2CollideEdgeAndCircle(manifold: (b2Manifold | null), edge: (b2EdgeShape | null), xf1: (b2Transform | null), circle: (b2CircleShape | null), xf2: (b2Transform | null)): void {}
}

class b2NullContact extends b2Contact {

   constructor() {
      super();



      if (new.target === b2NullContact) this.b2NullContact();
   }
   b2NullContact(): void {
      super.b2Contact();
   }
   Evaluate(): void {}
}

class b2PolyAndCircleContact extends b2Contact {

   constructor() {
      super();



   }
   static Create(allocator: unknown): (b2Contact | null) {
      return new b2PolyAndCircleContact();
   }
   static Destroy(contact: (b2Contact | null), allocator: unknown): void {}
   Reset(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): void {
      super.Reset(fixtureA, fixtureB);
      b2Settings.b2Assert(fixtureA!.GetType() == b2Shape.e_polygonShape);
      b2Settings.b2Assert(fixtureB!.GetType() == b2Shape.e_circleShape);
   }
   Evaluate(): void {
      var bA: (b2Body | null) = this.m_fixtureA!.m_body;
      var bB: (b2Body | null) = this.m_fixtureB!.m_body;
      var shapeA: b2Shape | null = this.m_fixtureA!.GetShape();
      var shapeB: b2Shape | null = this.m_fixtureB!.GetShape();
      b2Collision.CollidePolygonAndCircle(this.m_manifold, (shapeA instanceof b2PolygonShape ? (shapeA) : null), bA!.m_xf, (shapeB instanceof b2CircleShape ? (shapeB) : null), bB!.m_xf);
   }
}

class b2PolyAndEdgeContact extends b2Contact {

   constructor() {
      super();



   }
   static Create(allocator: unknown): (b2Contact | null) {
      return new b2PolyAndEdgeContact();
   }
   static Destroy(contact: (b2Contact | null), allocator: unknown): void {}
   Reset(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): void {
      super.Reset(fixtureA, fixtureB);
      b2Settings.b2Assert(fixtureA!.GetType() == b2Shape.e_polygonShape);
      b2Settings.b2Assert(fixtureB!.GetType() == b2Shape.e_edgeShape);
   }
   Evaluate(): void {
      var bA: (b2Body | null) = this.m_fixtureA!.GetBody();
      var bB: (b2Body | null) = this.m_fixtureB!.GetBody();
      var shapeA: b2Shape | null = this.m_fixtureA!.GetShape();
      var shapeB: b2Shape | null = this.m_fixtureB!.GetShape();
      this.b2CollidePolyAndEdge(this.m_manifold, (shapeA instanceof b2PolygonShape ? (shapeA) : null), bA!.m_xf, (shapeB instanceof b2EdgeShape ? (shapeB) : null), bB!.m_xf);
   }
   b2CollidePolyAndEdge(manifold: (b2Manifold | null), polygon: (b2PolygonShape | null), xf1: (b2Transform | null), edge: (b2EdgeShape | null), xf2: (b2Transform | null)): void {}
}

class b2PolygonContact extends b2Contact {

   constructor() {
      super();



   }
   static Create(allocator: unknown): (b2Contact | null) {
      return new b2PolygonContact();
   }
   static Destroy(contact: (b2Contact | null), allocator: unknown): void {}
   Reset(fixtureA: (b2Fixture | null), fixtureB: (b2Fixture | null)): void {
      super.Reset(fixtureA, fixtureB);
   }
   Evaluate(): void {
      var bA: (b2Body | null) = this.m_fixtureA!.GetBody();
      var bB: (b2Body | null) = this.m_fixtureB!.GetBody();
      var shapeA: b2Shape | null = this.m_fixtureA!.GetShape();
      var shapeB: b2Shape | null = this.m_fixtureB!.GetShape();
      b2Collision.CollidePolygons(this.m_manifold, (shapeA instanceof b2PolygonShape ? (shapeA) : null), bA!.m_xf, (shapeB instanceof b2PolygonShape ? (shapeB) : null), bB!.m_xf);
   }
}

class b2PositionSolverManifold {
   declare static circlePointA: (b2Vec2 | null);
   declare static circlePointB: (b2Vec2 | null);
   declare m_normal: (b2Vec2 | null);
   declare m_points: Array<(b2Vec2 | null)>;
   declare m_separations: Array<number>;

   constructor() {

      if (new.target === b2PositionSolverManifold) this.b2PositionSolverManifold();
   }
   b2PositionSolverManifold(): void {
      this.m_normal = new b2Vec2();
      this.m_separations = numberVector(b2Settings.b2_maxManifoldPoints);
      this.m_points = new Array<(b2Vec2 | null)>(b2Settings.b2_maxManifoldPoints);
      for (var i: number = 0; i < b2Settings.b2_maxManifoldPoints; i++) {
         this.m_points![i] = new b2Vec2();
      }
   }
   Initialize(cc: (b2ContactConstraint | null)): void {
      b2Settings.b2Assert(cc!.pointCount > 0);
      var i: number = 0;
      var clipPointX: number = 0;
      var clipPointY: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      var planePointX: number = 0;
      var planePointY: number = 0;
      switch (cc!.type) {
      case b2Manifold.e_circles:
         {
            tMat = cc!.bodyA!.m_xf!.R;
            tVec = cc!.localPoint;
            var pointAX: number = cc!.bodyA!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            var pointAY: number = cc!.bodyA!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            tMat = cc!.bodyB!.m_xf!.R;
            tVec = cc!.points![0]!.localPoint;
            var pointBX: number = cc!.bodyB!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            var pointBY: number = cc!.bodyB!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            var dX: number = pointBX - pointAX;
            var dY: number = pointBY - pointAY;
            var d2: number = dX * dX + dY * dY;
            if (d2 > Number.MIN_VALUE * Number.MIN_VALUE) {
               var d: number = Math.sqrt(d2);
               this.m_normal!.x = dX / d;
               this.m_normal!.y = dY / d;
            }
            else {
               this.m_normal!.x = 1.0;
               this.m_normal!.y = 0.0;
            }
            this.m_points![0]!.x = 0.5 * (pointAX + pointBX);
            this.m_points![0]!.y = 0.5 * (pointAY + pointBY);
            this.m_separations![0] = dX * this.m_normal!.x + dY * this.m_normal!.y - cc!.radius;
         }
         break;
      case b2Manifold.e_faceA:
         {
            tMat = cc!.bodyA!.m_xf!.R;
            tVec = cc!.localPlaneNormal;
            this.m_normal!.x = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            this.m_normal!.y = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tMat = cc!.bodyA!.m_xf!.R;
            tVec = cc!.localPoint;
            planePointX = cc!.bodyA!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            planePointY = cc!.bodyA!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            tMat = cc!.bodyB!.m_xf!.R;
            for (i = 0;
            i < cc!.pointCount; ++i) {
               tVec = cc!.points![i]!.localPoint;
               clipPointX = cc!.bodyB!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
               clipPointY = cc!.bodyB!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
               this.m_separations![i] = (clipPointX - planePointX) * this.m_normal!.x + (clipPointY - planePointY) * this.m_normal!.y - cc!.radius;
               this.m_points![i]!.x = clipPointX;
               this.m_points![i]!.y = clipPointY;
            }
         }
         break;
      case b2Manifold.e_faceB:
         {
            tMat = cc!.bodyB!.m_xf!.R;
            tVec = cc!.localPlaneNormal;
            this.m_normal!.x = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
            this.m_normal!.y = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
            tMat = cc!.bodyB!.m_xf!.R;
            tVec = cc!.localPoint;
            planePointX = cc!.bodyB!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
            planePointY = cc!.bodyB!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
            tMat = cc!.bodyA!.m_xf!.R;
            for (i = 0;
            i < cc!.pointCount; ++i) {
               tVec = cc!.points![i]!.localPoint;
               clipPointX = cc!.bodyA!.m_xf!.position!.x + (tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y);
               clipPointY = cc!.bodyA!.m_xf!.position!.y + (tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y);
               this.m_separations![i] = (clipPointX - planePointX) * this.m_normal!.x + (clipPointY - planePointY) * this.m_normal!.y - cc!.radius;
               this.m_points![i]!.Set(clipPointX, clipPointY);
            }
            this.m_normal!.x *= (-1);
            this.m_normal!.y *= (-1);
         }
         break;
      }
   }
}

class b2Controller {
   declare m_next: (b2Controller | null);
   declare m_prev: (b2Controller | null);
   declare m_bodyList: (b2ControllerEdge | null);
   declare m_bodyCount: number;
   declare m_world: (b2World | null);

   constructor() {

   }
   Step(step: (b2TimeStep | null)): void {}
   Draw(debugDraw: (b2DebugDraw | null)): void {}
   AddBody(body: (b2Body | null)): void {
      var edge: (b2ControllerEdge | null) = new b2ControllerEdge();
      edge!.controller = this;
      edge!.body = body;
      edge!.nextBody = this.m_bodyList;
      edge!.prevBody = null;
      this.m_bodyList = edge;
      if (edge!.nextBody) edge!.nextBody!.prevBody = edge;
      this.m_bodyCount++;
      edge!.nextController = body!.m_controllerList;
      edge!.prevController = null;
      body!.m_controllerList = edge;
      if (edge!.nextController) edge!.nextController!.prevController = edge;
      body!.m_controllerCount++;
   }
   RemoveBody(body: (b2Body | null)): void {
      var edge: (b2ControllerEdge | null) = body!.m_controllerList;
      while (edge && edge!.controller != this)
      edge = edge!.nextController;
      if (edge!.prevBody) edge!.prevBody!.nextBody = edge!.nextBody;
      if (edge!.nextBody) edge!.nextBody!.prevBody = edge!.prevBody;
      if (edge!.nextController) edge!.nextController!.prevController = edge!.prevController;
      if (edge!.prevController) edge!.prevController!.nextController = edge!.nextController;
      if (this.m_bodyList == edge) this.m_bodyList = edge!.nextBody;
      if (body!.m_controllerList == edge) body!.m_controllerList = edge!.nextController;
      body!.m_controllerCount--;
      this.m_bodyCount--;
   }
   Clear(): void {
      while (this.m_bodyList)
      this.RemoveBody(this.m_bodyList!.body);
   }
   GetNext(): (b2Controller | null) {
      return this.m_next;
   }
   GetWorld(): (b2World | null) {
      return this.m_world;
   }
   GetBodyList(): (b2ControllerEdge | null) {
      return this.m_bodyList;
   }
}

class b2BuoyancyController extends b2Controller {
   declare normal: (b2Vec2 | null);
   declare offset: number;
   declare density: number;
   declare velocity: (b2Vec2 | null);
   declare linearDrag: number;
   declare angularDrag: number;
   declare useDensity: boolean;
   declare useWorldGravity: boolean;
   declare gravity: (b2Vec2 | null);

   constructor() {
      super();


      this.normal = new b2Vec2(0, (-1));
      this.offset = 0;
      this.density = 0;
      this.velocity = new b2Vec2(0, 0);
      this.linearDrag = 2;
      this.angularDrag = 1;
      this.useDensity = false;
      this.useWorldGravity = true;
      this.gravity = null;

   }
   Step(step: (b2TimeStep | null)): void {
      if (!this.m_bodyList) return;
      if (this.useWorldGravity) {
         this.gravity = this.GetWorld()!.GetGravity()!.Copy();
      }
      for (var i: (b2ControllerEdge | null) = this.m_bodyList; i; i = i!.nextBody) {
         var body: (b2Body | null) = i!.body;
         if (body!.IsAwake() == false) {
            continue;
         }
         var areac: (b2Vec2 | null) = new b2Vec2();
         var massc: (b2Vec2 | null) = new b2Vec2();
         var area: number = 0.0;
         var mass: number = 0.0;
         for (var fixture: (b2Fixture | null) = body!.GetFixtureList(); fixture; fixture = fixture!.GetNext()) {
            var sc: (b2Vec2 | null) = new b2Vec2();
            var sarea: number = fixture!.GetShape()!.ComputeSubmergedArea(this.normal, this.offset, body!.GetTransform(), sc);
            area += sarea;
            areac!.x += sarea * sc!.x;
            areac!.y += sarea * sc!.y;
            var shapeDensity: number = 0;
            if (this.useDensity) {
               shapeDensity = 1;
            }
            else {
               shapeDensity = 1;
            }
            mass += sarea * shapeDensity;
            massc!.x += sarea * sc!.x * shapeDensity;
            massc!.y += sarea * sc!.y * shapeDensity;
         }
         areac!.x /= area;
         areac!.y /= area;
         massc!.x /= mass;
         massc!.y /= mass;
         if (area < Number.MIN_VALUE) continue;
         var buoyancyForce: (b2Vec2 | null) = this.gravity!.GetNegative();
         buoyancyForce!.Multiply(this.density * area);
         body!.ApplyForce(buoyancyForce, massc);
         var dragForce: (b2Vec2 | null) = body!.GetLinearVelocityFromWorldPoint(areac);
         dragForce!.Subtract(this.velocity);
         dragForce!.Multiply((-this.linearDrag * area));
         body!.ApplyForce(dragForce, areac);
         body!.ApplyTorque((-body!.GetInertia() / body!.GetMass() * area * body!.GetAngularVelocity() * this.angularDrag));
      }
   }
   Draw(debugDraw: (b2DebugDraw | null)): void {
      var r: number = 1000;
      var p1: (b2Vec2 | null) = new b2Vec2();
      var p2: (b2Vec2 | null) = new b2Vec2();
      p1!.x = this.normal!.x * this.offset + this.normal!.y * r;
      p1!.y = this.normal!.y * this.offset - this.normal!.x * r;
      p2!.x = this.normal!.x * this.offset - this.normal!.y * r;
      p2!.y = this.normal!.y * this.offset + this.normal!.x * r;
      var color: (b2Color | null) = new b2Color(0, 0, 1);
      debugDraw!.DrawSegment(p1, p2, color);
   }
}

class b2ConstantAccelController extends b2Controller {
   declare A: (b2Vec2 | null);

   constructor() {
      super();


      this.A = new b2Vec2(0, 0);

   }
   Step(step: (b2TimeStep | null)): void {
      var smallA: (b2Vec2 | null) = new b2Vec2(this.A!.x * step!.dt, this.A!.y * step!.dt);
      for (var i: (b2ControllerEdge | null) = this.m_bodyList; i; i = i!.nextBody) {
         var body: (b2Body | null) = i!.body;
         if (!body!.IsAwake()) continue;
         body!.SetLinearVelocity(new b2Vec2(body!.GetLinearVelocity()!.x + smallA!.x, body!.GetLinearVelocity()!.y + smallA!.y));
      }
   }
}

class b2ConstantForceController extends b2Controller {
   declare F: (b2Vec2 | null);

   constructor() {
      super();


      this.F = new b2Vec2(0, 0);

   }
   Step(step: (b2TimeStep | null)): void {
      for (var i: (b2ControllerEdge | null) = this.m_bodyList; i; i = i!.nextBody) {
         var body: (b2Body | null) = i!.body;
         if (!body!.IsAwake()) continue;
         body!.ApplyForce(this.F, body!.GetWorldCenter());
      }
   }
}

class b2ControllerEdge {
   declare controller: (b2Controller | null);
   declare body: (b2Body | null);
   declare prevBody: (b2ControllerEdge | null);
   declare nextBody: (b2ControllerEdge | null);
   declare prevController: (b2ControllerEdge | null);
   declare nextController: (b2ControllerEdge | null);

   constructor() {

   }
}

class b2GravityController extends b2Controller {
   declare G: number;
   declare invSqr: boolean;

   constructor() {
      super();


      this.G = 1;
      this.invSqr = true;

   }
   Step(step: (b2TimeStep | null)): void {
      var i: (b2ControllerEdge | null) = null;
      var body1: (b2Body | null) = null;
      var p1: (b2Vec2 | null) = null;
      var mass1: number = 0;
      var j: (b2ControllerEdge | null) = null;
      var body2: (b2Body | null) = null;
      var p2: (b2Vec2 | null) = null;
      var dx: number = 0;
      var dy: number = 0;
      var r2: number = 0;
      var f: (b2Vec2 | null) = null;
      if (this.invSqr) {
         for (i = this.m_bodyList;
         i; i = i!.nextBody) {
            body1 = i!.body;
            p1 = body1!.GetWorldCenter();
            mass1 = body1!.GetMass();
            for (j = this.m_bodyList;
            j != i; j = j!.nextBody) {
               body2 = j!.body;
               p2 = body2!.GetWorldCenter();
               dx = p2!.x - p1!.x;
               dy = p2!.y - p1!.y;
               r2 = dx * dx + dy * dy;
               if (r2 < Number.MIN_VALUE) continue;
               f = new b2Vec2(dx, dy);
               f!.Multiply(this.G / r2 / Math.sqrt(r2) * mass1 * body2!.GetMass());
               if (body1!.IsAwake()) body1!.ApplyForce(f, p1);
               f!.Multiply((-1));
               if (body2!.IsAwake()) body2!.ApplyForce(f, p2);
            }
         }
      }
      else {
         for (i = this.m_bodyList;
         i; i = i!.nextBody) {
            body1 = i!.body;
            p1 = body1!.GetWorldCenter();
            mass1 = body1!.GetMass();
            for (j = this.m_bodyList;
            j != i; j = j!.nextBody) {
               body2 = j!.body;
               p2 = body2!.GetWorldCenter();
               dx = p2!.x - p1!.x;
               dy = p2!.y - p1!.y;
               r2 = dx * dx + dy * dy;
               if (r2 < Number.MIN_VALUE) continue;
               f = new b2Vec2(dx, dy);
               f!.Multiply(this.G / r2 * mass1 * body2!.GetMass());
               if (body1!.IsAwake()) body1!.ApplyForce(f, p1);
               f!.Multiply((-1));
               if (body2!.IsAwake()) body2!.ApplyForce(f, p2);
            }
         }
      }
   }
}

class b2TensorDampingController extends b2Controller {
   declare T: (b2Mat22 | null);
   declare maxTimestep: number;

   constructor() {
      super();


      this.T = new b2Mat22();
      this.maxTimestep = 0;

   }
   SetAxisAligned(xDamping: number, yDamping: number): void {
      if (xDamping === undefined) xDamping = 0;
      if (yDamping === undefined) yDamping = 0;
      this.T!.col1!.x = (-xDamping);
      this.T!.col1!.y = 0;
      this.T!.col2!.x = 0;
      this.T!.col2!.y = (-yDamping);
      if (xDamping > 0 || yDamping > 0) {
         this.maxTimestep = 1 / Math.max(xDamping, yDamping);
      }
      else {
         this.maxTimestep = 0;
      }
   }
   Step(step: (b2TimeStep | null)): void {
      var timestep: number = step!.dt;
      if (timestep <= Number.MIN_VALUE) return;
      if (timestep > this.maxTimestep && this.maxTimestep > 0) timestep = this.maxTimestep;
      for (var i: (b2ControllerEdge | null) = this.m_bodyList; i; i = i!.nextBody) {
         var body: (b2Body | null) = i!.body;
         if (!body!.IsAwake()) {
            continue;
         }
         var damping: (b2Vec2 | null) = body!.GetWorldVector(b2Math.MulMV(this.T, body!.GetLocalVector(body!.GetLinearVelocity())));
         body!.SetLinearVelocity(new b2Vec2(body!.GetLinearVelocity()!.x + damping!.x * timestep, body!.GetLinearVelocity()!.y + damping!.y * timestep));
      }
   }
}

class b2Joint {
   declare m_type: number;
   declare m_prev: (b2Joint | null);
   declare m_next: (b2Joint | null);
   declare m_edgeA: (b2JointEdge | null);
   declare m_edgeB: (b2JointEdge | null);
   declare m_bodyA: (b2Body | null);
   declare m_bodyB: (b2Body | null);
   declare m_islandFlag: boolean;
   declare m_collideConnected: boolean;
   declare m_userData: unknown;
   declare m_localCenterA: (b2Vec2 | null);
   declare m_localCenterB: (b2Vec2 | null);
   declare m_invMassA: number;
   declare m_invMassB: number;
   declare m_invIA: number;
   declare m_invIB: number;
   declare static e_unknownJoint: number;
   declare static e_revoluteJoint: number;
   declare static e_prismaticJoint: number;
   declare static e_distanceJoint: number;
   declare static e_pulleyJoint: number;
   declare static e_mouseJoint: number;
   declare static e_gearJoint: number;
   declare static e_lineJoint: number;
   declare static e_weldJoint: number;
   declare static e_frictionJoint: number;
   declare static e_inactiveLimit: number;
   declare static e_atLowerLimit: number;
   declare static e_atUpperLimit: number;
   declare static e_equalLimits: number;

   constructor(def?: (b2JointDef | null)) {

      this.m_edgeA = new b2JointEdge();
      this.m_edgeB = new b2JointEdge();
      this.m_localCenterA = new b2Vec2();
      this.m_localCenterB = new b2Vec2();

      if (new.target === b2Joint) this.b2Joint(def!);
   }
   GetType(): number {
      return this.m_type;
   }
   GetAnchorA(): (b2Vec2 | null) {
      return null;
   }
   GetAnchorB(): (b2Vec2 | null) {
      return null;
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return null;
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return 0.0;
   }
   GetBodyA(): (b2Body | null) {
      return this.m_bodyA;
   }
   GetBodyB(): (b2Body | null) {
      return this.m_bodyB;
   }
   GetNext(): (b2Joint | null) {
      return this.m_next;
   }
   GetUserData(): unknown {
      return this.m_userData;
   }
   SetUserData(data: unknown): void {
      this.m_userData = data;
   }
   IsActive(): boolean {
      return this.m_bodyA!.IsActive() && this.m_bodyB!.IsActive();
   }
   static Create(def: (b2JointDef | null), allocator: unknown): (b2Joint | null) {
      var joint: (b2Joint | null) = null;
      switch (def!.type) {
      case b2Joint.e_distanceJoint:
         {
            joint = new b2DistanceJoint((def instanceof b2DistanceJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_mouseJoint:
         {
            joint = new b2MouseJoint((def instanceof b2MouseJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_prismaticJoint:
         {
            joint = new b2PrismaticJoint((def instanceof b2PrismaticJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_revoluteJoint:
         {
            joint = new b2RevoluteJoint((def instanceof b2RevoluteJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_pulleyJoint:
         {
            joint = new b2PulleyJoint((def instanceof b2PulleyJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_gearJoint:
         {
            joint = new b2GearJoint((def instanceof b2GearJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_lineJoint:
         {
            joint = new b2LineJoint((def instanceof b2LineJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_weldJoint:
         {
            joint = new b2WeldJoint((def instanceof b2WeldJointDef ? (def) : null));
         }
         break;
      case b2Joint.e_frictionJoint:
         {
            joint = new b2FrictionJoint((def instanceof b2FrictionJointDef ? (def) : null));
         }
         break;
      default:
         break;
      }
      return joint;
   }
   static Destroy(joint: (b2Joint | null), allocator: unknown): void {}
   b2Joint(def: (b2JointDef | null)): void {
      b2Settings.b2Assert(def!.bodyA != def!.bodyB);
      this.m_type = def!.type;
      this.m_prev = null;
      this.m_next = null;
      this.m_bodyA = def!.bodyA;
      this.m_bodyB = def!.bodyB;
      this.m_collideConnected = def!.collideConnected;
      this.m_islandFlag = false;
      this.m_userData = def!.userData;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {}
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {}
   FinalizeVelocityConstraints(): void {}
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      return false;
   }
}

class b2DistanceJoint extends b2Joint {
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_u: (b2Vec2 | null);
   declare m_frequencyHz: number;
   declare m_dampingRatio: number;
   declare m_gamma: number;
   declare m_bias: number;
   declare m_impulse: number;
   declare m_mass: number;
   declare m_length: number;

   constructor(def?: (b2DistanceJointDef | null)) {
      super();


      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_u = new b2Vec2();

      if (new.target === b2DistanceJoint) this.b2DistanceJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse * this.m_u!.x, inv_dt * this.m_impulse * this.m_u!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return 0.0;
   }
   GetLength(): number {
      return this.m_length;
   }
   SetLength(length: number): void {
      if (length === undefined) length = 0;
      this.m_length = length;
   }
   GetFrequency(): number {
      return this.m_frequencyHz;
   }
   SetFrequency(hz: number): void {
      if (hz === undefined) hz = 0;
      this.m_frequencyHz = hz;
   }
   GetDampingRatio(): number {
      return this.m_dampingRatio;
   }
   SetDampingRatio(ratio: number): void {
      if (ratio === undefined) ratio = 0;
      this.m_dampingRatio = ratio;
   }
   b2DistanceJoint(def: (b2DistanceJointDef | null)): void {
      super.b2Joint(def);
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var tY: number = 0;
      this.m_localAnchor1!.SetV(def!.localAnchorA);
      this.m_localAnchor2!.SetV(def!.localAnchorB);
      this.m_length = def!.length;
      this.m_frequencyHz = def!.frequencyHz;
      this.m_dampingRatio = def!.dampingRatio;
      this.m_impulse = 0.0;
      this.m_gamma = 0.0;
      this.m_bias = 0.0;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      this.m_u!.x = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
      this.m_u!.y = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
      var length: number = Math.sqrt(this.m_u!.x * this.m_u!.x + this.m_u!.y * this.m_u!.y);
      if (length > b2Settings.b2_linearSlop) {
         this.m_u!.Multiply(1.0 / length);
      }
      else {
         this.m_u!.SetZero();
      }
      var cr1u: number = (r1X * this.m_u!.y - r1Y * this.m_u!.x);
      var cr2u: number = (r2X * this.m_u!.y - r2Y * this.m_u!.x);
      var invMass: number = bA!.m_invMass + bA!.m_invI * cr1u * cr1u + bB!.m_invMass + bB!.m_invI * cr2u * cr2u;
      this.m_mass = invMass != 0.0 ? 1.0 / invMass : 0.0;
      if (this.m_frequencyHz > 0.0) {
         var C: number = length - this.m_length;
         var omega: number = 2.0 * Math.PI * this.m_frequencyHz;
         var d: number = 2.0 * this.m_mass * this.m_dampingRatio * omega;
         var k: number = this.m_mass * omega * omega;
         this.m_gamma = step!.dt * (d + step!.dt * k);
         this.m_gamma = this.m_gamma != 0.0 ? 1 / this.m_gamma : 0.0;
         this.m_bias = C * step!.dt * k * this.m_gamma;
         this.m_mass = invMass + this.m_gamma;
         this.m_mass = this.m_mass != 0.0 ? 1.0 / this.m_mass : 0.0;
      }
      if (step!.warmStarting) {
         this.m_impulse *= step!.dtRatio;
         var PX: number = this.m_impulse * this.m_u!.x;
         var PY: number = this.m_impulse * this.m_u!.y;
         bA!.m_linearVelocity!.x -= bA!.m_invMass * PX;
         bA!.m_linearVelocity!.y -= bA!.m_invMass * PY;
         bA!.m_angularVelocity -= bA!.m_invI * (r1X * PY - r1Y * PX);
         bB!.m_linearVelocity!.x += bB!.m_invMass * PX;
         bB!.m_linearVelocity!.y += bB!.m_invMass * PY;
         bB!.m_angularVelocity += bB!.m_invI * (r2X * PY - r2Y * PX);
      }
      else {
         this.m_impulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var v1X: number = bA!.m_linearVelocity!.x + ((-bA!.m_angularVelocity * r1Y));
      var v1Y: number = bA!.m_linearVelocity!.y + (bA!.m_angularVelocity * r1X);
      var v2X: number = bB!.m_linearVelocity!.x + ((-bB!.m_angularVelocity * r2Y));
      var v2Y: number = bB!.m_linearVelocity!.y + (bB!.m_angularVelocity * r2X);
      var Cdot: number = (this.m_u!.x * (v2X - v1X) + this.m_u!.y * (v2Y - v1Y));
      var impulse: number = (-this.m_mass * (Cdot + this.m_bias + this.m_gamma * this.m_impulse));
      this.m_impulse += impulse;
      var PX: number = impulse * this.m_u!.x;
      var PY: number = impulse * this.m_u!.y;
      bA!.m_linearVelocity!.x -= bA!.m_invMass * PX;
      bA!.m_linearVelocity!.y -= bA!.m_invMass * PY;
      bA!.m_angularVelocity -= bA!.m_invI * (r1X * PY - r1Y * PX);
      bB!.m_linearVelocity!.x += bB!.m_invMass * PX;
      bB!.m_linearVelocity!.y += bB!.m_invMass * PY;
      bB!.m_angularVelocity += bB!.m_invI * (r2X * PY - r2Y * PX);
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var tMat: (b2Mat22 | null) | undefined;
      if (this.m_frequencyHz > 0.0) {
         return true;
      }
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var dX: number = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
      var dY: number = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
      var length: number = Math.sqrt(dX * dX + dY * dY);
      dX /= length;
      dY /= length;
      var C: number = length - this.m_length;
      C = b2Math.Clamp(C, (-b2Settings.b2_maxLinearCorrection), b2Settings.b2_maxLinearCorrection);
      var impulse: number = (-this.m_mass * C);
      this.m_u!.Set(dX, dY);
      var PX: number = impulse * this.m_u!.x;
      var PY: number = impulse * this.m_u!.y;
      bA!.m_sweep!.c!.x -= bA!.m_invMass * PX;
      bA!.m_sweep!.c!.y -= bA!.m_invMass * PY;
      bA!.m_sweep!.a -= bA!.m_invI * (r1X * PY - r1Y * PX);
      bB!.m_sweep!.c!.x += bB!.m_invMass * PX;
      bB!.m_sweep!.c!.y += bB!.m_invMass * PY;
      bB!.m_sweep!.a += bB!.m_invI * (r2X * PY - r2Y * PX);
      bA!.SynchronizeTransform();
      bB!.SynchronizeTransform();
      return b2Math.Abs(C) < b2Settings.b2_linearSlop;
   }
}

class b2JointDef {
   declare type: number;
   declare userData: unknown;
   declare bodyA: (b2Body | null);
   declare bodyB: (b2Body | null);
   declare collideConnected: boolean;

   constructor() {

      if (new.target === b2JointDef) this.b2JointDef();
   }
   b2JointDef(): void {
      this.type = b2Joint.e_unknownJoint;
      this.userData = null;
      this.bodyA = null;
      this.bodyB = null;
      this.collideConnected = false;
   }
}

class b2DistanceJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare length: number;
   declare frequencyHz: number;
   declare dampingRatio: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();

      if (new.target === b2DistanceJointDef) this.b2DistanceJointDef();
   }
   b2DistanceJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_distanceJoint;
      this.length = 1.0;
      this.frequencyHz = 0.0;
      this.dampingRatio = 0.0;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchorA: (b2Vec2 | null), anchorB: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA!.SetV(this.bodyA!.GetLocalPoint(anchorA));
      this.localAnchorB!.SetV(this.bodyB!.GetLocalPoint(anchorB));
      var dX: number = anchorB!.x - anchorA!.x;
      var dY: number = anchorB!.y - anchorA!.y;
      this.length = Math.sqrt(dX * dX + dY * dY);
      this.frequencyHz = 0.0;
      this.dampingRatio = 0.0;
   }
}

class b2FrictionJoint extends b2Joint {
   declare m_localAnchorA: (b2Vec2 | null);
   declare m_localAnchorB: (b2Vec2 | null);
   declare m_linearMass: (b2Mat22 | null);
   declare m_angularMass: number;
   declare m_linearImpulse: (b2Vec2 | null);
   declare m_angularImpulse: number;
   declare m_maxForce: number;
   declare m_maxTorque: number;

   constructor(def?: (b2FrictionJointDef | null)) {
      super();


      this.m_localAnchorA = new b2Vec2();
      this.m_localAnchorB = new b2Vec2();
      this.m_linearMass = new b2Mat22();
      this.m_linearImpulse = new b2Vec2();

      if (new.target === b2FrictionJoint) this.b2FrictionJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchorA);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchorB);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_linearImpulse!.x, inv_dt * this.m_linearImpulse!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return inv_dt * this.m_angularImpulse;
   }
   SetMaxForce(force: number): void {
      if (force === undefined) force = 0;
      this.m_maxForce = force;
   }
   GetMaxForce(): number {
      return this.m_maxForce;
   }
   SetMaxTorque(torque: number): void {
      if (torque === undefined) torque = 0;
      this.m_maxTorque = torque;
   }
   GetMaxTorque(): number {
      return this.m_maxTorque;
   }
   b2FrictionJoint(def: (b2FrictionJointDef | null)): void {
      super.b2Joint(def);
      this.m_localAnchorA!.SetV(def!.localAnchorA);
      this.m_localAnchorB!.SetV(def!.localAnchorB);
      this.m_linearMass!.SetZero();
      this.m_angularMass = 0.0;
      this.m_linearImpulse!.SetZero();
      this.m_angularImpulse = 0.0;
      this.m_maxForce = def!.maxForce;
      this.m_maxTorque = def!.maxTorque;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var rAX: number = this.m_localAnchorA!.x - bA!.m_sweep!.localCenter!.x;
      var rAY: number = this.m_localAnchorA!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rAX + tMat!.col2!.x * rAY);
      rAY = (tMat!.col1!.y * rAX + tMat!.col2!.y * rAY);
      rAX = tX;
      tMat = bB!.m_xf!.R;
      var rBX: number = this.m_localAnchorB!.x - bB!.m_sweep!.localCenter!.x;
      var rBY: number = this.m_localAnchorB!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rBX + tMat!.col2!.x * rBY);
      rBY = (tMat!.col1!.y * rBX + tMat!.col2!.y * rBY);
      rBX = tX;
      var mA: number = bA!.m_invMass;
      var mB: number = bB!.m_invMass;
      var iA: number = bA!.m_invI;
      var iB: number = bB!.m_invI;
      var K: (b2Mat22 | null) = new b2Mat22();
      K!.col1!.x = mA + mB;
      K!.col2!.x = 0.0;
      K!.col1!.y = 0.0;
      K!.col2!.y = mA + mB;
      K!.col1!.x += iA * rAY * rAY;
      K!.col2!.x += (-iA * rAX * rAY);
      K!.col1!.y += (-iA * rAX * rAY);
      K!.col2!.y += iA * rAX * rAX;
      K!.col1!.x += iB * rBY * rBY;
      K!.col2!.x += (-iB * rBX * rBY);
      K!.col1!.y += (-iB * rBX * rBY);
      K!.col2!.y += iB * rBX * rBX;
      K!.GetInverse(this.m_linearMass);
      this.m_angularMass = iA + iB;
      if (this.m_angularMass > 0.0) {
         this.m_angularMass = 1.0 / this.m_angularMass;
      }
      if (step!.warmStarting) {
         this.m_linearImpulse!.x *= step!.dtRatio;
         this.m_linearImpulse!.y *= step!.dtRatio;
         this.m_angularImpulse *= step!.dtRatio;
         var P: (b2Vec2 | null) = this.m_linearImpulse;
         bA!.m_linearVelocity!.x -= mA * P!.x;
         bA!.m_linearVelocity!.y -= mA * P!.y;
         bA!.m_angularVelocity -= iA * (rAX * P!.y - rAY * P!.x + this.m_angularImpulse);
         bB!.m_linearVelocity!.x += mB * P!.x;
         bB!.m_linearVelocity!.y += mB * P!.y;
         bB!.m_angularVelocity += iB * (rBX * P!.y - rBY * P!.x + this.m_angularImpulse);
      }
      else {
         this.m_linearImpulse!.SetZero();
         this.m_angularImpulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var vA: (b2Vec2 | null) = bA!.m_linearVelocity;
      var wA: number = bA!.m_angularVelocity;
      var vB: (b2Vec2 | null) = bB!.m_linearVelocity;
      var wB: number = bB!.m_angularVelocity;
      var mA: number = bA!.m_invMass;
      var mB: number = bB!.m_invMass;
      var iA: number = bA!.m_invI;
      var iB: number = bB!.m_invI;
      tMat = bA!.m_xf!.R;
      var rAX: number = this.m_localAnchorA!.x - bA!.m_sweep!.localCenter!.x;
      var rAY: number = this.m_localAnchorA!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rAX + tMat!.col2!.x * rAY);
      rAY = (tMat!.col1!.y * rAX + tMat!.col2!.y * rAY);
      rAX = tX;
      tMat = bB!.m_xf!.R;
      var rBX: number = this.m_localAnchorB!.x - bB!.m_sweep!.localCenter!.x;
      var rBY: number = this.m_localAnchorB!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rBX + tMat!.col2!.x * rBY);
      rBY = (tMat!.col1!.y * rBX + tMat!.col2!.y * rBY);
      rBX = tX;
      var maxImpulse: number = 0; {
         var Cdot: number = wB - wA;
         var impulse: number = (-this.m_angularMass * Cdot);
         var oldImpulse: number = this.m_angularImpulse;
         maxImpulse = step!.dt * this.m_maxTorque;
         this.m_angularImpulse = b2Math.Clamp(this.m_angularImpulse + impulse, (-maxImpulse), maxImpulse);
         impulse = this.m_angularImpulse - oldImpulse;
         wA -= iA * impulse;
         wB += iB * impulse;
      } {
         var CdotX: number = vB!.x - wB * rBY - vA!.x + wA * rAY;
         var CdotY: number = vB!.y + wB * rBX - vA!.y - wA * rAX;
         var impulseV: (b2Vec2 | null) = b2Math.MulMV(this.m_linearMass, new b2Vec2((-CdotX), (-CdotY)));
         var oldImpulseV: (b2Vec2 | null) = this.m_linearImpulse!.Copy();
         this.m_linearImpulse!.Add(impulseV);
         maxImpulse = step!.dt * this.m_maxForce;
         if (this.m_linearImpulse!.LengthSquared() > maxImpulse * maxImpulse) {
            this.m_linearImpulse!.Normalize();
            this.m_linearImpulse!.Multiply(maxImpulse);
         }
         impulseV = b2Math.SubtractVV(this.m_linearImpulse, oldImpulseV);
         vA!.x -= mA * impulseV!.x;
         vA!.y -= mA * impulseV!.y;
         wA -= iA * (rAX * impulseV!.y - rAY * impulseV!.x);
         vB!.x += mB * impulseV!.x;
         vB!.y += mB * impulseV!.y;
         wB += iB * (rBX * impulseV!.y - rBY * impulseV!.x);
      }
      bA!.m_angularVelocity = wA;
      bB!.m_angularVelocity = wB;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      return true;
   }
}

class b2FrictionJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare maxForce: number;
   declare maxTorque: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();

      if (new.target === b2FrictionJointDef) this.b2FrictionJointDef();
   }
   b2FrictionJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_frictionJoint;
      this.maxForce = 0.0;
      this.maxTorque = 0.0;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchor: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA!.SetV(this.bodyA!.GetLocalPoint(anchor));
      this.localAnchorB!.SetV(this.bodyB!.GetLocalPoint(anchor));
   }
}

class b2GearJoint extends b2Joint {
   declare m_ground1: (b2Body | null);
   declare m_ground2: (b2Body | null);
   declare m_revolute1: (b2RevoluteJoint | null);
   declare m_prismatic1: (b2PrismaticJoint | null);
   declare m_revolute2: (b2RevoluteJoint | null);
   declare m_prismatic2: (b2PrismaticJoint | null);
   declare m_groundAnchor1: (b2Vec2 | null);
   declare m_groundAnchor2: (b2Vec2 | null);
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_J: (b2Jacobian | null);
   declare m_constant: number;
   declare m_ratio: number;
   declare m_mass: number;
   declare m_impulse: number;

   constructor(def?: (b2GearJointDef | null)) {
      super();


      this.m_groundAnchor1 = new b2Vec2();
      this.m_groundAnchor2 = new b2Vec2();
      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_J = new b2Jacobian();

      if (new.target === b2GearJoint) this.b2GearJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse * this.m_J!.linearB!.x, inv_dt * this.m_impulse * this.m_J!.linearB!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      var tMat: (b2Mat22 | null) = this.m_bodyB!.m_xf!.R;
      var rX: number = this.m_localAnchor1!.x - this.m_bodyB!.m_sweep!.localCenter!.x;
      var rY: number = this.m_localAnchor1!.y - this.m_bodyB!.m_sweep!.localCenter!.y;
      var tX: number = tMat!.col1!.x * rX + tMat!.col2!.x * rY;
      rY = tMat!.col1!.y * rX + tMat!.col2!.y * rY;
      rX = tX;
      var PX: number = this.m_impulse * this.m_J!.linearB!.x;
      var PY: number = this.m_impulse * this.m_J!.linearB!.y;
      return inv_dt * (this.m_impulse * this.m_J!.angularB - rX * PY + rY * PX);
   }
   GetRatio(): number {
      return this.m_ratio;
   }
   SetRatio(ratio: number): void {
      if (ratio === undefined) ratio = 0;
      this.m_ratio = ratio;
   }
   b2GearJoint(def: (b2GearJointDef | null)): void {
      super.b2Joint(def);
      var type1: number = parseInt(String(def!.joint1!.m_type));
      var type2: number = parseInt(String(def!.joint2!.m_type));
      this.m_revolute1 = null;
      this.m_prismatic1 = null;
      this.m_revolute2 = null;
      this.m_prismatic2 = null;
      var coordinate1: number = 0;
      var coordinate2: number = 0;
      this.m_ground1 = def!.joint1!.GetBodyA();
      this.m_bodyA = def!.joint1!.GetBodyB();
      if (type1 == b2Joint.e_revoluteJoint) {
         this.m_revolute1 = (def!.joint1 instanceof b2RevoluteJoint ? (def!.joint1) : null);
         this.m_groundAnchor1!.SetV(this.m_revolute1!.m_localAnchor1);
         this.m_localAnchor1!.SetV(this.m_revolute1!.m_localAnchor2);
         coordinate1 = this.m_revolute1!.GetJointAngle();
      }
      else {
         this.m_prismatic1 = (def!.joint1 instanceof b2PrismaticJoint ? (def!.joint1) : null);
         this.m_groundAnchor1!.SetV(this.m_prismatic1!.m_localAnchor1);
         this.m_localAnchor1!.SetV(this.m_prismatic1!.m_localAnchor2);
         coordinate1 = this.m_prismatic1!.GetJointTranslation();
      }
      this.m_ground2 = def!.joint2!.GetBodyA();
      this.m_bodyB = def!.joint2!.GetBodyB();
      if (type2 == b2Joint.e_revoluteJoint) {
         this.m_revolute2 = (def!.joint2 instanceof b2RevoluteJoint ? (def!.joint2) : null);
         this.m_groundAnchor2!.SetV(this.m_revolute2!.m_localAnchor1);
         this.m_localAnchor2!.SetV(this.m_revolute2!.m_localAnchor2);
         coordinate2 = this.m_revolute2!.GetJointAngle();
      }
      else {
         this.m_prismatic2 = (def!.joint2 instanceof b2PrismaticJoint ? (def!.joint2) : null);
         this.m_groundAnchor2!.SetV(this.m_prismatic2!.m_localAnchor1);
         this.m_localAnchor2!.SetV(this.m_prismatic2!.m_localAnchor2);
         coordinate2 = this.m_prismatic2!.GetJointTranslation();
      }
      this.m_ratio = def!.ratio;
      this.m_constant = coordinate1 + this.m_ratio * coordinate2;
      this.m_impulse = 0.0;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var g1: (b2Body | null) = this.m_ground1;
      var g2: (b2Body | null) = this.m_ground2;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var ugX: number = 0;
      var ugY: number = 0;
      var rX: number = 0;
      var rY: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tVec: (b2Vec2 | null) | undefined;
      var crug: number = 0;
      var tX: number = 0;
      var K: number = 0.0;
      this.m_J!.SetZero();
      if (this.m_revolute1) {
         this.m_J!.angularA = (-1.0);
         K += bA!.m_invI;
      }
      else {
         tMat = g1!.m_xf!.R;
         tVec = this.m_prismatic1!.m_localXAxis1;
         ugX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
         ugY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
         tMat = bA!.m_xf!.R;
         rX = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         rY = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = tMat!.col1!.x * rX + tMat!.col2!.x * rY;
         rY = tMat!.col1!.y * rX + tMat!.col2!.y * rY;
         rX = tX;
         crug = rX * ugY - rY * ugX;
         this.m_J!.linearA!.Set((-ugX), (-ugY));
         this.m_J!.angularA = (-crug);
         K += bA!.m_invMass + bA!.m_invI * crug * crug;
      }
      if (this.m_revolute2) {
         this.m_J!.angularB = (-this.m_ratio);
         K += this.m_ratio * this.m_ratio * bB!.m_invI;
      }
      else {
         tMat = g2!.m_xf!.R;
         tVec = this.m_prismatic2!.m_localXAxis1;
         ugX = tMat!.col1!.x * tVec!.x + tMat!.col2!.x * tVec!.y;
         ugY = tMat!.col1!.y * tVec!.x + tMat!.col2!.y * tVec!.y;
         tMat = bB!.m_xf!.R;
         rX = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         rY = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = tMat!.col1!.x * rX + tMat!.col2!.x * rY;
         rY = tMat!.col1!.y * rX + tMat!.col2!.y * rY;
         rX = tX;
         crug = rX * ugY - rY * ugX;
         this.m_J!.linearB!.Set((-this.m_ratio * ugX), (-this.m_ratio * ugY));
         this.m_J!.angularB = (-this.m_ratio * crug);
         K += this.m_ratio * this.m_ratio * (bB!.m_invMass + bB!.m_invI * crug * crug);
      }
      this.m_mass = K > 0.0 ? 1.0 / K : 0.0;
      if (step!.warmStarting) {
         bA!.m_linearVelocity!.x += bA!.m_invMass * this.m_impulse * this.m_J!.linearA!.x;
         bA!.m_linearVelocity!.y += bA!.m_invMass * this.m_impulse * this.m_J!.linearA!.y;
         bA!.m_angularVelocity += bA!.m_invI * this.m_impulse * this.m_J!.angularA;
         bB!.m_linearVelocity!.x += bB!.m_invMass * this.m_impulse * this.m_J!.linearB!.x;
         bB!.m_linearVelocity!.y += bB!.m_invMass * this.m_impulse * this.m_J!.linearB!.y;
         bB!.m_angularVelocity += bB!.m_invI * this.m_impulse * this.m_J!.angularB;
      }
      else {
         this.m_impulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var Cdot: number = this.m_J!.Compute(bA!.m_linearVelocity, bA!.m_angularVelocity, bB!.m_linearVelocity, bB!.m_angularVelocity);
      var impulse: number = (-this.m_mass * Cdot);
      this.m_impulse += impulse;
      bA!.m_linearVelocity!.x += bA!.m_invMass * impulse * this.m_J!.linearA!.x;
      bA!.m_linearVelocity!.y += bA!.m_invMass * impulse * this.m_J!.linearA!.y;
      bA!.m_angularVelocity += bA!.m_invI * impulse * this.m_J!.angularA;
      bB!.m_linearVelocity!.x += bB!.m_invMass * impulse * this.m_J!.linearB!.x;
      bB!.m_linearVelocity!.y += bB!.m_invMass * impulse * this.m_J!.linearB!.y;
      bB!.m_angularVelocity += bB!.m_invI * impulse * this.m_J!.angularB;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var linearError: number = 0.0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var coordinate1: number = 0;
      var coordinate2: number = 0;
      if (this.m_revolute1) {
         coordinate1 = this.m_revolute1!.GetJointAngle();
      }
      else {
         coordinate1 = this.m_prismatic1!.GetJointTranslation();
      }
      if (this.m_revolute2) {
         coordinate2 = this.m_revolute2!.GetJointAngle();
      }
      else {
         coordinate2 = this.m_prismatic2!.GetJointTranslation();
      }
      var C: number = this.m_constant - (coordinate1 + this.m_ratio * coordinate2);
      var impulse: number = (-this.m_mass * C);
      bA!.m_sweep!.c!.x += bA!.m_invMass * impulse * this.m_J!.linearA!.x;
      bA!.m_sweep!.c!.y += bA!.m_invMass * impulse * this.m_J!.linearA!.y;
      bA!.m_sweep!.a += bA!.m_invI * impulse * this.m_J!.angularA;
      bB!.m_sweep!.c!.x += bB!.m_invMass * impulse * this.m_J!.linearB!.x;
      bB!.m_sweep!.c!.y += bB!.m_invMass * impulse * this.m_J!.linearB!.y;
      bB!.m_sweep!.a += bB!.m_invI * impulse * this.m_J!.angularB;
      bA!.SynchronizeTransform();
      bB!.SynchronizeTransform();
      return linearError < b2Settings.b2_linearSlop;
   }
}

class b2GearJointDef extends b2JointDef {
   declare joint1: (b2Joint | null);
   declare joint2: (b2Joint | null);
   declare ratio: number;

   constructor() {
      super();



      if (new.target === b2GearJointDef) this.b2GearJointDef();
   }
   b2GearJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_gearJoint;
      this.joint1 = null;
      this.joint2 = null;
      this.ratio = 1.0;
   }
}

class b2Jacobian {
   declare linearA: (b2Vec2 | null);
   declare angularA: number;
   declare linearB: (b2Vec2 | null);
   declare angularB: number;

   constructor() {

      this.linearA = new b2Vec2();
      this.linearB = new b2Vec2();

   }
   SetZero(): void {
      this.linearA!.SetZero();
      this.angularA = 0.0;
      this.linearB!.SetZero();
      this.angularB = 0.0;
   }
   Set(x1: (b2Vec2 | null), a1: number, x2: (b2Vec2 | null), a2: number): void {
      if (a1 === undefined) a1 = 0;
      if (a2 === undefined) a2 = 0;
      this.linearA!.SetV(x1);
      this.angularA = a1;
      this.linearB!.SetV(x2);
      this.angularB = a2;
   }
   Compute(x1: (b2Vec2 | null), a1: number, x2: (b2Vec2 | null), a2: number): number {
      if (a1 === undefined) a1 = 0;
      if (a2 === undefined) a2 = 0;
      return (this.linearA!.x * x1!.x + this.linearA!.y * x1!.y) + this.angularA * a1 + (this.linearB!.x * x2!.x + this.linearB!.y * x2!.y) + this.angularB * a2;
   }
}

class b2JointEdge {
   declare other: (b2Body | null);
   declare joint: (b2Joint | null);
   declare prev: (b2JointEdge | null);
   declare next: (b2JointEdge | null);

   constructor() {

   }
}

class b2LineJoint extends b2Joint {
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_localXAxis1: (b2Vec2 | null);
   declare m_localYAxis1: (b2Vec2 | null);
   declare m_axis: (b2Vec2 | null);
   declare m_perp: (b2Vec2 | null);
   declare m_s1: number;
   declare m_s2: number;
   declare m_a1: number;
   declare m_a2: number;
   declare m_K: (b2Mat22 | null);
   declare m_impulse: (b2Vec2 | null);
   declare m_motorMass: number;
   declare m_motorImpulse: number;
   declare m_lowerTranslation: number;
   declare m_upperTranslation: number;
   declare m_maxMotorForce: number;
   declare m_motorSpeed: number;
   declare m_enableLimit: boolean;
   declare m_enableMotor: boolean;
   declare m_limitState: number;

   constructor(def?: (b2LineJointDef | null)) {
      super();


      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_localXAxis1 = new b2Vec2();
      this.m_localYAxis1 = new b2Vec2();
      this.m_axis = new b2Vec2();
      this.m_perp = new b2Vec2();
      this.m_K = new b2Mat22();
      this.m_impulse = new b2Vec2();

      if (new.target === b2LineJoint) this.b2LineJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * (this.m_impulse!.x * this.m_perp!.x + (this.m_motorImpulse + this.m_impulse!.y) * this.m_axis!.x), inv_dt * (this.m_impulse!.x * this.m_perp!.y + (this.m_motorImpulse + this.m_impulse!.y) * this.m_axis!.y));
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return inv_dt * this.m_impulse!.y;
   }
   GetJointTranslation(): number {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var p1: (b2Vec2 | null) = bA!.GetWorldPoint(this.m_localAnchor1);
      var p2: (b2Vec2 | null) = bB!.GetWorldPoint(this.m_localAnchor2);
      var dX: number = p2!.x - p1!.x;
      var dY: number = p2!.y - p1!.y;
      var axis: (b2Vec2 | null) = bA!.GetWorldVector(this.m_localXAxis1);
      var translation: number = axis!.x * dX + axis!.y * dY;
      return translation;
   }
   GetJointSpeed(): number {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var p1X: number = bA!.m_sweep!.c!.x + r1X;
      var p1Y: number = bA!.m_sweep!.c!.y + r1Y;
      var p2X: number = bB!.m_sweep!.c!.x + r2X;
      var p2Y: number = bB!.m_sweep!.c!.y + r2Y;
      var dX: number = p2X - p1X;
      var dY: number = p2Y - p1Y;
      var axis: (b2Vec2 | null) = bA!.GetWorldVector(this.m_localXAxis1);
      var v1: (b2Vec2 | null) = bA!.m_linearVelocity;
      var v2: (b2Vec2 | null) = bB!.m_linearVelocity;
      var w1: number = bA!.m_angularVelocity;
      var w2: number = bB!.m_angularVelocity;
      var speed: number = (dX * ((-w1 * axis!.y)) + dY * (w1 * axis!.x)) + (axis!.x * (((v2!.x + ((-w2 * r2Y))) - v1!.x) - ((-w1 * r1Y))) + axis!.y * (((v2!.y + (w2 * r2X)) - v1!.y) - (w1 * r1X)));
      return speed;
   }
   IsLimitEnabled(): boolean {
      return this.m_enableLimit;
   }
   EnableLimit(flag: boolean): void {
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_enableLimit = flag;
   }
   GetLowerLimit(): number {
      return this.m_lowerTranslation;
   }
   GetUpperLimit(): number {
      return this.m_upperTranslation;
   }
   SetLimits(lower: number, upper: number): void {
      if (lower === undefined) lower = 0;
      if (upper === undefined) upper = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_lowerTranslation = lower;
      this.m_upperTranslation = upper;
   }
   IsMotorEnabled(): boolean {
      return this.m_enableMotor;
   }
   EnableMotor(flag: boolean): void {
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_enableMotor = flag;
   }
   SetMotorSpeed(speed: number): void {
      if (speed === undefined) speed = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_motorSpeed = speed;
   }
   GetMotorSpeed(): number {
      return this.m_motorSpeed;
   }
   SetMaxMotorForce(force: number): void {
      if (force === undefined) force = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_maxMotorForce = force;
   }
   GetMaxMotorForce(): number {
      return this.m_maxMotorForce;
   }
   GetMotorForce(): number {
      return this.m_motorImpulse;
   }
   b2LineJoint(def: (b2LineJointDef | null)): void {
      super.b2Joint(def);
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var tY: number = 0;
      this.m_localAnchor1!.SetV(def!.localAnchorA);
      this.m_localAnchor2!.SetV(def!.localAnchorB);
      this.m_localXAxis1!.SetV(def!.localAxisA);
      this.m_localYAxis1!.x = (-this.m_localXAxis1!.y);
      this.m_localYAxis1!.y = this.m_localXAxis1!.x;
      this.m_impulse!.SetZero();
      this.m_motorMass = 0.0;
      this.m_motorImpulse = 0.0;
      this.m_lowerTranslation = def!.lowerTranslation;
      this.m_upperTranslation = def!.upperTranslation;
      this.m_maxMotorForce = def!.maxMotorForce;
      this.m_motorSpeed = def!.motorSpeed;
      this.m_enableLimit = def!.enableLimit;
      this.m_enableMotor = def!.enableMotor;
      this.m_limitState = b2Joint.e_inactiveLimit;
      this.m_axis!.SetZero();
      this.m_perp!.SetZero();
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      this.m_localCenterA!.SetV(bA!.GetLocalCenter());
      this.m_localCenterB!.SetV(bB!.GetLocalCenter());
      var xf1: (b2Transform | null) = bA!.GetTransform();
      var xf2: (b2Transform | null) = bB!.GetTransform();
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - this.m_localCenterA!.x;
      var r1Y: number = this.m_localAnchor1!.y - this.m_localCenterA!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - this.m_localCenterB!.x;
      var r2Y: number = this.m_localAnchor2!.y - this.m_localCenterB!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var dX: number = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
      var dY: number = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
      this.m_invMassA = bA!.m_invMass;
      this.m_invMassB = bB!.m_invMass;
      this.m_invIA = bA!.m_invI;
      this.m_invIB = bB!.m_invI; {
         this.m_axis!.SetV(b2Math.MulMV(xf1!.R, this.m_localXAxis1));
         this.m_a1 = (dX + r1X) * this.m_axis!.y - (dY + r1Y) * this.m_axis!.x;
         this.m_a2 = r2X * this.m_axis!.y - r2Y * this.m_axis!.x;
         this.m_motorMass = this.m_invMassA + this.m_invMassB + this.m_invIA * this.m_a1 * this.m_a1 + this.m_invIB * this.m_a2 * this.m_a2;
         this.m_motorMass = this.m_motorMass > Number.MIN_VALUE ? 1.0 / this.m_motorMass : 0.0;
      } {
         this.m_perp!.SetV(b2Math.MulMV(xf1!.R, this.m_localYAxis1));
         this.m_s1 = (dX + r1X) * this.m_perp!.y - (dY + r1Y) * this.m_perp!.x;
         this.m_s2 = r2X * this.m_perp!.y - r2Y * this.m_perp!.x;
         var m1: number = this.m_invMassA;
         var m2: number = this.m_invMassB;
         var i1: number = this.m_invIA;
         var i2: number = this.m_invIB;
         this.m_K!.col1!.x = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         this.m_K!.col1!.y = i1 * this.m_s1 * this.m_a1 + i2 * this.m_s2 * this.m_a2;
         this.m_K!.col2!.x = this.m_K!.col1!.y;
         this.m_K!.col2!.y = m1 + m2 + i1 * this.m_a1 * this.m_a1 + i2 * this.m_a2 * this.m_a2;
      }
      if (this.m_enableLimit) {
         var jointTransition: number = this.m_axis!.x * dX + this.m_axis!.y * dY;
         if (b2Math.Abs(this.m_upperTranslation - this.m_lowerTranslation) < 2.0 * b2Settings.b2_linearSlop) {
            this.m_limitState = b2Joint.e_equalLimits;
         }
         else if (jointTransition <= this.m_lowerTranslation) {
            if (this.m_limitState != b2Joint.e_atLowerLimit) {
               this.m_limitState = b2Joint.e_atLowerLimit;
               this.m_impulse!.y = 0.0;
            }
         }
         else if (jointTransition >= this.m_upperTranslation) {
            if (this.m_limitState != b2Joint.e_atUpperLimit) {
               this.m_limitState = b2Joint.e_atUpperLimit;
               this.m_impulse!.y = 0.0;
            }
         }
         else {
            this.m_limitState = b2Joint.e_inactiveLimit;
            this.m_impulse!.y = 0.0;
         }
      }
      else {
         this.m_limitState = b2Joint.e_inactiveLimit;
      }
      if (this.m_enableMotor == false) {
         this.m_motorImpulse = 0.0;
      }
      if (step!.warmStarting) {
         this.m_impulse!.x *= step!.dtRatio;
         this.m_impulse!.y *= step!.dtRatio;
         this.m_motorImpulse *= step!.dtRatio;
         var PX: number = this.m_impulse!.x * this.m_perp!.x + (this.m_motorImpulse + this.m_impulse!.y) * this.m_axis!.x;
         var PY: number = this.m_impulse!.x * this.m_perp!.y + (this.m_motorImpulse + this.m_impulse!.y) * this.m_axis!.y;
         var L1: number = this.m_impulse!.x * this.m_s1 + (this.m_motorImpulse + this.m_impulse!.y) * this.m_a1;
         var L2: number = this.m_impulse!.x * this.m_s2 + (this.m_motorImpulse + this.m_impulse!.y) * this.m_a2;
         bA!.m_linearVelocity!.x -= this.m_invMassA * PX;
         bA!.m_linearVelocity!.y -= this.m_invMassA * PY;
         bA!.m_angularVelocity -= this.m_invIA * L1;
         bB!.m_linearVelocity!.x += this.m_invMassB * PX;
         bB!.m_linearVelocity!.y += this.m_invMassB * PY;
         bB!.m_angularVelocity += this.m_invIB * L2;
      }
      else {
         this.m_impulse!.SetZero();
         this.m_motorImpulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var v1: (b2Vec2 | null) = bA!.m_linearVelocity;
      var w1: number = bA!.m_angularVelocity;
      var v2: (b2Vec2 | null) = bB!.m_linearVelocity;
      var w2: number = bB!.m_angularVelocity;
      var PX: number = 0;
      var PY: number = 0;
      var L1: number = 0;
      var L2: number = 0;
      if (this.m_enableMotor && this.m_limitState != b2Joint.e_equalLimits) {
         var Cdot: number = this.m_axis!.x * (v2!.x - v1!.x) + this.m_axis!.y * (v2!.y - v1!.y) + this.m_a2 * w2 - this.m_a1 * w1;
         var impulse: number = this.m_motorMass * (this.m_motorSpeed - Cdot);
         var oldImpulse: number = this.m_motorImpulse;
         var maxImpulse: number = step!.dt * this.m_maxMotorForce;
         this.m_motorImpulse = b2Math.Clamp(this.m_motorImpulse + impulse, (-maxImpulse), maxImpulse);
         impulse = this.m_motorImpulse - oldImpulse;
         PX = impulse * this.m_axis!.x;
         PY = impulse * this.m_axis!.y;
         L1 = impulse * this.m_a1;
         L2 = impulse * this.m_a2;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      var Cdot1: number = this.m_perp!.x * (v2!.x - v1!.x) + this.m_perp!.y * (v2!.y - v1!.y) + this.m_s2 * w2 - this.m_s1 * w1;
      if (this.m_enableLimit && this.m_limitState != b2Joint.e_inactiveLimit) {
         var Cdot2: number = this.m_axis!.x * (v2!.x - v1!.x) + this.m_axis!.y * (v2!.y - v1!.y) + this.m_a2 * w2 - this.m_a1 * w1;
         var f1: (b2Vec2 | null) = this.m_impulse!.Copy();
         var df: (b2Vec2 | null) = this.m_K!.Solve(new b2Vec2(), (-Cdot1), (-Cdot2));
         this.m_impulse!.Add(df);
         if (this.m_limitState == b2Joint.e_atLowerLimit) {
            this.m_impulse!.y = b2Math.Max(this.m_impulse!.y, 0.0);
         }
         else if (this.m_limitState == b2Joint.e_atUpperLimit) {
            this.m_impulse!.y = b2Math.Min(this.m_impulse!.y, 0.0);
         }
         var b: number = (-Cdot1) - (this.m_impulse!.y - f1!.y) * this.m_K!.col2!.x;
         var f2r: number = 0;
         if (this.m_K!.col1!.x != 0.0) {
            f2r = b / this.m_K!.col1!.x + f1!.x;
         }
         else {
            f2r = f1!.x;
         }
         this.m_impulse!.x = f2r;
         df!.x = this.m_impulse!.x - f1!.x;
         df!.y = this.m_impulse!.y - f1!.y;
         PX = df!.x * this.m_perp!.x + df!.y * this.m_axis!.x;
         PY = df!.x * this.m_perp!.y + df!.y * this.m_axis!.y;
         L1 = df!.x * this.m_s1 + df!.y * this.m_a1;
         L2 = df!.x * this.m_s2 + df!.y * this.m_a2;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      else {
         var df2: number = 0;
         if (this.m_K!.col1!.x != 0.0) {
            df2 = ((-Cdot1)) / this.m_K!.col1!.x;
         }
         else {
            df2 = 0.0;
         }
         this.m_impulse!.x += df2;
         PX = df2 * this.m_perp!.x;
         PY = df2 * this.m_perp!.y;
         L1 = df2 * this.m_s1;
         L2 = df2 * this.m_s2;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      bA!.m_linearVelocity!.SetV(v1);
      bA!.m_angularVelocity = w1;
      bB!.m_linearVelocity!.SetV(v2);
      bB!.m_angularVelocity = w2;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var limitC: number = 0;
      var oldLimitImpulse: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var c1: (b2Vec2 | null) = bA!.m_sweep!.c;
      var a1: number = bA!.m_sweep!.a;
      var c2: (b2Vec2 | null) = bB!.m_sweep!.c;
      var a2: number = bB!.m_sweep!.a;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var m1: number = 0;
      var m2: number = 0;
      var i1: number = 0;
      var i2: number = 0;
      var linearError: number = 0.0;
      var angularError: number = 0.0;
      var active: boolean = false;
      var C2: number = 0.0;
      var R1: (b2Mat22 | null) = b2Mat22.FromAngle(a1);
      var R2: (b2Mat22 | null) = b2Mat22.FromAngle(a2);
      tMat = R1;
      var r1X: number = this.m_localAnchor1!.x - this.m_localCenterA!.x;
      var r1Y: number = this.m_localAnchor1!.y - this.m_localCenterA!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = R2;
      var r2X: number = this.m_localAnchor2!.x - this.m_localCenterB!.x;
      var r2Y: number = this.m_localAnchor2!.y - this.m_localCenterB!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var dX: number = c2!.x + r2X - c1!.x - r1X;
      var dY: number = c2!.y + r2Y - c1!.y - r1Y;
      if (this.m_enableLimit) {
         this.m_axis = b2Math.MulMV(R1, this.m_localXAxis1);
         this.m_a1 = (dX + r1X) * this.m_axis!.y - (dY + r1Y) * this.m_axis!.x;
         this.m_a2 = r2X * this.m_axis!.y - r2Y * this.m_axis!.x;
         var translation: number = this.m_axis!.x * dX + this.m_axis!.y * dY;
         if (b2Math.Abs(this.m_upperTranslation - this.m_lowerTranslation) < 2.0 * b2Settings.b2_linearSlop) {
            C2 = b2Math.Clamp(translation, (-b2Settings.b2_maxLinearCorrection), b2Settings.b2_maxLinearCorrection);
            linearError = b2Math.Abs(translation);
            active = true;
         }
         else if (translation <= this.m_lowerTranslation) {
            C2 = b2Math.Clamp(translation - this.m_lowerTranslation + b2Settings.b2_linearSlop, (-b2Settings.b2_maxLinearCorrection), 0.0);
            linearError = this.m_lowerTranslation - translation;
            active = true;
         }
         else if (translation >= this.m_upperTranslation) {
            C2 = b2Math.Clamp(translation - this.m_upperTranslation + b2Settings.b2_linearSlop, 0.0, b2Settings.b2_maxLinearCorrection);
            linearError = translation - this.m_upperTranslation;
            active = true;
         }
      }
      this.m_perp = b2Math.MulMV(R1, this.m_localYAxis1);
      this.m_s1 = (dX + r1X) * this.m_perp!.y - (dY + r1Y) * this.m_perp!.x;
      this.m_s2 = r2X * this.m_perp!.y - r2Y * this.m_perp!.x;
      var impulse: (b2Vec2 | null) = new b2Vec2();
      var C1: number = this.m_perp!.x * dX + this.m_perp!.y * dY;
      linearError = b2Math.Max(linearError, b2Math.Abs(C1));
      angularError = 0.0;
      if (active) {
         m1 = this.m_invMassA;
         m2 = this.m_invMassB;
         i1 = this.m_invIA;
         i2 = this.m_invIB;
         this.m_K!.col1!.x = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         this.m_K!.col1!.y = i1 * this.m_s1 * this.m_a1 + i2 * this.m_s2 * this.m_a2;
         this.m_K!.col2!.x = this.m_K!.col1!.y;
         this.m_K!.col2!.y = m1 + m2 + i1 * this.m_a1 * this.m_a1 + i2 * this.m_a2 * this.m_a2;
         this.m_K!.Solve(impulse, (-C1), (-C2));
      }
      else {
         m1 = this.m_invMassA;
         m2 = this.m_invMassB;
         i1 = this.m_invIA;
         i2 = this.m_invIB;
         var k11: number = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         var impulse1: number = 0;
         if (k11 != 0.0) {
            impulse1 = ((-C1)) / k11;
         }
         else {
            impulse1 = 0.0;
         }
         impulse!.x = impulse1;
         impulse!.y = 0.0;
      }
      var PX: number = impulse!.x * this.m_perp!.x + impulse!.y * this.m_axis!.x;
      var PY: number = impulse!.x * this.m_perp!.y + impulse!.y * this.m_axis!.y;
      var L1: number = impulse!.x * this.m_s1 + impulse!.y * this.m_a1;
      var L2: number = impulse!.x * this.m_s2 + impulse!.y * this.m_a2;
      c1!.x -= this.m_invMassA * PX;
      c1!.y -= this.m_invMassA * PY;
      a1 -= this.m_invIA * L1;
      c2!.x += this.m_invMassB * PX;
      c2!.y += this.m_invMassB * PY;
      a2 += this.m_invIB * L2;
      bA!.m_sweep!.a = a1;
      bB!.m_sweep!.a = a2;
      bA!.SynchronizeTransform();
      bB!.SynchronizeTransform();
      return linearError <= b2Settings.b2_linearSlop && angularError <= b2Settings.b2_angularSlop;
   }
}

class b2LineJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare localAxisA: (b2Vec2 | null);
   declare enableLimit: boolean;
   declare lowerTranslation: number;
   declare upperTranslation: number;
   declare enableMotor: boolean;
   declare maxMotorForce: number;
   declare motorSpeed: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();
      this.localAxisA = new b2Vec2();

      if (new.target === b2LineJointDef) this.b2LineJointDef();
   }
   b2LineJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_lineJoint;
      this.localAxisA!.Set(1.0, 0.0);
      this.enableLimit = false;
      this.lowerTranslation = 0.0;
      this.upperTranslation = 0.0;
      this.enableMotor = false;
      this.maxMotorForce = 0.0;
      this.motorSpeed = 0.0;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchor: (b2Vec2 | null), axis: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA = this.bodyA!.GetLocalPoint(anchor);
      this.localAnchorB = this.bodyB!.GetLocalPoint(anchor);
      this.localAxisA = this.bodyA!.GetLocalVector(axis);
   }
}

class b2MouseJoint extends b2Joint {
   declare K: (b2Mat22 | null);
   declare K1: (b2Mat22 | null);
   declare K2: (b2Mat22 | null);
   declare m_localAnchor: (b2Vec2 | null);
   declare m_target: (b2Vec2 | null);
   declare m_impulse: (b2Vec2 | null);
   declare m_mass: (b2Mat22 | null);
   declare m_C: (b2Vec2 | null);
   declare m_maxForce: number;
   declare m_frequencyHz: number;
   declare m_dampingRatio: number;
   declare m_beta: number;
   declare m_gamma: number;

   constructor(def?: (b2MouseJointDef | null)) {
      super();


      this.K = new b2Mat22();
      this.K1 = new b2Mat22();
      this.K2 = new b2Mat22();
      this.m_localAnchor = new b2Vec2();
      this.m_target = new b2Vec2();
      this.m_impulse = new b2Vec2();
      this.m_mass = new b2Mat22();
      this.m_C = new b2Vec2();

      if (new.target === b2MouseJoint) this.b2MouseJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_target;
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse!.x, inv_dt * this.m_impulse!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return 0.0;
   }
   GetTarget(): (b2Vec2 | null) {
      return this.m_target;
   }
   SetTarget(target: (b2Vec2 | null)): void {
      if (this.m_bodyB!.IsAwake() == false) {
         this.m_bodyB!.SetAwake(true);
      }
      this.m_target = target;
   }
   GetMaxForce(): number {
      return this.m_maxForce;
   }
   SetMaxForce(maxForce: number): void {
      if (maxForce === undefined) maxForce = 0;
      this.m_maxForce = maxForce;
   }
   GetFrequency(): number {
      return this.m_frequencyHz;
   }
   SetFrequency(hz: number): void {
      if (hz === undefined) hz = 0;
      this.m_frequencyHz = hz;
   }
   GetDampingRatio(): number {
      return this.m_dampingRatio;
   }
   SetDampingRatio(ratio: number): void {
      if (ratio === undefined) ratio = 0;
      this.m_dampingRatio = ratio;
   }
   b2MouseJoint(def: (b2MouseJointDef | null)): void {
      super.b2Joint(def);
      this.m_target!.SetV(def!.target);
      var tX: number = this.m_target!.x - this.m_bodyB!.m_xf!.position!.x;
      var tY: number = this.m_target!.y - this.m_bodyB!.m_xf!.position!.y;
      var tMat: (b2Mat22 | null) = this.m_bodyB!.m_xf!.R;
      this.m_localAnchor!.x = (tX * tMat!.col1!.x + tY * tMat!.col1!.y);
      this.m_localAnchor!.y = (tX * tMat!.col2!.x + tY * tMat!.col2!.y);
      this.m_maxForce = def!.maxForce;
      this.m_impulse!.SetZero();
      this.m_frequencyHz = def!.frequencyHz;
      this.m_dampingRatio = def!.dampingRatio;
      this.m_beta = 0.0;
      this.m_gamma = 0.0;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var b: (b2Body | null) = this.m_bodyB;
      var mass: number = b!.GetMass();
      var omega: number = 2.0 * Math.PI * this.m_frequencyHz;
      var d: number = 2.0 * mass * this.m_dampingRatio * omega;
      var k: number = mass * omega * omega;
      this.m_gamma = step!.dt * (d + step!.dt * k);
      this.m_gamma = this.m_gamma != 0 ? 1 / this.m_gamma : 0.0;
      this.m_beta = step!.dt * k * this.m_gamma;
      var tMat: (b2Mat22 | null) | undefined;tMat = b!.m_xf!.R;
      var rX: number = this.m_localAnchor!.x - b!.m_sweep!.localCenter!.x;
      var rY: number = this.m_localAnchor!.y - b!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * rX + tMat!.col2!.x * rY);rY = (tMat!.col1!.y * rX + tMat!.col2!.y * rY);
      rX = tX;
      var invMass: number = b!.m_invMass;
      var invI: number = b!.m_invI;this.K1!.col1!.x = invMass;
      this.K1!.col2!.x = 0.0;
      this.K1!.col1!.y = 0.0;
      this.K1!.col2!.y = invMass;
      this.K2!.col1!.x = invI * rY * rY;
      this.K2!.col2!.x = (-invI * rX * rY);
      this.K2!.col1!.y = (-invI * rX * rY);
      this.K2!.col2!.y = invI * rX * rX;
      this.K!.SetM(this.K1);
      this.K!.AddM(this.K2);
      this.K!.col1!.x += this.m_gamma;
      this.K!.col2!.y += this.m_gamma;
      this.K!.GetInverse(this.m_mass);
      this.m_C!.x = b!.m_sweep!.c!.x + rX - this.m_target!.x;
      this.m_C!.y = b!.m_sweep!.c!.y + rY - this.m_target!.y;
      b!.m_angularVelocity *= 0.98;
      this.m_impulse!.x *= step!.dtRatio;
      this.m_impulse!.y *= step!.dtRatio;
      b!.m_linearVelocity!.x += invMass * this.m_impulse!.x;
      b!.m_linearVelocity!.y += invMass * this.m_impulse!.y;
      b!.m_angularVelocity += invI * (rX * this.m_impulse!.y - rY * this.m_impulse!.x);
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var b: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var tY: number = 0;
      tMat = b!.m_xf!.R;
      var rX: number = this.m_localAnchor!.x - b!.m_sweep!.localCenter!.x;
      var rY: number = this.m_localAnchor!.y - b!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rX + tMat!.col2!.x * rY);
      rY = (tMat!.col1!.y * rX + tMat!.col2!.y * rY);
      rX = tX;
      var CdotX: number = b!.m_linearVelocity!.x + ((-b!.m_angularVelocity * rY));
      var CdotY: number = b!.m_linearVelocity!.y + (b!.m_angularVelocity * rX);
      tMat = this.m_mass;
      tX = CdotX + this.m_beta * this.m_C!.x + this.m_gamma * this.m_impulse!.x;
      tY = CdotY + this.m_beta * this.m_C!.y + this.m_gamma * this.m_impulse!.y;
      var impulseX: number = (-(tMat!.col1!.x * tX + tMat!.col2!.x * tY));
      var impulseY: number = (-(tMat!.col1!.y * tX + tMat!.col2!.y * tY));
      var oldImpulseX: number = this.m_impulse!.x;
      var oldImpulseY: number = this.m_impulse!.y;
      this.m_impulse!.x += impulseX;
      this.m_impulse!.y += impulseY;
      var maxImpulse: number = step!.dt * this.m_maxForce;
      if (this.m_impulse!.LengthSquared() > maxImpulse * maxImpulse) {
         this.m_impulse!.Multiply(maxImpulse / this.m_impulse!.Length());
      }
      impulseX = this.m_impulse!.x - oldImpulseX;
      impulseY = this.m_impulse!.y - oldImpulseY;
      b!.m_linearVelocity!.x += b!.m_invMass * impulseX;
      b!.m_linearVelocity!.y += b!.m_invMass * impulseY;
      b!.m_angularVelocity += b!.m_invI * (rX * impulseY - rY * impulseX);
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      return true;
   }
}

class b2MouseJointDef extends b2JointDef {
   declare target: (b2Vec2 | null);
   declare maxForce: number;
   declare frequencyHz: number;
   declare dampingRatio: number;

   constructor() {
      super();


      this.target = new b2Vec2();

      if (new.target === b2MouseJointDef) this.b2MouseJointDef();
   }
   b2MouseJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_mouseJoint;
      this.maxForce = 0.0;
      this.frequencyHz = 5.0;
      this.dampingRatio = 0.7;
   }
}

class b2PrismaticJoint extends b2Joint {
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_localXAxis1: (b2Vec2 | null);
   declare m_localYAxis1: (b2Vec2 | null);
   declare m_refAngle: number;
   declare m_axis: (b2Vec2 | null);
   declare m_perp: (b2Vec2 | null);
   declare m_s1: number;
   declare m_s2: number;
   declare m_a1: number;
   declare m_a2: number;
   declare m_K: (b2Mat33 | null);
   declare m_impulse: (b2Vec3 | null);
   declare m_motorMass: number;
   declare m_motorImpulse: number;
   declare m_lowerTranslation: number;
   declare m_upperTranslation: number;
   declare m_maxMotorForce: number;
   declare m_motorSpeed: number;
   declare m_enableLimit: boolean;
   declare m_enableMotor: boolean;
   declare m_limitState: number;

   constructor(def?: (b2PrismaticJointDef | null)) {
      super();


      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_localXAxis1 = new b2Vec2();
      this.m_localYAxis1 = new b2Vec2();
      this.m_axis = new b2Vec2();
      this.m_perp = new b2Vec2();
      this.m_K = new b2Mat33();
      this.m_impulse = new b2Vec3();

      if (new.target === b2PrismaticJoint) this.b2PrismaticJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * (this.m_impulse!.x * this.m_perp!.x + (this.m_motorImpulse + this.m_impulse!.z) * this.m_axis!.x), inv_dt * (this.m_impulse!.x * this.m_perp!.y + (this.m_motorImpulse + this.m_impulse!.z) * this.m_axis!.y));
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return inv_dt * this.m_impulse!.y;
   }
   GetJointTranslation(): number {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var p1: (b2Vec2 | null) = bA!.GetWorldPoint(this.m_localAnchor1);
      var p2: (b2Vec2 | null) = bB!.GetWorldPoint(this.m_localAnchor2);
      var dX: number = p2!.x - p1!.x;
      var dY: number = p2!.y - p1!.y;
      var axis: (b2Vec2 | null) = bA!.GetWorldVector(this.m_localXAxis1);
      var translation: number = axis!.x * dX + axis!.y * dY;
      return translation;
   }
   GetJointSpeed(): number {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var p1X: number = bA!.m_sweep!.c!.x + r1X;
      var p1Y: number = bA!.m_sweep!.c!.y + r1Y;
      var p2X: number = bB!.m_sweep!.c!.x + r2X;
      var p2Y: number = bB!.m_sweep!.c!.y + r2Y;
      var dX: number = p2X - p1X;
      var dY: number = p2Y - p1Y;
      var axis: (b2Vec2 | null) = bA!.GetWorldVector(this.m_localXAxis1);
      var v1: (b2Vec2 | null) = bA!.m_linearVelocity;
      var v2: (b2Vec2 | null) = bB!.m_linearVelocity;
      var w1: number = bA!.m_angularVelocity;
      var w2: number = bB!.m_angularVelocity;
      var speed: number = (dX * ((-w1 * axis!.y)) + dY * (w1 * axis!.x)) + (axis!.x * (((v2!.x + ((-w2 * r2Y))) - v1!.x) - ((-w1 * r1Y))) + axis!.y * (((v2!.y + (w2 * r2X)) - v1!.y) - (w1 * r1X)));
      return speed;
   }
   IsLimitEnabled(): boolean {
      return this.m_enableLimit;
   }
   EnableLimit(flag: boolean): void {
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_enableLimit = flag;
   }
   GetLowerLimit(): number {
      return this.m_lowerTranslation;
   }
   GetUpperLimit(): number {
      return this.m_upperTranslation;
   }
   SetLimits(lower: number, upper: number): void {
      if (lower === undefined) lower = 0;
      if (upper === undefined) upper = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_lowerTranslation = lower;
      this.m_upperTranslation = upper;
   }
   IsMotorEnabled(): boolean {
      return this.m_enableMotor;
   }
   EnableMotor(flag: boolean): void {
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_enableMotor = flag;
   }
   SetMotorSpeed(speed: number): void {
      if (speed === undefined) speed = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_motorSpeed = speed;
   }
   GetMotorSpeed(): number {
      return this.m_motorSpeed;
   }
   SetMaxMotorForce(force: number): void {
      if (force === undefined) force = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_maxMotorForce = force;
   }
   GetMotorForce(): number {
      return this.m_motorImpulse;
   }
   b2PrismaticJoint(def: (b2PrismaticJointDef | null)): void {
      super.b2Joint(def);
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var tY: number = 0;
      this.m_localAnchor1!.SetV(def!.localAnchorA);
      this.m_localAnchor2!.SetV(def!.localAnchorB);
      this.m_localXAxis1!.SetV(def!.localAxisA);
      this.m_localYAxis1!.x = (-this.m_localXAxis1!.y);
      this.m_localYAxis1!.y = this.m_localXAxis1!.x;
      this.m_refAngle = def!.referenceAngle;
      this.m_impulse!.SetZero();
      this.m_motorMass = 0.0;
      this.m_motorImpulse = 0.0;
      this.m_lowerTranslation = def!.lowerTranslation;
      this.m_upperTranslation = def!.upperTranslation;
      this.m_maxMotorForce = def!.maxMotorForce;
      this.m_motorSpeed = def!.motorSpeed;
      this.m_enableLimit = def!.enableLimit;
      this.m_enableMotor = def!.enableMotor;
      this.m_limitState = b2Joint.e_inactiveLimit;
      this.m_axis!.SetZero();
      this.m_perp!.SetZero();
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      this.m_localCenterA!.SetV(bA!.GetLocalCenter());
      this.m_localCenterB!.SetV(bB!.GetLocalCenter());
      var xf1: (b2Transform | null) = bA!.GetTransform();
      var xf2: (b2Transform | null) = bB!.GetTransform();
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - this.m_localCenterA!.x;
      var r1Y: number = this.m_localAnchor1!.y - this.m_localCenterA!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - this.m_localCenterB!.x;
      var r2Y: number = this.m_localAnchor2!.y - this.m_localCenterB!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var dX: number = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
      var dY: number = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
      this.m_invMassA = bA!.m_invMass;
      this.m_invMassB = bB!.m_invMass;
      this.m_invIA = bA!.m_invI;
      this.m_invIB = bB!.m_invI; {
         this.m_axis!.SetV(b2Math.MulMV(xf1!.R, this.m_localXAxis1));
         this.m_a1 = (dX + r1X) * this.m_axis!.y - (dY + r1Y) * this.m_axis!.x;
         this.m_a2 = r2X * this.m_axis!.y - r2Y * this.m_axis!.x;
         this.m_motorMass = this.m_invMassA + this.m_invMassB + this.m_invIA * this.m_a1 * this.m_a1 + this.m_invIB * this.m_a2 * this.m_a2;
         if (this.m_motorMass > Number.MIN_VALUE) this.m_motorMass = 1.0 / this.m_motorMass;
      } {
         this.m_perp!.SetV(b2Math.MulMV(xf1!.R, this.m_localYAxis1));
         this.m_s1 = (dX + r1X) * this.m_perp!.y - (dY + r1Y) * this.m_perp!.x;
         this.m_s2 = r2X * this.m_perp!.y - r2Y * this.m_perp!.x;
         var m1: number = this.m_invMassA;
         var m2: number = this.m_invMassB;
         var i1: number = this.m_invIA;
         var i2: number = this.m_invIB;
         this.m_K!.col1!.x = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         this.m_K!.col1!.y = i1 * this.m_s1 + i2 * this.m_s2;
         this.m_K!.col1!.z = i1 * this.m_s1 * this.m_a1 + i2 * this.m_s2 * this.m_a2;
         this.m_K!.col2!.x = this.m_K!.col1!.y;
         this.m_K!.col2!.y = i1 + i2;
         this.m_K!.col2!.z = i1 * this.m_a1 + i2 * this.m_a2;
         this.m_K!.col3!.x = this.m_K!.col1!.z;
         this.m_K!.col3!.y = this.m_K!.col2!.z;
         this.m_K!.col3!.z = m1 + m2 + i1 * this.m_a1 * this.m_a1 + i2 * this.m_a2 * this.m_a2;
      }
      if (this.m_enableLimit) {
         var jointTransition: number = this.m_axis!.x * dX + this.m_axis!.y * dY;
         if (b2Math.Abs(this.m_upperTranslation - this.m_lowerTranslation) < 2.0 * b2Settings.b2_linearSlop) {
            this.m_limitState = b2Joint.e_equalLimits;
         }
         else if (jointTransition <= this.m_lowerTranslation) {
            if (this.m_limitState != b2Joint.e_atLowerLimit) {
               this.m_limitState = b2Joint.e_atLowerLimit;
               this.m_impulse!.z = 0.0;
            }
         }
         else if (jointTransition >= this.m_upperTranslation) {
            if (this.m_limitState != b2Joint.e_atUpperLimit) {
               this.m_limitState = b2Joint.e_atUpperLimit;
               this.m_impulse!.z = 0.0;
            }
         }
         else {
            this.m_limitState = b2Joint.e_inactiveLimit;
            this.m_impulse!.z = 0.0;
         }
      }
      else {
         this.m_limitState = b2Joint.e_inactiveLimit;
      }
      if (this.m_enableMotor == false) {
         this.m_motorImpulse = 0.0;
      }
      if (step!.warmStarting) {
         this.m_impulse!.x *= step!.dtRatio;
         this.m_impulse!.y *= step!.dtRatio;
         this.m_motorImpulse *= step!.dtRatio;
         var PX: number = this.m_impulse!.x * this.m_perp!.x + (this.m_motorImpulse + this.m_impulse!.z) * this.m_axis!.x;
         var PY: number = this.m_impulse!.x * this.m_perp!.y + (this.m_motorImpulse + this.m_impulse!.z) * this.m_axis!.y;
         var L1: number = this.m_impulse!.x * this.m_s1 + this.m_impulse!.y + (this.m_motorImpulse + this.m_impulse!.z) * this.m_a1;
         var L2: number = this.m_impulse!.x * this.m_s2 + this.m_impulse!.y + (this.m_motorImpulse + this.m_impulse!.z) * this.m_a2;
         bA!.m_linearVelocity!.x -= this.m_invMassA * PX;
         bA!.m_linearVelocity!.y -= this.m_invMassA * PY;
         bA!.m_angularVelocity -= this.m_invIA * L1;
         bB!.m_linearVelocity!.x += this.m_invMassB * PX;
         bB!.m_linearVelocity!.y += this.m_invMassB * PY;
         bB!.m_angularVelocity += this.m_invIB * L2;
      }
      else {
         this.m_impulse!.SetZero();
         this.m_motorImpulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var v1: (b2Vec2 | null) = bA!.m_linearVelocity;
      var w1: number = bA!.m_angularVelocity;
      var v2: (b2Vec2 | null) = bB!.m_linearVelocity;
      var w2: number = bB!.m_angularVelocity;
      var PX: number = 0;
      var PY: number = 0;
      var L1: number = 0;
      var L2: number = 0;
      if (this.m_enableMotor && this.m_limitState != b2Joint.e_equalLimits) {
         var Cdot: number = this.m_axis!.x * (v2!.x - v1!.x) + this.m_axis!.y * (v2!.y - v1!.y) + this.m_a2 * w2 - this.m_a1 * w1;
         var impulse: number = this.m_motorMass * (this.m_motorSpeed - Cdot);
         var oldImpulse: number = this.m_motorImpulse;
         var maxImpulse: number = step!.dt * this.m_maxMotorForce;
         this.m_motorImpulse = b2Math.Clamp(this.m_motorImpulse + impulse, (-maxImpulse), maxImpulse);
         impulse = this.m_motorImpulse - oldImpulse;
         PX = impulse * this.m_axis!.x;
         PY = impulse * this.m_axis!.y;
         L1 = impulse * this.m_a1;
         L2 = impulse * this.m_a2;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      var Cdot1X: number = this.m_perp!.x * (v2!.x - v1!.x) + this.m_perp!.y * (v2!.y - v1!.y) + this.m_s2 * w2 - this.m_s1 * w1;
      var Cdot1Y: number = w2 - w1;
      if (this.m_enableLimit && this.m_limitState != b2Joint.e_inactiveLimit) {
         var Cdot2: number = this.m_axis!.x * (v2!.x - v1!.x) + this.m_axis!.y * (v2!.y - v1!.y) + this.m_a2 * w2 - this.m_a1 * w1;
         var f1: (b2Vec3 | null) = this.m_impulse!.Copy();
         var df: (b2Vec3 | null) = this.m_K!.Solve33(new b2Vec3(), (-Cdot1X), (-Cdot1Y), (-Cdot2));
         this.m_impulse!.Add(df);
         if (this.m_limitState == b2Joint.e_atLowerLimit) {
            this.m_impulse!.z = b2Math.Max(this.m_impulse!.z, 0.0);
         }
         else if (this.m_limitState == b2Joint.e_atUpperLimit) {
            this.m_impulse!.z = b2Math.Min(this.m_impulse!.z, 0.0);
         }
         var bX: number = (-Cdot1X) - (this.m_impulse!.z - f1!.z) * this.m_K!.col3!.x;
         var bY: number = (-Cdot1Y) - (this.m_impulse!.z - f1!.z) * this.m_K!.col3!.y;
         var f2r: (b2Vec2 | null) = this.m_K!.Solve22(new b2Vec2(), bX, bY);
         f2r!.x += f1!.x;
         f2r!.y += f1!.y;
         this.m_impulse!.x = f2r!.x;
         this.m_impulse!.y = f2r!.y;
         df!.x = this.m_impulse!.x - f1!.x;
         df!.y = this.m_impulse!.y - f1!.y;
         df!.z = this.m_impulse!.z - f1!.z;
         PX = df!.x * this.m_perp!.x + df!.z * this.m_axis!.x;
         PY = df!.x * this.m_perp!.y + df!.z * this.m_axis!.y;
         L1 = df!.x * this.m_s1 + df!.y + df!.z * this.m_a1;
         L2 = df!.x * this.m_s2 + df!.y + df!.z * this.m_a2;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      else {
         var df2: (b2Vec2 | null) = this.m_K!.Solve22(new b2Vec2(), (-Cdot1X), (-Cdot1Y));
         this.m_impulse!.x += df2!.x;
         this.m_impulse!.y += df2!.y;
         PX = df2!.x * this.m_perp!.x;
         PY = df2!.x * this.m_perp!.y;
         L1 = df2!.x * this.m_s1 + df2!.y;
         L2 = df2!.x * this.m_s2 + df2!.y;
         v1!.x -= this.m_invMassA * PX;
         v1!.y -= this.m_invMassA * PY;
         w1 -= this.m_invIA * L1;
         v2!.x += this.m_invMassB * PX;
         v2!.y += this.m_invMassB * PY;
         w2 += this.m_invIB * L2;
      }
      bA!.m_linearVelocity!.SetV(v1);
      bA!.m_angularVelocity = w1;
      bB!.m_linearVelocity!.SetV(v2);
      bB!.m_angularVelocity = w2;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var limitC: number = 0;
      var oldLimitImpulse: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var c1: (b2Vec2 | null) = bA!.m_sweep!.c;
      var a1: number = bA!.m_sweep!.a;
      var c2: (b2Vec2 | null) = bB!.m_sweep!.c;
      var a2: number = bB!.m_sweep!.a;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var m1: number = 0;
      var m2: number = 0;
      var i1: number = 0;
      var i2: number = 0;
      var linearError: number = 0.0;
      var angularError: number = 0.0;
      var active: boolean = false;
      var C2: number = 0.0;
      var R1: (b2Mat22 | null) = b2Mat22.FromAngle(a1);
      var R2: (b2Mat22 | null) = b2Mat22.FromAngle(a2);
      tMat = R1;
      var r1X: number = this.m_localAnchor1!.x - this.m_localCenterA!.x;
      var r1Y: number = this.m_localAnchor1!.y - this.m_localCenterA!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = R2;
      var r2X: number = this.m_localAnchor2!.x - this.m_localCenterB!.x;
      var r2Y: number = this.m_localAnchor2!.y - this.m_localCenterB!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var dX: number = c2!.x + r2X - c1!.x - r1X;
      var dY: number = c2!.y + r2Y - c1!.y - r1Y;
      if (this.m_enableLimit) {
         this.m_axis = b2Math.MulMV(R1, this.m_localXAxis1);
         this.m_a1 = (dX + r1X) * this.m_axis!.y - (dY + r1Y) * this.m_axis!.x;
         this.m_a2 = r2X * this.m_axis!.y - r2Y * this.m_axis!.x;
         var translation: number = this.m_axis!.x * dX + this.m_axis!.y * dY;
         if (b2Math.Abs(this.m_upperTranslation - this.m_lowerTranslation) < 2.0 * b2Settings.b2_linearSlop) {
            C2 = b2Math.Clamp(translation, (-b2Settings.b2_maxLinearCorrection), b2Settings.b2_maxLinearCorrection);
            linearError = b2Math.Abs(translation);
            active = true;
         }
         else if (translation <= this.m_lowerTranslation) {
            C2 = b2Math.Clamp(translation - this.m_lowerTranslation + b2Settings.b2_linearSlop, (-b2Settings.b2_maxLinearCorrection), 0.0);
            linearError = this.m_lowerTranslation - translation;
            active = true;
         }
         else if (translation >= this.m_upperTranslation) {
            C2 = b2Math.Clamp(translation - this.m_upperTranslation + b2Settings.b2_linearSlop, 0.0, b2Settings.b2_maxLinearCorrection);
            linearError = translation - this.m_upperTranslation;
            active = true;
         }
      }
      this.m_perp = b2Math.MulMV(R1, this.m_localYAxis1);
      this.m_s1 = (dX + r1X) * this.m_perp!.y - (dY + r1Y) * this.m_perp!.x;
      this.m_s2 = r2X * this.m_perp!.y - r2Y * this.m_perp!.x;
      var impulse: (b2Vec3 | null) = new b2Vec3();
      var C1X: number = this.m_perp!.x * dX + this.m_perp!.y * dY;
      var C1Y: number = a2 - a1 - this.m_refAngle;
      linearError = b2Math.Max(linearError, b2Math.Abs(C1X));
      angularError = b2Math.Abs(C1Y);
      if (active) {
         m1 = this.m_invMassA;
         m2 = this.m_invMassB;
         i1 = this.m_invIA;
         i2 = this.m_invIB;
         this.m_K!.col1!.x = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         this.m_K!.col1!.y = i1 * this.m_s1 + i2 * this.m_s2;
         this.m_K!.col1!.z = i1 * this.m_s1 * this.m_a1 + i2 * this.m_s2 * this.m_a2;
         this.m_K!.col2!.x = this.m_K!.col1!.y;
         this.m_K!.col2!.y = i1 + i2;
         this.m_K!.col2!.z = i1 * this.m_a1 + i2 * this.m_a2;
         this.m_K!.col3!.x = this.m_K!.col1!.z;
         this.m_K!.col3!.y = this.m_K!.col2!.z;
         this.m_K!.col3!.z = m1 + m2 + i1 * this.m_a1 * this.m_a1 + i2 * this.m_a2 * this.m_a2;
         this.m_K!.Solve33(impulse, (-C1X), (-C1Y), (-C2));
      }
      else {
         m1 = this.m_invMassA;
         m2 = this.m_invMassB;
         i1 = this.m_invIA;
         i2 = this.m_invIB;
         var k11: number = m1 + m2 + i1 * this.m_s1 * this.m_s1 + i2 * this.m_s2 * this.m_s2;
         var k12: number = i1 * this.m_s1 + i2 * this.m_s2;
         var k22: number = i1 + i2;
         this.m_K!.col1!.Set(k11, k12, 0.0);
         this.m_K!.col2!.Set(k12, k22, 0.0);
         var impulse1: (b2Vec2 | null) = this.m_K!.Solve22(new b2Vec2(), (-C1X), (-C1Y));
         impulse!.x = impulse1!.x;
         impulse!.y = impulse1!.y;
         impulse!.z = 0.0;
      }
      var PX: number = impulse!.x * this.m_perp!.x + impulse!.z * this.m_axis!.x;
      var PY: number = impulse!.x * this.m_perp!.y + impulse!.z * this.m_axis!.y;
      var L1: number = impulse!.x * this.m_s1 + impulse!.y + impulse!.z * this.m_a1;
      var L2: number = impulse!.x * this.m_s2 + impulse!.y + impulse!.z * this.m_a2;
      c1!.x -= this.m_invMassA * PX;
      c1!.y -= this.m_invMassA * PY;
      a1 -= this.m_invIA * L1;
      c2!.x += this.m_invMassB * PX;
      c2!.y += this.m_invMassB * PY;
      a2 += this.m_invIB * L2;
      bA!.m_sweep!.a = a1;
      bB!.m_sweep!.a = a2;
      bA!.SynchronizeTransform();
      bB!.SynchronizeTransform();
      return linearError <= b2Settings.b2_linearSlop && angularError <= b2Settings.b2_angularSlop;
   }
}

class b2PrismaticJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare localAxisA: (b2Vec2 | null);
   declare referenceAngle: number;
   declare enableLimit: boolean;
   declare lowerTranslation: number;
   declare upperTranslation: number;
   declare enableMotor: boolean;
   declare maxMotorForce: number;
   declare motorSpeed: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();
      this.localAxisA = new b2Vec2();

      if (new.target === b2PrismaticJointDef) this.b2PrismaticJointDef();
   }
   b2PrismaticJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_prismaticJoint;
      this.localAxisA!.Set(1.0, 0.0);
      this.referenceAngle = 0.0;
      this.enableLimit = false;
      this.lowerTranslation = 0.0;
      this.upperTranslation = 0.0;
      this.enableMotor = false;
      this.maxMotorForce = 0.0;
      this.motorSpeed = 0.0;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchor: (b2Vec2 | null), axis: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA = this.bodyA!.GetLocalPoint(anchor);
      this.localAnchorB = this.bodyB!.GetLocalPoint(anchor);
      this.localAxisA = this.bodyA!.GetLocalVector(axis);
      this.referenceAngle = this.bodyB!.GetAngle() - this.bodyA!.GetAngle();
   }
}

class b2PulleyJoint extends b2Joint {
   declare m_ground: (b2Body | null);
   declare m_groundAnchor1: (b2Vec2 | null);
   declare m_groundAnchor2: (b2Vec2 | null);
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_u1: (b2Vec2 | null);
   declare m_u2: (b2Vec2 | null);
   declare m_constant: number;
   declare m_ratio: number;
   declare m_maxLength1: number;
   declare m_maxLength2: number;
   declare m_pulleyMass: number;
   declare m_limitMass1: number;
   declare m_limitMass2: number;
   declare m_impulse: number;
   declare m_limitImpulse1: number;
   declare m_limitImpulse2: number;
   declare m_state: number;
   declare m_limitState1: number;
   declare m_limitState2: number;
   declare static b2_minPulleyLength: number;

   constructor(def?: (b2PulleyJointDef | null)) {
      super();


      this.m_groundAnchor1 = new b2Vec2();
      this.m_groundAnchor2 = new b2Vec2();
      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_u1 = new b2Vec2();
      this.m_u2 = new b2Vec2();

      if (new.target === b2PulleyJoint) this.b2PulleyJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse * this.m_u2!.x, inv_dt * this.m_impulse * this.m_u2!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return 0.0;
   }
   GetGroundAnchorA(): (b2Vec2 | null) {
      var a: (b2Vec2 | null) = this.m_ground!.m_xf!.position!.Copy();
      a!.Add(this.m_groundAnchor1);
      return a;
   }
   GetGroundAnchorB(): (b2Vec2 | null) {
      var a: (b2Vec2 | null) = this.m_ground!.m_xf!.position!.Copy();
      a!.Add(this.m_groundAnchor2);
      return a;
   }
   GetLength1(): number {
      var p: (b2Vec2 | null) = this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
      var sX: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor1!.x;
      var sY: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor1!.y;
      var dX: number = p!.x - sX;
      var dY: number = p!.y - sY;
      return Math.sqrt(dX * dX + dY * dY);
   }
   GetLength2(): number {
      var p: (b2Vec2 | null) = this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
      var sX: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor2!.x;
      var sY: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor2!.y;
      var dX: number = p!.x - sX;
      var dY: number = p!.y - sY;
      return Math.sqrt(dX * dX + dY * dY);
   }
   GetRatio(): number {
      return this.m_ratio;
   }
   b2PulleyJoint(def: (b2PulleyJointDef | null)): void {
      super.b2Joint(def);
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var tY: number = 0;
      this.m_ground = this.m_bodyA!.m_world!.m_groundBody;
      this.m_groundAnchor1!.x = def!.groundAnchorA!.x - this.m_ground!.m_xf!.position!.x;
      this.m_groundAnchor1!.y = def!.groundAnchorA!.y - this.m_ground!.m_xf!.position!.y;
      this.m_groundAnchor2!.x = def!.groundAnchorB!.x - this.m_ground!.m_xf!.position!.x;
      this.m_groundAnchor2!.y = def!.groundAnchorB!.y - this.m_ground!.m_xf!.position!.y;
      this.m_localAnchor1!.SetV(def!.localAnchorA);
      this.m_localAnchor2!.SetV(def!.localAnchorB);
      this.m_ratio = def!.ratio;
      this.m_constant = def!.lengthA + this.m_ratio * def!.lengthB;
      this.m_maxLength1 = b2Math.Min(def!.maxLengthA, this.m_constant - this.m_ratio * b2PulleyJoint.b2_minPulleyLength);
      this.m_maxLength2 = b2Math.Min(def!.maxLengthB, (this.m_constant - b2PulleyJoint.b2_minPulleyLength) / this.m_ratio);
      this.m_impulse = 0.0;
      this.m_limitImpulse1 = 0.0;
      this.m_limitImpulse2 = 0.0;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var p1X: number = bA!.m_sweep!.c!.x + r1X;
      var p1Y: number = bA!.m_sweep!.c!.y + r1Y;
      var p2X: number = bB!.m_sweep!.c!.x + r2X;
      var p2Y: number = bB!.m_sweep!.c!.y + r2Y;
      var s1X: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor1!.x;
      var s1Y: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor1!.y;
      var s2X: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor2!.x;
      var s2Y: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor2!.y;
      this.m_u1!.Set(p1X - s1X, p1Y - s1Y);
      this.m_u2!.Set(p2X - s2X, p2Y - s2Y);
      var length1: number = this.m_u1!.Length();
      var length2: number = this.m_u2!.Length();
      if (length1 > b2Settings.b2_linearSlop) {
         this.m_u1!.Multiply(1.0 / length1);
      }
      else {
         this.m_u1!.SetZero();
      }
      if (length2 > b2Settings.b2_linearSlop) {
         this.m_u2!.Multiply(1.0 / length2);
      }
      else {
         this.m_u2!.SetZero();
      }
      var C: number = this.m_constant - length1 - this.m_ratio * length2;
      if (C > 0.0) {
         this.m_state = b2Joint.e_inactiveLimit;
         this.m_impulse = 0.0;
      }
      else {
         this.m_state = b2Joint.e_atUpperLimit;
      }
      if (length1 < this.m_maxLength1) {
         this.m_limitState1 = b2Joint.e_inactiveLimit;
         this.m_limitImpulse1 = 0.0;
      }
      else {
         this.m_limitState1 = b2Joint.e_atUpperLimit;
      }
      if (length2 < this.m_maxLength2) {
         this.m_limitState2 = b2Joint.e_inactiveLimit;
         this.m_limitImpulse2 = 0.0;
      }
      else {
         this.m_limitState2 = b2Joint.e_atUpperLimit;
      }
      var cr1u1: number = r1X * this.m_u1!.y - r1Y * this.m_u1!.x;
      var cr2u2: number = r2X * this.m_u2!.y - r2Y * this.m_u2!.x;
      this.m_limitMass1 = bA!.m_invMass + bA!.m_invI * cr1u1 * cr1u1;
      this.m_limitMass2 = bB!.m_invMass + bB!.m_invI * cr2u2 * cr2u2;
      this.m_pulleyMass = this.m_limitMass1 + this.m_ratio * this.m_ratio * this.m_limitMass2;
      this.m_limitMass1 = 1.0 / this.m_limitMass1;
      this.m_limitMass2 = 1.0 / this.m_limitMass2;
      this.m_pulleyMass = 1.0 / this.m_pulleyMass;
      if (step!.warmStarting) {
         this.m_impulse *= step!.dtRatio;
         this.m_limitImpulse1 *= step!.dtRatio;
         this.m_limitImpulse2 *= step!.dtRatio;
         var P1X: number = ((-this.m_impulse) - this.m_limitImpulse1) * this.m_u1!.x;
         var P1Y: number = ((-this.m_impulse) - this.m_limitImpulse1) * this.m_u1!.y;
         var P2X: number = ((-this.m_ratio * this.m_impulse) - this.m_limitImpulse2) * this.m_u2!.x;
         var P2Y: number = ((-this.m_ratio * this.m_impulse) - this.m_limitImpulse2) * this.m_u2!.y;
         bA!.m_linearVelocity!.x += bA!.m_invMass * P1X;
         bA!.m_linearVelocity!.y += bA!.m_invMass * P1Y;
         bA!.m_angularVelocity += bA!.m_invI * (r1X * P1Y - r1Y * P1X);
         bB!.m_linearVelocity!.x += bB!.m_invMass * P2X;
         bB!.m_linearVelocity!.y += bB!.m_invMass * P2Y;
         bB!.m_angularVelocity += bB!.m_invI * (r2X * P2Y - r2Y * P2X);
      }
      else {
         this.m_impulse = 0.0;
         this.m_limitImpulse1 = 0.0;
         this.m_limitImpulse2 = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      var tX: number = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var v1X: number = 0;
      var v1Y: number = 0;
      var v2X: number = 0;
      var v2Y: number = 0;
      var P1X: number = 0;
      var P1Y: number = 0;
      var P2X: number = 0;
      var P2Y: number = 0;
      var Cdot: number = 0;
      var impulse: number = 0;
      var oldImpulse: number = 0;
      if (this.m_state == b2Joint.e_atUpperLimit) {
         v1X = bA!.m_linearVelocity!.x + ((-bA!.m_angularVelocity * r1Y));
         v1Y = bA!.m_linearVelocity!.y + (bA!.m_angularVelocity * r1X);
         v2X = bB!.m_linearVelocity!.x + ((-bB!.m_angularVelocity * r2Y));
         v2Y = bB!.m_linearVelocity!.y + (bB!.m_angularVelocity * r2X);
         Cdot = (-(this.m_u1!.x * v1X + this.m_u1!.y * v1Y)) - this.m_ratio * (this.m_u2!.x * v2X + this.m_u2!.y * v2Y);
         impulse = this.m_pulleyMass * ((-Cdot));
         oldImpulse = this.m_impulse;
         this.m_impulse = b2Math.Max(0.0, this.m_impulse + impulse);
         impulse = this.m_impulse - oldImpulse;
         P1X = (-impulse * this.m_u1!.x);
         P1Y = (-impulse * this.m_u1!.y);
         P2X = (-this.m_ratio * impulse * this.m_u2!.x);
         P2Y = (-this.m_ratio * impulse * this.m_u2!.y);
         bA!.m_linearVelocity!.x += bA!.m_invMass * P1X;
         bA!.m_linearVelocity!.y += bA!.m_invMass * P1Y;
         bA!.m_angularVelocity += bA!.m_invI * (r1X * P1Y - r1Y * P1X);
         bB!.m_linearVelocity!.x += bB!.m_invMass * P2X;
         bB!.m_linearVelocity!.y += bB!.m_invMass * P2Y;
         bB!.m_angularVelocity += bB!.m_invI * (r2X * P2Y - r2Y * P2X);
      }
      if (this.m_limitState1 == b2Joint.e_atUpperLimit) {
         v1X = bA!.m_linearVelocity!.x + ((-bA!.m_angularVelocity * r1Y));
         v1Y = bA!.m_linearVelocity!.y + (bA!.m_angularVelocity * r1X);
         Cdot = (-(this.m_u1!.x * v1X + this.m_u1!.y * v1Y));
         impulse = (-this.m_limitMass1 * Cdot);
         oldImpulse = this.m_limitImpulse1;
         this.m_limitImpulse1 = b2Math.Max(0.0, this.m_limitImpulse1 + impulse);
         impulse = this.m_limitImpulse1 - oldImpulse;
         P1X = (-impulse * this.m_u1!.x);
         P1Y = (-impulse * this.m_u1!.y);
         bA!.m_linearVelocity!.x += bA!.m_invMass * P1X;
         bA!.m_linearVelocity!.y += bA!.m_invMass * P1Y;
         bA!.m_angularVelocity += bA!.m_invI * (r1X * P1Y - r1Y * P1X);
      }
      if (this.m_limitState2 == b2Joint.e_atUpperLimit) {
         v2X = bB!.m_linearVelocity!.x + ((-bB!.m_angularVelocity * r2Y));
         v2Y = bB!.m_linearVelocity!.y + (bB!.m_angularVelocity * r2X);
         Cdot = (-(this.m_u2!.x * v2X + this.m_u2!.y * v2Y));
         impulse = (-this.m_limitMass2 * Cdot);
         oldImpulse = this.m_limitImpulse2;
         this.m_limitImpulse2 = b2Math.Max(0.0, this.m_limitImpulse2 + impulse);
         impulse = this.m_limitImpulse2 - oldImpulse;
         P2X = (-impulse * this.m_u2!.x);
         P2Y = (-impulse * this.m_u2!.y);
         bB!.m_linearVelocity!.x += bB!.m_invMass * P2X;
         bB!.m_linearVelocity!.y += bB!.m_invMass * P2Y;
         bB!.m_angularVelocity += bB!.m_invI * (r2X * P2Y - r2Y * P2X);
      }
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var s1X: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor1!.x;
      var s1Y: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor1!.y;
      var s2X: number = this.m_ground!.m_xf!.position!.x + this.m_groundAnchor2!.x;
      var s2Y: number = this.m_ground!.m_xf!.position!.y + this.m_groundAnchor2!.y;
      var r1X: number = 0;
      var r1Y: number = 0;
      var r2X: number = 0;
      var r2Y: number = 0;
      var p1X: number = 0;
      var p1Y: number = 0;
      var p2X: number = 0;
      var p2Y: number = 0;
      var length1: number = 0;
      var length2: number = 0;
      var C: number = 0;
      var impulse: number = 0;
      var oldImpulse: number = 0;
      var oldLimitPositionImpulse: number = 0;
      var tX: number = 0;
      var linearError: number = 0.0;
      if (this.m_state == b2Joint.e_atUpperLimit) {
         tMat = bA!.m_xf!.R;
         r1X = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         r1Y = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
         r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
         r1X = tX;
         tMat = bB!.m_xf!.R;
         r2X = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         r2Y = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
         r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
         r2X = tX;
         p1X = bA!.m_sweep!.c!.x + r1X;
         p1Y = bA!.m_sweep!.c!.y + r1Y;
         p2X = bB!.m_sweep!.c!.x + r2X;
         p2Y = bB!.m_sweep!.c!.y + r2Y;
         this.m_u1!.Set(p1X - s1X, p1Y - s1Y);
         this.m_u2!.Set(p2X - s2X, p2Y - s2Y);
         length1 = this.m_u1!.Length();
         length2 = this.m_u2!.Length();
         if (length1 > b2Settings.b2_linearSlop) {
            this.m_u1!.Multiply(1.0 / length1);
         }
         else {
            this.m_u1!.SetZero();
         }
         if (length2 > b2Settings.b2_linearSlop) {
            this.m_u2!.Multiply(1.0 / length2);
         }
         else {
            this.m_u2!.SetZero();
         }
         C = this.m_constant - length1 - this.m_ratio * length2;
         linearError = b2Math.Max(linearError, (-C));
         C = b2Math.Clamp(C + b2Settings.b2_linearSlop, (-b2Settings.b2_maxLinearCorrection), 0.0);
         impulse = (-this.m_pulleyMass * C);
         p1X = (-impulse * this.m_u1!.x);
         p1Y = (-impulse * this.m_u1!.y);
         p2X = (-this.m_ratio * impulse * this.m_u2!.x);
         p2Y = (-this.m_ratio * impulse * this.m_u2!.y);
         bA!.m_sweep!.c!.x += bA!.m_invMass * p1X;
         bA!.m_sweep!.c!.y += bA!.m_invMass * p1Y;
         bA!.m_sweep!.a += bA!.m_invI * (r1X * p1Y - r1Y * p1X);
         bB!.m_sweep!.c!.x += bB!.m_invMass * p2X;
         bB!.m_sweep!.c!.y += bB!.m_invMass * p2Y;
         bB!.m_sweep!.a += bB!.m_invI * (r2X * p2Y - r2Y * p2X);
         bA!.SynchronizeTransform();
         bB!.SynchronizeTransform();
      }
      if (this.m_limitState1 == b2Joint.e_atUpperLimit) {
         tMat = bA!.m_xf!.R;
         r1X = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         r1Y = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
         r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
         r1X = tX;
         p1X = bA!.m_sweep!.c!.x + r1X;
         p1Y = bA!.m_sweep!.c!.y + r1Y;
         this.m_u1!.Set(p1X - s1X, p1Y - s1Y);
         length1 = this.m_u1!.Length();
         if (length1 > b2Settings.b2_linearSlop) {
            this.m_u1!.x *= 1.0 / length1;
            this.m_u1!.y *= 1.0 / length1;
         }
         else {
            this.m_u1!.SetZero();
         }
         C = this.m_maxLength1 - length1;
         linearError = b2Math.Max(linearError, (-C));
         C = b2Math.Clamp(C + b2Settings.b2_linearSlop, (-b2Settings.b2_maxLinearCorrection), 0.0);
         impulse = (-this.m_limitMass1 * C);
         p1X = (-impulse * this.m_u1!.x);
         p1Y = (-impulse * this.m_u1!.y);
         bA!.m_sweep!.c!.x += bA!.m_invMass * p1X;
         bA!.m_sweep!.c!.y += bA!.m_invMass * p1Y;
         bA!.m_sweep!.a += bA!.m_invI * (r1X * p1Y - r1Y * p1X);
         bA!.SynchronizeTransform();
      }
      if (this.m_limitState2 == b2Joint.e_atUpperLimit) {
         tMat = bB!.m_xf!.R;
         r2X = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         r2Y = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
         r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
         r2X = tX;
         p2X = bB!.m_sweep!.c!.x + r2X;
         p2Y = bB!.m_sweep!.c!.y + r2Y;
         this.m_u2!.Set(p2X - s2X, p2Y - s2Y);
         length2 = this.m_u2!.Length();
         if (length2 > b2Settings.b2_linearSlop) {
            this.m_u2!.x *= 1.0 / length2;
            this.m_u2!.y *= 1.0 / length2;
         }
         else {
            this.m_u2!.SetZero();
         }
         C = this.m_maxLength2 - length2;
         linearError = b2Math.Max(linearError, (-C));
         C = b2Math.Clamp(C + b2Settings.b2_linearSlop, (-b2Settings.b2_maxLinearCorrection), 0.0);
         impulse = (-this.m_limitMass2 * C);
         p2X = (-impulse * this.m_u2!.x);
         p2Y = (-impulse * this.m_u2!.y);
         bB!.m_sweep!.c!.x += bB!.m_invMass * p2X;
         bB!.m_sweep!.c!.y += bB!.m_invMass * p2Y;
         bB!.m_sweep!.a += bB!.m_invI * (r2X * p2Y - r2Y * p2X);
         bB!.SynchronizeTransform();
      }
      return linearError < b2Settings.b2_linearSlop;
   }
}

class b2PulleyJointDef extends b2JointDef {
   declare groundAnchorA: (b2Vec2 | null);
   declare groundAnchorB: (b2Vec2 | null);
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare lengthA: number;
   declare maxLengthA: number;
   declare lengthB: number;
   declare maxLengthB: number;
   declare ratio: number;

   constructor() {
      super();


      this.groundAnchorA = new b2Vec2();
      this.groundAnchorB = new b2Vec2();
      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();

      if (new.target === b2PulleyJointDef) this.b2PulleyJointDef();
   }
   b2PulleyJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_pulleyJoint;
      this.groundAnchorA!.Set((-1.0), 1.0);
      this.groundAnchorB!.Set(1.0, 1.0);
      this.localAnchorA!.Set((-1.0), 0.0);
      this.localAnchorB!.Set(1.0, 0.0);
      this.lengthA = 0.0;
      this.maxLengthA = 0.0;
      this.lengthB = 0.0;
      this.maxLengthB = 0.0;
      this.ratio = 1.0;
      this.collideConnected = true;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), gaA: (b2Vec2 | null), gaB: (b2Vec2 | null), anchorA: (b2Vec2 | null), anchorB: (b2Vec2 | null), r: number): void {
      if (r === undefined) r = 0;
      this.bodyA = bA;
      this.bodyB = bB;
      this.groundAnchorA!.SetV(gaA);
      this.groundAnchorB!.SetV(gaB);
      this.localAnchorA = this.bodyA!.GetLocalPoint(anchorA);
      this.localAnchorB = this.bodyB!.GetLocalPoint(anchorB);
      var d1X: number = anchorA!.x - gaA!.x;
      var d1Y: number = anchorA!.y - gaA!.y;
      this.lengthA = Math.sqrt(d1X * d1X + d1Y * d1Y);
      var d2X: number = anchorB!.x - gaB!.x;
      var d2Y: number = anchorB!.y - gaB!.y;
      this.lengthB = Math.sqrt(d2X * d2X + d2Y * d2Y);
      this.ratio = r;
      var C: number = this.lengthA + this.ratio * this.lengthB;
      this.maxLengthA = C - this.ratio * b2PulleyJoint.b2_minPulleyLength;
      this.maxLengthB = (C - b2PulleyJoint.b2_minPulleyLength) / this.ratio;
   }
}

class b2RevoluteJoint extends b2Joint {
   declare K: (b2Mat22 | null);
   declare K1: (b2Mat22 | null);
   declare K2: (b2Mat22 | null);
   declare K3: (b2Mat22 | null);
   declare impulse3: (b2Vec3 | null);
   declare impulse2: (b2Vec2 | null);
   declare reduced: (b2Vec2 | null);
   declare static tImpulse: (b2Vec2 | null);
   declare m_localAnchor1: (b2Vec2 | null);
   declare m_localAnchor2: (b2Vec2 | null);
   declare m_impulse: (b2Vec3 | null);
   declare m_motorImpulse: number;
   declare m_mass: (b2Mat33 | null);
   declare m_motorMass: number;
   declare m_enableMotor: boolean;
   declare m_maxMotorTorque: number;
   declare m_motorSpeed: number;
   declare m_enableLimit: boolean;
   declare m_referenceAngle: number;
   declare m_lowerAngle: number;
   declare m_upperAngle: number;
   declare m_limitState: number;

   constructor(def?: (b2RevoluteJointDef | null)) {
      super();


      this.K = new b2Mat22();
      this.K1 = new b2Mat22();
      this.K2 = new b2Mat22();
      this.K3 = new b2Mat22();
      this.impulse3 = new b2Vec3();
      this.impulse2 = new b2Vec2();
      this.reduced = new b2Vec2();
      this.m_localAnchor1 = new b2Vec2();
      this.m_localAnchor2 = new b2Vec2();
      this.m_impulse = new b2Vec3();
      this.m_mass = new b2Mat33();

      if (new.target === b2RevoluteJoint) this.b2RevoluteJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchor1);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchor2);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse!.x, inv_dt * this.m_impulse!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return inv_dt * this.m_impulse!.z;
   }
   GetJointAngle(): number {
      return this.m_bodyB!.m_sweep!.a - this.m_bodyA!.m_sweep!.a - this.m_referenceAngle;
   }
   GetJointSpeed(): number {
      return this.m_bodyB!.m_angularVelocity - this.m_bodyA!.m_angularVelocity;
   }
   IsLimitEnabled(): boolean {
      return this.m_enableLimit;
   }
   EnableLimit(flag: boolean): void {
      this.m_enableLimit = flag;
   }
   GetLowerLimit(): number {
      return this.m_lowerAngle;
   }
   GetUpperLimit(): number {
      return this.m_upperAngle;
   }
   SetLimits(lower: number, upper: number): void {
      if (lower === undefined) lower = 0;
      if (upper === undefined) upper = 0;
      this.m_lowerAngle = lower;
      this.m_upperAngle = upper;
   }
   IsMotorEnabled(): boolean {
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      return this.m_enableMotor;
   }
   EnableMotor(flag: boolean): void {
      this.m_enableMotor = flag;
   }
   SetMotorSpeed(speed: number): void {
      if (speed === undefined) speed = 0;
      this.m_bodyA!.SetAwake(true);
      this.m_bodyB!.SetAwake(true);
      this.m_motorSpeed = speed;
   }
   GetMotorSpeed(): number {
      return this.m_motorSpeed;
   }
   SetMaxMotorTorque(torque: number): void {
      if (torque === undefined) torque = 0;
      this.m_maxMotorTorque = torque;
   }
   GetMotorTorque(): number {
      return this.m_maxMotorTorque;
   }
   b2RevoluteJoint(def: (b2RevoluteJointDef | null)): void {
      super.b2Joint(def);
      this.m_localAnchor1!.SetV(def!.localAnchorA);
      this.m_localAnchor2!.SetV(def!.localAnchorB);
      this.m_referenceAngle = def!.referenceAngle;
      this.m_impulse!.SetZero();
      this.m_motorImpulse = 0.0;
      this.m_lowerAngle = def!.lowerAngle;
      this.m_upperAngle = def!.upperAngle;
      this.m_maxMotorTorque = def!.maxMotorTorque;
      this.m_motorSpeed = def!.motorSpeed;
      this.m_enableLimit = def!.enableLimit;
      this.m_enableMotor = def!.enableMotor;
      this.m_limitState = b2Joint.e_inactiveLimit;
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      if (this.m_enableMotor || this.m_enableLimit) {}
      tMat = bA!.m_xf!.R;
      var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
      var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
      r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
      r1X = tX;
      tMat = bB!.m_xf!.R;
      var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
      var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
      r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
      r2X = tX;
      var m1: number = bA!.m_invMass;
      var m2: number = bB!.m_invMass;
      var i1: number = bA!.m_invI;
      var i2: number = bB!.m_invI;
      this.m_mass!.col1!.x = m1 + m2 + r1Y * r1Y * i1 + r2Y * r2Y * i2;
      this.m_mass!.col2!.x = (-r1Y * r1X * i1) - r2Y * r2X * i2;
      this.m_mass!.col3!.x = (-r1Y * i1) - r2Y * i2;
      this.m_mass!.col1!.y = this.m_mass!.col2!.x;
      this.m_mass!.col2!.y = m1 + m2 + r1X * r1X * i1 + r2X * r2X * i2;
      this.m_mass!.col3!.y = r1X * i1 + r2X * i2;
      this.m_mass!.col1!.z = this.m_mass!.col3!.x;
      this.m_mass!.col2!.z = this.m_mass!.col3!.y;
      this.m_mass!.col3!.z = i1 + i2;
      this.m_motorMass = 1.0 / (i1 + i2);
      if (this.m_enableMotor == false) {
         this.m_motorImpulse = 0.0;
      }
      if (this.m_enableLimit) {
         var jointAngle: number = bB!.m_sweep!.a - bA!.m_sweep!.a - this.m_referenceAngle;
         if (b2Math.Abs(this.m_upperAngle - this.m_lowerAngle) < 2.0 * b2Settings.b2_angularSlop) {
            this.m_limitState = b2Joint.e_equalLimits;
         }
         else if (jointAngle <= this.m_lowerAngle) {
            if (this.m_limitState != b2Joint.e_atLowerLimit) {
               this.m_impulse!.z = 0.0;
            }
            this.m_limitState = b2Joint.e_atLowerLimit;
         }
         else if (jointAngle >= this.m_upperAngle) {
            if (this.m_limitState != b2Joint.e_atUpperLimit) {
               this.m_impulse!.z = 0.0;
            }
            this.m_limitState = b2Joint.e_atUpperLimit;
         }
         else {
            this.m_limitState = b2Joint.e_inactiveLimit;
            this.m_impulse!.z = 0.0;
         }
      }
      else {
         this.m_limitState = b2Joint.e_inactiveLimit;
      }
      if (step!.warmStarting) {
         this.m_impulse!.x *= step!.dtRatio;
         this.m_impulse!.y *= step!.dtRatio;
         this.m_motorImpulse *= step!.dtRatio;
         var PX: number = this.m_impulse!.x;
         var PY: number = this.m_impulse!.y;
         bA!.m_linearVelocity!.x -= m1 * PX;
         bA!.m_linearVelocity!.y -= m1 * PY;
         bA!.m_angularVelocity -= i1 * ((r1X * PY - r1Y * PX) + this.m_motorImpulse + this.m_impulse!.z);
         bB!.m_linearVelocity!.x += m2 * PX;
         bB!.m_linearVelocity!.y += m2 * PY;
         bB!.m_angularVelocity += i2 * ((r2X * PY - r2Y * PX) + this.m_motorImpulse + this.m_impulse!.z);
      }
      else {
         this.m_impulse!.SetZero();
         this.m_motorImpulse = 0.0;
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var newImpulse: number = 0;
      var r1X: number = 0;
      var r1Y: number = 0;
      var r2X: number = 0;
      var r2Y: number = 0;
      var v1: (b2Vec2 | null) = bA!.m_linearVelocity;
      var w1: number = bA!.m_angularVelocity;
      var v2: (b2Vec2 | null) = bB!.m_linearVelocity;
      var w2: number = bB!.m_angularVelocity;
      var m1: number = bA!.m_invMass;
      var m2: number = bB!.m_invMass;
      var i1: number = bA!.m_invI;
      var i2: number = bB!.m_invI;
      if (this.m_enableMotor && this.m_limitState != b2Joint.e_equalLimits) {
         var Cdot: number = w2 - w1 - this.m_motorSpeed;
         var impulse: number = this.m_motorMass * ((-Cdot));
         var oldImpulse: number = this.m_motorImpulse;
         var maxImpulse: number = step!.dt * this.m_maxMotorTorque;
         this.m_motorImpulse = b2Math.Clamp(this.m_motorImpulse + impulse, (-maxImpulse), maxImpulse);
         impulse = this.m_motorImpulse - oldImpulse;
         w1 -= i1 * impulse;
         w2 += i2 * impulse;
      }
      if (this.m_enableLimit && this.m_limitState != b2Joint.e_inactiveLimit) {
         tMat = bA!.m_xf!.R;
         r1X = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         r1Y = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
         r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
         r1X = tX;
         tMat = bB!.m_xf!.R;
         r2X = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         r2Y = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
         r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
         r2X = tX;
         var Cdot1X: number = v2!.x + ((-w2 * r2Y)) - v1!.x - ((-w1 * r1Y));
         var Cdot1Y: number = v2!.y + (w2 * r2X) - v1!.y - (w1 * r1X);
         var Cdot2: number = w2 - w1;
         this.m_mass!.Solve33(this.impulse3, (-Cdot1X), (-Cdot1Y), (-Cdot2));
         if (this.m_limitState == b2Joint.e_equalLimits) {
            this.m_impulse!.Add(this.impulse3);
         }
         else if (this.m_limitState == b2Joint.e_atLowerLimit) {
            newImpulse = this.m_impulse!.z + this.impulse3!.z;
            if (newImpulse < 0.0) {
               this.m_mass!.Solve22(this.reduced, (-Cdot1X), (-Cdot1Y));
               this.impulse3!.x = this.reduced!.x;
               this.impulse3!.y = this.reduced!.y;
               this.impulse3!.z = (-this.m_impulse!.z);
               this.m_impulse!.x += this.reduced!.x;
               this.m_impulse!.y += this.reduced!.y;
               this.m_impulse!.z = 0.0;
            }
         }
         else if (this.m_limitState == b2Joint.e_atUpperLimit) {
            newImpulse = this.m_impulse!.z + this.impulse3!.z;
            if (newImpulse > 0.0) {
               this.m_mass!.Solve22(this.reduced, (-Cdot1X), (-Cdot1Y));
               this.impulse3!.x = this.reduced!.x;
               this.impulse3!.y = this.reduced!.y;
               this.impulse3!.z = (-this.m_impulse!.z);
               this.m_impulse!.x += this.reduced!.x;
               this.m_impulse!.y += this.reduced!.y;
               this.m_impulse!.z = 0.0;
            }
         }
         v1!.x -= m1 * this.impulse3!.x;
         v1!.y -= m1 * this.impulse3!.y;
         w1 -= i1 * (r1X * this.impulse3!.y - r1Y * this.impulse3!.x + this.impulse3!.z);
         v2!.x += m2 * this.impulse3!.x;
         v2!.y += m2 * this.impulse3!.y;
         w2 += i2 * (r2X * this.impulse3!.y - r2Y * this.impulse3!.x + this.impulse3!.z);
      }
      else {
         tMat = bA!.m_xf!.R;
         r1X = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         r1Y = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
         r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
         r1X = tX;
         tMat = bB!.m_xf!.R;
         r2X = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         r2Y = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
         r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
         r2X = tX;
         var CdotX: number = v2!.x + ((-w2 * r2Y)) - v1!.x - ((-w1 * r1Y));
         var CdotY: number = v2!.y + (w2 * r2X) - v1!.y - (w1 * r1X);
         this.m_mass!.Solve22(this.impulse2, (-CdotX), (-CdotY));
         this.m_impulse!.x += this.impulse2!.x;
         this.m_impulse!.y += this.impulse2!.y;
         v1!.x -= m1 * this.impulse2!.x;
         v1!.y -= m1 * this.impulse2!.y;
         w1 -= i1 * (r1X * this.impulse2!.y - r1Y * this.impulse2!.x);
         v2!.x += m2 * this.impulse2!.x;
         v2!.y += m2 * this.impulse2!.y;
         w2 += i2 * (r2X * this.impulse2!.y - r2Y * this.impulse2!.x);
      }
      bA!.m_linearVelocity!.SetV(v1);
      bA!.m_angularVelocity = w1;
      bB!.m_linearVelocity!.SetV(v2);
      bB!.m_angularVelocity = w2;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var oldLimitImpulse: number = 0;
      var C: number = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var angularError: number = 0.0;
      var positionError: number = 0.0;
      var tX: number = 0;
      var impulseX: number = 0;
      var impulseY: number = 0;
      if (this.m_enableLimit && this.m_limitState != b2Joint.e_inactiveLimit) {
         var angle: number = bB!.m_sweep!.a - bA!.m_sweep!.a - this.m_referenceAngle;
         var limitImpulse: number = 0.0;
         if (this.m_limitState == b2Joint.e_equalLimits) {
            C = b2Math.Clamp(angle - this.m_lowerAngle, (-b2Settings.b2_maxAngularCorrection), b2Settings.b2_maxAngularCorrection);
            limitImpulse = (-this.m_motorMass * C);
            angularError = b2Math.Abs(C);
         }
         else if (this.m_limitState == b2Joint.e_atLowerLimit) {
            C = angle - this.m_lowerAngle;
            angularError = (-C);
            C = b2Math.Clamp(C + b2Settings.b2_angularSlop, (-b2Settings.b2_maxAngularCorrection), 0.0);
            limitImpulse = (-this.m_motorMass * C);
         }
         else if (this.m_limitState == b2Joint.e_atUpperLimit) {
            C = angle - this.m_upperAngle;
            angularError = C;
            C = b2Math.Clamp(C - b2Settings.b2_angularSlop, 0.0, b2Settings.b2_maxAngularCorrection);
            limitImpulse = (-this.m_motorMass * C);
         }
         bA!.m_sweep!.a -= bA!.m_invI * limitImpulse;
         bB!.m_sweep!.a += bB!.m_invI * limitImpulse;
         bA!.SynchronizeTransform();
         bB!.SynchronizeTransform();
      } {
         tMat = bA!.m_xf!.R;
         var r1X: number = this.m_localAnchor1!.x - bA!.m_sweep!.localCenter!.x;
         var r1Y: number = this.m_localAnchor1!.y - bA!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r1X + tMat!.col2!.x * r1Y);
         r1Y = (tMat!.col1!.y * r1X + tMat!.col2!.y * r1Y);
         r1X = tX;
         tMat = bB!.m_xf!.R;
         var r2X: number = this.m_localAnchor2!.x - bB!.m_sweep!.localCenter!.x;
         var r2Y: number = this.m_localAnchor2!.y - bB!.m_sweep!.localCenter!.y;
         tX = (tMat!.col1!.x * r2X + tMat!.col2!.x * r2Y);
         r2Y = (tMat!.col1!.y * r2X + tMat!.col2!.y * r2Y);
         r2X = tX;
         var CX: number = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
         var CY: number = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
         var CLengthSquared: number = CX * CX + CY * CY;
         var CLength: number = Math.sqrt(CLengthSquared);
         positionError = CLength;
         var invMass1: number = bA!.m_invMass;
         var invMass2: number = bB!.m_invMass;
         var invI1: number = bA!.m_invI;
         var invI2: number = bB!.m_invI;
         var k_allowedStretch: number = 10.0 * b2Settings.b2_linearSlop;
         if (CLengthSquared > k_allowedStretch * k_allowedStretch) {
            var uX: number = CX / CLength;
            var uY: number = CY / CLength;
            var k: number = invMass1 + invMass2;
            var m: number = 1.0 / k;
            impulseX = m * ((-CX));
            impulseY = m * ((-CY));
            var k_beta: number = 0.5;
            bA!.m_sweep!.c!.x -= k_beta * invMass1 * impulseX;
            bA!.m_sweep!.c!.y -= k_beta * invMass1 * impulseY;
            bB!.m_sweep!.c!.x += k_beta * invMass2 * impulseX;
            bB!.m_sweep!.c!.y += k_beta * invMass2 * impulseY;
            CX = bB!.m_sweep!.c!.x + r2X - bA!.m_sweep!.c!.x - r1X;
            CY = bB!.m_sweep!.c!.y + r2Y - bA!.m_sweep!.c!.y - r1Y;
         }
         this.K1!.col1!.x = invMass1 + invMass2;
         this.K1!.col2!.x = 0.0;
         this.K1!.col1!.y = 0.0;
         this.K1!.col2!.y = invMass1 + invMass2;
         this.K2!.col1!.x = invI1 * r1Y * r1Y;
         this.K2!.col2!.x = (-invI1 * r1X * r1Y);
         this.K2!.col1!.y = (-invI1 * r1X * r1Y);
         this.K2!.col2!.y = invI1 * r1X * r1X;
         this.K3!.col1!.x = invI2 * r2Y * r2Y;
         this.K3!.col2!.x = (-invI2 * r2X * r2Y);
         this.K3!.col1!.y = (-invI2 * r2X * r2Y);
         this.K3!.col2!.y = invI2 * r2X * r2X;
         this.K!.SetM(this.K1);
         this.K!.AddM(this.K2);
         this.K!.AddM(this.K3);
         this.K!.Solve(b2RevoluteJoint.tImpulse, (-CX), (-CY));
         impulseX = b2RevoluteJoint.tImpulse!.x;
         impulseY = b2RevoluteJoint.tImpulse!.y;
         bA!.m_sweep!.c!.x -= bA!.m_invMass * impulseX;
         bA!.m_sweep!.c!.y -= bA!.m_invMass * impulseY;
         bA!.m_sweep!.a -= bA!.m_invI * (r1X * impulseY - r1Y * impulseX);
         bB!.m_sweep!.c!.x += bB!.m_invMass * impulseX;
         bB!.m_sweep!.c!.y += bB!.m_invMass * impulseY;
         bB!.m_sweep!.a += bB!.m_invI * (r2X * impulseY - r2Y * impulseX);
         bA!.SynchronizeTransform();
         bB!.SynchronizeTransform();
      }
      return positionError <= b2Settings.b2_linearSlop && angularError <= b2Settings.b2_angularSlop;
   }
}

class b2RevoluteJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare referenceAngle: number;
   declare enableLimit: boolean;
   declare lowerAngle: number;
   declare upperAngle: number;
   declare enableMotor: boolean;
   declare motorSpeed: number;
   declare maxMotorTorque: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();

      if (new.target === b2RevoluteJointDef) this.b2RevoluteJointDef();
   }
   b2RevoluteJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_revoluteJoint;
      this.localAnchorA!.Set(0.0, 0.0);
      this.localAnchorB!.Set(0.0, 0.0);
      this.referenceAngle = 0.0;
      this.lowerAngle = 0.0;
      this.upperAngle = 0.0;
      this.maxMotorTorque = 0.0;
      this.motorSpeed = 0.0;
      this.enableLimit = false;
      this.enableMotor = false;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchor: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA = this.bodyA!.GetLocalPoint(anchor);
      this.localAnchorB = this.bodyB!.GetLocalPoint(anchor);
      this.referenceAngle = this.bodyB!.GetAngle() - this.bodyA!.GetAngle();
   }
}

class b2WeldJoint extends b2Joint {
   declare m_localAnchorA: (b2Vec2 | null);
   declare m_localAnchorB: (b2Vec2 | null);
   declare m_referenceAngle: number;
   declare m_impulse: (b2Vec3 | null);
   declare m_mass: (b2Mat33 | null);

   constructor(def?: (b2WeldJointDef | null)) {
      super();


      this.m_localAnchorA = new b2Vec2();
      this.m_localAnchorB = new b2Vec2();
      this.m_impulse = new b2Vec3();
      this.m_mass = new b2Mat33();

      if (new.target === b2WeldJoint) this.b2WeldJoint(def!);
   }
   GetAnchorA(): (b2Vec2 | null) {
      return this.m_bodyA!.GetWorldPoint(this.m_localAnchorA);
   }
   GetAnchorB(): (b2Vec2 | null) {
      return this.m_bodyB!.GetWorldPoint(this.m_localAnchorB);
   }
   GetReactionForce(inv_dt: number): (b2Vec2 | null) {
      if (inv_dt === undefined) inv_dt = 0;
      return new b2Vec2(inv_dt * this.m_impulse!.x, inv_dt * this.m_impulse!.y);
   }
   GetReactionTorque(inv_dt: number): number {
      if (inv_dt === undefined) inv_dt = 0;
      return inv_dt * this.m_impulse!.z;
   }
   b2WeldJoint(def: (b2WeldJointDef | null)): void {
      super.b2Joint(def);
      this.m_localAnchorA!.SetV(def!.localAnchorA);
      this.m_localAnchorB!.SetV(def!.localAnchorB);
      this.m_referenceAngle = def!.referenceAngle;
      this.m_impulse!.SetZero();
      this.m_mass = new b2Mat33();
   }
   InitVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var rAX: number = this.m_localAnchorA!.x - bA!.m_sweep!.localCenter!.x;
      var rAY: number = this.m_localAnchorA!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rAX + tMat!.col2!.x * rAY);
      rAY = (tMat!.col1!.y * rAX + tMat!.col2!.y * rAY);
      rAX = tX;
      tMat = bB!.m_xf!.R;
      var rBX: number = this.m_localAnchorB!.x - bB!.m_sweep!.localCenter!.x;
      var rBY: number = this.m_localAnchorB!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rBX + tMat!.col2!.x * rBY);
      rBY = (tMat!.col1!.y * rBX + tMat!.col2!.y * rBY);
      rBX = tX;
      var mA: number = bA!.m_invMass;
      var mB: number = bB!.m_invMass;
      var iA: number = bA!.m_invI;
      var iB: number = bB!.m_invI;
      this.m_mass!.col1!.x = mA + mB + rAY * rAY * iA + rBY * rBY * iB;
      this.m_mass!.col2!.x = (-rAY * rAX * iA) - rBY * rBX * iB;
      this.m_mass!.col3!.x = (-rAY * iA) - rBY * iB;
      this.m_mass!.col1!.y = this.m_mass!.col2!.x;
      this.m_mass!.col2!.y = mA + mB + rAX * rAX * iA + rBX * rBX * iB;
      this.m_mass!.col3!.y = rAX * iA + rBX * iB;
      this.m_mass!.col1!.z = this.m_mass!.col3!.x;
      this.m_mass!.col2!.z = this.m_mass!.col3!.y;
      this.m_mass!.col3!.z = iA + iB;
      if (step!.warmStarting) {
         this.m_impulse!.x *= step!.dtRatio;
         this.m_impulse!.y *= step!.dtRatio;
         this.m_impulse!.z *= step!.dtRatio;
         bA!.m_linearVelocity!.x -= mA * this.m_impulse!.x;
         bA!.m_linearVelocity!.y -= mA * this.m_impulse!.y;
         bA!.m_angularVelocity -= iA * (rAX * this.m_impulse!.y - rAY * this.m_impulse!.x + this.m_impulse!.z);
         bB!.m_linearVelocity!.x += mB * this.m_impulse!.x;
         bB!.m_linearVelocity!.y += mB * this.m_impulse!.y;
         bB!.m_angularVelocity += iB * (rBX * this.m_impulse!.y - rBY * this.m_impulse!.x + this.m_impulse!.z);
      }
      else {
         this.m_impulse!.SetZero();
      }
   }
   SolveVelocityConstraints(step: (b2TimeStep | null)): void {
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      var vA: (b2Vec2 | null) = bA!.m_linearVelocity;
      var wA: number = bA!.m_angularVelocity;
      var vB: (b2Vec2 | null) = bB!.m_linearVelocity;
      var wB: number = bB!.m_angularVelocity;
      var mA: number = bA!.m_invMass;
      var mB: number = bB!.m_invMass;
      var iA: number = bA!.m_invI;
      var iB: number = bB!.m_invI;
      tMat = bA!.m_xf!.R;
      var rAX: number = this.m_localAnchorA!.x - bA!.m_sweep!.localCenter!.x;
      var rAY: number = this.m_localAnchorA!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rAX + tMat!.col2!.x * rAY);
      rAY = (tMat!.col1!.y * rAX + tMat!.col2!.y * rAY);
      rAX = tX;
      tMat = bB!.m_xf!.R;
      var rBX: number = this.m_localAnchorB!.x - bB!.m_sweep!.localCenter!.x;
      var rBY: number = this.m_localAnchorB!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rBX + tMat!.col2!.x * rBY);
      rBY = (tMat!.col1!.y * rBX + tMat!.col2!.y * rBY);
      rBX = tX;
      var Cdot1X: number = vB!.x - wB * rBY - vA!.x + wA * rAY;
      var Cdot1Y: number = vB!.y + wB * rBX - vA!.y - wA * rAX;
      var Cdot2: number = wB - wA;
      var impulse: (b2Vec3 | null) = new b2Vec3();
      this.m_mass!.Solve33(impulse, (-Cdot1X), (-Cdot1Y), (-Cdot2));
      this.m_impulse!.Add(impulse);
      vA!.x -= mA * impulse!.x;
      vA!.y -= mA * impulse!.y;
      wA -= iA * (rAX * impulse!.y - rAY * impulse!.x + impulse!.z);
      vB!.x += mB * impulse!.x;
      vB!.y += mB * impulse!.y;
      wB += iB * (rBX * impulse!.y - rBY * impulse!.x + impulse!.z);
      bA!.m_angularVelocity = wA;
      bB!.m_angularVelocity = wB;
   }
   SolvePositionConstraints(baumgarte: number): boolean {
      if (baumgarte === undefined) baumgarte = 0;
      var tMat: (b2Mat22 | null) | undefined;
      var tX: number = 0;
      var bA: (b2Body | null) = this.m_bodyA;
      var bB: (b2Body | null) = this.m_bodyB;
      tMat = bA!.m_xf!.R;
      var rAX: number = this.m_localAnchorA!.x - bA!.m_sweep!.localCenter!.x;
      var rAY: number = this.m_localAnchorA!.y - bA!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rAX + tMat!.col2!.x * rAY);
      rAY = (tMat!.col1!.y * rAX + tMat!.col2!.y * rAY);
      rAX = tX;
      tMat = bB!.m_xf!.R;
      var rBX: number = this.m_localAnchorB!.x - bB!.m_sweep!.localCenter!.x;
      var rBY: number = this.m_localAnchorB!.y - bB!.m_sweep!.localCenter!.y;
      tX = (tMat!.col1!.x * rBX + tMat!.col2!.x * rBY);
      rBY = (tMat!.col1!.y * rBX + tMat!.col2!.y * rBY);
      rBX = tX;
      var mA: number = bA!.m_invMass;
      var mB: number = bB!.m_invMass;
      var iA: number = bA!.m_invI;
      var iB: number = bB!.m_invI;
      var C1X: number = bB!.m_sweep!.c!.x + rBX - bA!.m_sweep!.c!.x - rAX;
      var C1Y: number = bB!.m_sweep!.c!.y + rBY - bA!.m_sweep!.c!.y - rAY;
      var C2: number = bB!.m_sweep!.a - bA!.m_sweep!.a - this.m_referenceAngle;
      var k_allowedStretch: number = 10.0 * b2Settings.b2_linearSlop;
      var positionError: number = Math.sqrt(C1X * C1X + C1Y * C1Y);
      var angularError: number = b2Math.Abs(C2);
      if (positionError > k_allowedStretch) {
         iA *= 1.0;
         iB *= 1.0;
      }
      this.m_mass!.col1!.x = mA + mB + rAY * rAY * iA + rBY * rBY * iB;
      this.m_mass!.col2!.x = (-rAY * rAX * iA) - rBY * rBX * iB;
      this.m_mass!.col3!.x = (-rAY * iA) - rBY * iB;
      this.m_mass!.col1!.y = this.m_mass!.col2!.x;
      this.m_mass!.col2!.y = mA + mB + rAX * rAX * iA + rBX * rBX * iB;
      this.m_mass!.col3!.y = rAX * iA + rBX * iB;
      this.m_mass!.col1!.z = this.m_mass!.col3!.x;
      this.m_mass!.col2!.z = this.m_mass!.col3!.y;
      this.m_mass!.col3!.z = iA + iB;
      var impulse: (b2Vec3 | null) = new b2Vec3();
      this.m_mass!.Solve33(impulse, (-C1X), (-C1Y), (-C2));
      bA!.m_sweep!.c!.x -= mA * impulse!.x;
      bA!.m_sweep!.c!.y -= mA * impulse!.y;
      bA!.m_sweep!.a -= iA * (rAX * impulse!.y - rAY * impulse!.x + impulse!.z);
      bB!.m_sweep!.c!.x += mB * impulse!.x;
      bB!.m_sweep!.c!.y += mB * impulse!.y;
      bB!.m_sweep!.a += iB * (rBX * impulse!.y - rBY * impulse!.x + impulse!.z);
      bA!.SynchronizeTransform();
      bB!.SynchronizeTransform();
      return positionError <= b2Settings.b2_linearSlop && angularError <= b2Settings.b2_angularSlop;
   }
}

class b2WeldJointDef extends b2JointDef {
   declare localAnchorA: (b2Vec2 | null);
   declare localAnchorB: (b2Vec2 | null);
   declare referenceAngle: number;

   constructor() {
      super();


      this.localAnchorA = new b2Vec2();
      this.localAnchorB = new b2Vec2();

      if (new.target === b2WeldJointDef) this.b2WeldJointDef();
   }
   b2WeldJointDef(): void {
      super.b2JointDef();
      this.type = b2Joint.e_weldJoint;
      this.referenceAngle = 0.0;
   }
   Initialize(bA: (b2Body | null), bB: (b2Body | null), anchor: (b2Vec2 | null)): void {
      this.bodyA = bA;
      this.bodyB = bB;
      this.localAnchorA!.SetV(this.bodyA!.GetLocalPoint(anchor));
      this.localAnchorB!.SetV(this.bodyB!.GetLocalPoint(anchor));
      this.referenceAngle = this.bodyB!.GetAngle() - this.bodyA!.GetAngle();
   }
}

b2Collision.s_incidentEdge = b2Collision.MakeClipPointVector();
      b2Collision.s_clipPoints1 = b2Collision.MakeClipPointVector();
      b2Collision.s_clipPoints2 = b2Collision.MakeClipPointVector();
      b2Collision.s_edgeAO = numberVector(1);
      b2Collision.s_edgeBO = numberVector(1);
      b2Collision.s_localTangent = new b2Vec2();
      b2Collision.s_localNormal = new b2Vec2();
      b2Collision.s_planePoint = new b2Vec2();
      b2Collision.s_normal = new b2Vec2();
      b2Collision.s_tangent = new b2Vec2();
      b2Collision.s_tangent2 = new b2Vec2();
      b2Collision.s_v11 = new b2Vec2();
      b2Collision.s_v12 = new b2Vec2();
      b2Collision.b2CollidePolyTempVec = new b2Vec2();
      b2Collision.b2_nullFeature = 0x000000ff;
b2Distance.s_simplex = new b2Simplex();
      b2Distance.s_saveA = numberVector(3);
      b2Distance.s_saveB = numberVector(3);
b2Manifold.e_circles = 0x0001;
      b2Manifold.e_faceA = 0x0002;
      b2Manifold.e_faceB = 0x0004;
b2SeparationFunction.e_points = 0x01;
      b2SeparationFunction.e_faceA = 0x02;
      b2SeparationFunction.e_faceB = 0x04;
b2TimeOfImpact.b2_toiCalls = 0;
      b2TimeOfImpact.b2_toiIters = 0;
      b2TimeOfImpact.b2_toiMaxIters = 0;
      b2TimeOfImpact.b2_toiRootIters = 0;
      b2TimeOfImpact.b2_toiMaxRootIters = 0;
      b2TimeOfImpact.s_cache = new b2SimplexCache();
      b2TimeOfImpact.s_distanceInput = new b2DistanceInput();
      b2TimeOfImpact.s_xfA = new b2Transform();
      b2TimeOfImpact.s_xfB = new b2Transform();
      b2TimeOfImpact.s_fcn = new b2SeparationFunction();
      b2TimeOfImpact.s_distanceOutput = new b2DistanceOutput();
b2PolygonShape.s_mat = new b2Mat22();
b2Shape.e_unknownShape = parseInt(String((-1)));
      b2Shape.e_circleShape = 0;
      b2Shape.e_polygonShape = 1;
      b2Shape.e_edgeShape = 2;
      b2Shape.e_shapeTypeCount = 3;
      b2Shape.e_hitCollide = 1;
      b2Shape.e_missCollide = 0;
      b2Shape.e_startsInsideCollide = parseInt(String((-1)));
b2Settings.VERSION = "2.1alpha";
      b2Settings.USHRT_MAX = 0x0000ffff;
      b2Settings.b2_pi = Math.PI;
      b2Settings.b2_maxManifoldPoints = 2;
      b2Settings.b2_aabbExtension = 0.1;
      b2Settings.b2_aabbMultiplier = 2.0;
      b2Settings.b2_polygonRadius = 2.0 * b2Settings.b2_linearSlop;
      b2Settings.b2_linearSlop = 0.005;
      b2Settings.b2_angularSlop = 2.0 / 180.0 * b2Settings.b2_pi;
      b2Settings.b2_toiSlop = 8.0 * b2Settings.b2_linearSlop;
      b2Settings.b2_maxTOIContactsPerIsland = 32;
      b2Settings.b2_maxTOIJointsPerIsland = 32;
      b2Settings.b2_velocityThreshold = 1.0;
      b2Settings.b2_maxLinearCorrection = 0.2;
      b2Settings.b2_maxAngularCorrection = 8.0 / 180.0 * b2Settings.b2_pi;
      b2Settings.b2_maxTranslation = 2.0;
      b2Settings.b2_maxTranslationSquared = b2Settings.b2_maxTranslation * b2Settings.b2_maxTranslation;
      b2Settings.b2_maxRotation = 0.5 * b2Settings.b2_pi;
      b2Settings.b2_maxRotationSquared = b2Settings.b2_maxRotation * b2Settings.b2_maxRotation;
      b2Settings.b2_contactBaumgarte = 0.2;
      b2Settings.b2_timeToSleep = 0.5;
      b2Settings.b2_linearSleepTolerance = 0.01;
      b2Settings.b2_angularSleepTolerance = 2.0 / 180.0 * b2Settings.b2_pi;
b2Math.b2Vec2_zero = new b2Vec2(0.0, 0.0);
      b2Math.b2Mat22_identity = b2Mat22.FromVV(new b2Vec2(1.0, 0.0), new b2Vec2(0.0, 1.0));
      b2Math.b2Transform_identity = new b2Transform(b2Math.b2Vec2_zero, b2Math.b2Mat22_identity);
b2Body.s_xf1 = new b2Transform();
      b2Body.e_islandFlag = 0x0001;
      b2Body.e_awakeFlag = 0x0002;
      b2Body.e_allowSleepFlag = 0x0004;
      b2Body.e_bulletFlag = 0x0008;
      b2Body.e_fixedRotationFlag = 0x0010;
      b2Body.e_activeFlag = 0x0020;
      b2Body.b2_staticBody = 0;
      b2Body.b2_kinematicBody = 1;
      b2Body.b2_dynamicBody = 2;
b2ContactFilter.b2_defaultFilter = new b2ContactFilter();
b2ContactListener.b2_defaultListener = new b2ContactListener();
b2ContactManager.s_evalCP = new b2ContactPoint();
b2DebugDraw.e_shapeBit = 0x0001;
      b2DebugDraw.e_jointBit = 0x0002;
      b2DebugDraw.e_aabbBit = 0x0004;
      b2DebugDraw.e_pairBit = 0x0008;
      b2DebugDraw.e_centerOfMassBit = 0x0010;
      b2DebugDraw.e_controllerBit = 0x0020;
b2Island.s_impulse = new b2ContactImpulse();
b2World.s_timestep2 = new b2TimeStep();
      b2World.s_xf = new b2Transform();
      b2World.s_backupA = new b2Sweep();
      b2World.s_backupB = new b2Sweep();
      b2World.s_timestep = new b2TimeStep();
      b2World.s_queue = new Array();
      b2World.s_jointColor = new b2Color(0.5, 0.8, 0.8);
      b2World.e_newFixture = 0x0001;
      b2World.e_locked = 0x0002;
b2Contact.e_sensorFlag = 0x0001;
      b2Contact.e_continuousFlag = 0x0002;
      b2Contact.e_islandFlag = 0x0004;
      b2Contact.e_toiFlag = 0x0008;
      b2Contact.e_touchingFlag = 0x0010;
      b2Contact.e_enabledFlag = 0x0020;
      b2Contact.e_filterFlag = 0x0040;
      b2Contact.s_input = new b2TOIInput();
b2ContactSolver.s_worldManifold = new b2WorldManifold();
      b2ContactSolver.s_psm = new b2PositionSolverManifold();
b2PositionSolverManifold.circlePointA = new b2Vec2();
      b2PositionSolverManifold.circlePointB = new b2Vec2();
b2Joint.e_unknownJoint = 0;
      b2Joint.e_revoluteJoint = 1;
      b2Joint.e_prismaticJoint = 2;
      b2Joint.e_distanceJoint = 3;
      b2Joint.e_pulleyJoint = 4;
      b2Joint.e_mouseJoint = 5;
      b2Joint.e_gearJoint = 6;
      b2Joint.e_lineJoint = 7;
      b2Joint.e_weldJoint = 8;
      b2Joint.e_frictionJoint = 9;
      b2Joint.e_inactiveLimit = 0;
      b2Joint.e_atLowerLimit = 1;
      b2Joint.e_atUpperLimit = 2;
      b2Joint.e_equalLimits = 3;
b2PulleyJoint.b2_minPulleyLength = 2.0;
b2RevoluteJoint.tImpulse = new b2Vec2();

/*
 * Original nts benchmark scene, released under the zlib terms in the engine
 * header above. This scene was written directly against the engine API.
 *
 * One world contains a floor, a six-row box pyramid, four rolling circles,
 * and six links suspended from revolute joints. All dimensions, initial
 * velocities, and solver settings are fixed. The input is a count of fresh
 * worlds; each world advances by the same number of simulation steps.
 */

const sceneSteps = 24;
const sceneTimeStep = 1 / 60;
const sceneVelocityIterations = 8;
const scenePositionIterations = 3;
const scenePyramidRows = 6;
const sceneCircleCount = 4;
const sceneLinkCount = 6;

interface Scene {
   world: b2World;
   bodies: b2Body[];
}

export interface SceneSummary {
   bodies: number;
   dynamicBodies: number;
   circles: number;
   polygons: number;
   joints: number;
   contacts: number;
   steps: number;
}

function sceneFixture(body: b2Body, shape: b2Shape, density: number): void {
   const fixture = new b2FixtureDef();
   fixture.shape = shape;
   fixture.density = density;
   fixture.friction = 0.4;
   fixture.restitution = 0.1;
   if (body.CreateFixture(fixture) === null) {
      throw new Error("Cannot attach a fixture to the new scene");
   }
}

function sceneDynamicBody(
   scene: Scene, shape: b2Shape, x: number, y: number, velocityX: number = 0
): b2Body {
   const definition = new b2BodyDef();
   definition.type = b2Body.b2_dynamicBody;
   definition.position = new b2Vec2(x, y);
   definition.linearVelocity = new b2Vec2(velocityX, 0);
   const body = scene.world.CreateBody(definition);
   if (body === null) {
      throw new Error("Cannot create a body in the new scene");
   }
   sceneFixture(body, shape, 1);
   scene.bodies.push(body);
   return body;
}

function createScene(): Scene {
   const world = new b2World(new b2Vec2(0, -9.8), false);
   const ground = world.GetGroundBody();
   if (ground === null) {
      throw new Error("The new world has no ground body");
   }
   const scene: Scene = { world, bodies: [ground] };

   // Reuse the world's own static body. The floor's top surface is y = 0.
   ground.SetPosition(new b2Vec2(0, -0.5));
   const floor = new b2PolygonShape();
   floor.SetAsBox(12, 0.5);
   sceneFixture(ground, floor, 0);

   // A 0.04-unit gap separates adjacent 0.8-unit boxes before settling.
   // The six rows contain 6 + 5 + 4 + 3 + 2 + 1 = 21 dynamic boxes.
   for (let row = 0; row < scenePyramidRows; row++) {
      const columns = scenePyramidRows - row;
      for (let column = 0; column < columns; column++) {
         const box = new b2PolygonShape();
         box.SetAsBox(0.4, 0.4);
         const x = -2.5 + (column - (columns - 1) / 2) * 0.84;
         const y = 0.42 + row * 0.84;
         sceneDynamicBody(scene, box, x, y);
      }
   }

   // Low circles roll into the pyramid's right edge during the fixed run.
   for (let circle = 0; circle < sceneCircleCount; circle++) {
      const shape = new b2CircleShape(0.35);
      const x = 0.8 + circle * 0.82;
      const y = 0.38 + (circle % 2) * 0.18;
      sceneDynamicBody(scene, shape, x, y, -1.8 - circle * 0.1);
   }

   // Six 0.7-unit links start horizontally. Each hinge is at the left end
   // of its link, with the first hinge fixed to the floor body at (4, 5.2).
   let previous = ground;
   for (let link = 0; link < sceneLinkCount; link++) {
      const shape = new b2PolygonShape();
      shape.SetAsBox(0.35, 0.12);
      const hingeX = 4 + link * 0.7;
      const body = sceneDynamicBody(scene, shape, hingeX + 0.35, 5.2);
      const joint = new b2RevoluteJointDef();
      joint.Initialize(previous, body, new b2Vec2(hingeX, 5.2));
      joint.collideConnected = false;
      if (world.CreateJoint(joint) === null) {
         throw new Error("Cannot connect the new chain link");
      }
      previous = body;
   }
   return scene;
}

function advanceScene(scene: Scene, steps: number): void {
   for (let step = 0; step < steps; step++) {
      scene.world.Step(sceneTimeStep, sceneVelocityIterations, scenePositionIterations);
      scene.world.ClearForces();
   }
}

function sceneState(scene: Scene): number[] {
   const values: number[] = [];
   for (const body of scene.bodies) {
      const position = body.GetPosition();
      if (position === null) {
         throw new Error("A scene body has no position");
      }
      values.push(position.x, position.y, body.GetAngle());
   }
   return values;
}

/**
 * Flat x, y, angle triples for every body after a fresh simulation.
 * Order: ground; pyramid bottom-to-top and left-to-right; circles left-to-right;
 * chain links from the fixed hinge outward. There are 32 bodies / 96 numbers.
 */
export function state(steps: number): number[] {
   const scene = createScene();
   advanceScene(scene, steps);
   return sceneState(scene);
}

/** Observed engine counts, for checking the scene without exposing the world. */
export function sceneSummary(steps: number = sceneSteps): SceneSummary {
   const scene = createScene();
   advanceScene(scene, steps);
   let dynamicBodies = 0;
   let circles = 0;
   let polygons = 0;
   for (const body of scene.bodies) {
      if (body.GetType() === b2Body.b2_dynamicBody) dynamicBodies++;
      for (let fixture = body.GetFixtureList(); fixture !== null; fixture = fixture.GetNext()) {
         if (fixture.GetType() === b2Shape.e_circleShape) circles++;
         if (fixture.GetType() === b2Shape.e_polygonShape) polygons++;
      }
   }
   return {
      bodies: scene.world.GetBodyCount(),
      dynamicBodies,
      circles,
      polygons,
      joints: scene.world.GetJointCount(),
      contacts: scene.world.GetContactCount(),
      steps
   };
}

/** The benchmark input is a nonnegative integer count of fresh worlds. */
export const seed = 1;

export function work(n: number): number {
   let hash = 0;
   for (let repeat = 0; repeat < n; repeat++) {
      const scene = createScene();
      advanceScene(scene, sceneSteps);
      for (const body of scene.bodies) {
         const position = body.GetPosition();
         if (position === null) {
            throw new Error("A scene body has no position");
         }
         hash = (hash * 31 + Math.round(position.x * 1e6)) >>> 0;
         hash = (hash * 31 + Math.round(position.y * 1e6)) >>> 0;
         hash = (hash * 31 + Math.round(body.GetAngle() * 1e6)) >>> 0;
      }
   }
   return hash;
}
