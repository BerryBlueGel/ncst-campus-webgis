import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orthogonalizeRing,ringCornerErrors,type LocalPoint} from '../src/gis/features/RectilinearGeometry';
import {TEACHING_PLAN_GEOMETRIES,TEACHING_WALL_FRAME,registeredTeachingGeometry} from '../src/gis/features/TeachingPlanGeometry';
import {teachingBuildingAudit} from '../src/gis/features/TeachingBuildingAudit';

test('reviewed teaching walls share a rotated perpendicular frame, with bounded correction',()=>{
  assert.ok(TEACHING_WALL_FRAME.angleRadians>0.01,'not forced to north/east axes');
  for(const [i,plan] of TEACHING_PLAN_GEOMETRIES.entries()){
    const before=registeredTeachingGeometry(i),original=JSON.stringify(before);
    for(const [j,ring] of plan.geometry.coordinates.entries()){
      assert.equal(ring.length,before.coordinates[j]!.length);
      assert.ok(Math.max(...ringCornerErrors(ring.slice(0,-1) as LocalPoint[]))<1e-5);
      const a=before.coordinates[j]!.slice(0,-1),b=ring.slice(0,-1);
      for(const axis of [0,1])assert.ok(Math.abs(a.reduce((s,p)=>s+p[axis]!,0)-b.reduce((s,p)=>s+p[axis]!,0))<1e-8,'no ring translation');
    }
    const audit=teachingBuildingAudit(plan.id)!;
    assert.ok(audit.regularization.maxDisplacementMeters<1.6);
    assert.ok(audit.regularization.afterCornerErrorDegrees<1e-5);
    assert.equal(audit.maxFitAdjustmentMeters,0,'regularization is not envelope fitting');
    assert.equal(JSON.stringify(registeredTeachingGeometry(i)),original);
  }
});
test('rotated rectangles remain rotated and unchanged; snapping is idempotent',()=>{
  const angle=0.23,c=Math.cos(angle),s=Math.sin(angle);
  const ring:LocalPoint[]=([[0,0],[25,0],[25,15],[0,15]] as LocalPoint[]).map(([x,y])=>[100+c*x-s*y,200+s*x+c*y]);
  const once=orthogonalizeRing(ring,angle),twice=orthogonalizeRing(once,angle);
  once.forEach((p,i)=>assert.ok(Math.hypot(p[0]-ring[i]![0],p[1]-ring[i]![1])<1e-9));
  twice.forEach((p,i)=>assert.ok(Math.hypot(p[0]-once[i]![0],p[1]-once[i]![1])<1e-9));
});
test('reject unreviewed diagonal walls and excessive geometric deformation',()=>{
  assert.throws(()=>orthogonalizeRing([[0,0],[20,0],[30,10],[0,10]],0),/Non-rectilinear/);
  assert.throws(()=>orthogonalizeRing([[0,0],[100,10],[100,50],[0,50]],0,0.1),/budget/);
});
