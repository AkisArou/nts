// expect: NTS1001 a meta property is not supported by this lowering yet
// From octane-box2d: b2BoundValues#constructor (benchmarks/cases/octane-box2d/case.ts:221).
// From octane-box2d: b2ContactID#constructor (benchmarks/cases/octane-box2d/case.ts:685).
// From octane-box2d: b2DynamicTree#constructor (benchmarks/cases/octane-box2d/case.ts:948).
// From octane-box2d: b2Manifold#constructor (benchmarks/cases/octane-box2d/case.ts:1334).
// From octane-box2d: b2ManifoldPoint#constructor (benchmarks/cases/octane-box2d/case.ts:1380).
// From octane-box2d: b2RayCastInput#constructor (benchmarks/cases/octane-box2d/case.ts:1427).
// From octane-box2d: b2WorldManifold#constructor (benchmarks/cases/octane-box2d/case.ts:2156).
// From octane-box2d: b2Shape#constructor (benchmarks/cases/octane-box2d/case.ts:2334).
// From octane-box2d: b2CircleShape#constructor (benchmarks/cases/octane-box2d/case.ts:2389).
// From octane-box2d: b2EdgeChainDef#constructor (benchmarks/cases/octane-box2d/case.ts:2497).
// From octane-box2d: b2EdgeShape#constructor (benchmarks/cases/octane-box2d/case.ts:2536).
// From octane-box2d: b2PolygonShape#constructor (benchmarks/cases/octane-box2d/case.ts:2742).
// From octane-box2d: b2Color#constructor (benchmarks/cases/octane-box2d/case.ts:3230).
// From octane-box2d: b2Mat22#constructor (benchmarks/cases/octane-box2d/case.ts:3319).
// From octane-box2d: b2Mat33#constructor (benchmarks/cases/octane-box2d/case.ts:3425).
// From octane-box2d: b2Transform#constructor (benchmarks/cases/octane-box2d/case.ts:3747).
// From octane-box2d: b2Vec2#constructor (benchmarks/cases/octane-box2d/case.ts:3780).
// From octane-box2d: b2Vec3#constructor (benchmarks/cases/octane-box2d/case.ts:3892).
// From octane-box2d: b2Body#constructor (benchmarks/cases/octane-box2d/case.ts:3993).
// From octane-box2d: b2BodyDef#constructor (benchmarks/cases/octane-box2d/case.ts:4631).
// From octane-box2d: b2ContactManager#constructor (benchmarks/cases/octane-box2d/case.ts:4709).
// From octane-box2d: b2DebugDraw#constructor (benchmarks/cases/octane-box2d/case.ts:4886).
// From octane-box2d: b2Fixture#constructor (benchmarks/cases/octane-box2d/case.ts:5082).
// From octane-box2d: b2FixtureDef#constructor (benchmarks/cases/octane-box2d/case.ts:5231).
// From octane-box2d: b2Island#constructor (benchmarks/cases/octane-box2d/case.ts:5263).
// From octane-box2d: b2World#constructor (benchmarks/cases/octane-box2d/case.ts:5556).
// From octane-box2d: b2Contact#constructor (benchmarks/cases/octane-box2d/case.ts:6434).
// From octane-box2d: b2ContactConstraint#constructor (benchmarks/cases/octane-box2d/case.ts:6646).
// From octane-box2d: b2ContactFactory#constructor (benchmarks/cases/octane-box2d/case.ts:6693).
// From octane-box2d: b2ContactSolver#constructor (benchmarks/cases/octane-box2d/case.ts:6815).
// From octane-box2d: b2NullContact#constructor (benchmarks/cases/octane-box2d/case.ts:7250).
// From octane-box2d: b2PositionSolverManifold#constructor (benchmarks/cases/octane-box2d/case.ts:7344).
// From octane-box2d: b2Joint#constructor (benchmarks/cases/octane-box2d/case.ts:7783).
// From octane-box2d: b2DistanceJoint#constructor (benchmarks/cases/octane-box2d/case.ts:7914).
// From octane-box2d: b2JointDef#constructor (benchmarks/cases/octane-box2d/case.ts:8105).
// From octane-box2d: b2DistanceJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:8130).
// From octane-box2d: b2FrictionJoint#constructor (benchmarks/cases/octane-box2d/case.ts:8171).
// From octane-box2d: b2FrictionJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:8343).
// From octane-box2d: b2GearJoint#constructor (benchmarks/cases/octane-box2d/case.ts:8386).
// From octane-box2d: b2GearJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:8583).
// From octane-box2d: b2LineJoint#constructor (benchmarks/cases/octane-box2d/case.ts:8674).
// From octane-box2d: b2LineJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:9115).
// From octane-box2d: b2MouseJoint#constructor (benchmarks/cases/octane-box2d/case.ts:9165).
// From octane-box2d: b2MouseJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:9313).
// From octane-box2d: b2PrismaticJoint#constructor (benchmarks/cases/octane-box2d/case.ts:9361).
// From octane-box2d: b2PrismaticJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:9806).
// From octane-box2d: b2PulleyJoint#constructor (benchmarks/cases/octane-box2d/case.ts:9864).
// From octane-box2d: b2PulleyJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:10254).
// From octane-box2d: b2RevoluteJoint#constructor (benchmarks/cases/octane-box2d/case.ts:10331).
// From octane-box2d: b2RevoluteJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:10720).
// From octane-box2d: b2WeldJoint#constructor (benchmarks/cases/octane-box2d/case.ts:10760).
// From octane-box2d: b2WeldJointDef#constructor (benchmarks/cases/octane-box2d/case.ts:10936).
// Constructor new.target meta-property.
// Subject and control differ only by "new.target === Marker" -> "true".
// Executable control: tests/programs/a-new-target-meta-property-control.
class Marker {
  seen: boolean;
  constructor() { this.seen = new.target === Marker; }
}
export function probe(): boolean { return new Marker().seen; }
