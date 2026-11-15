"""Independent readback of emitted triangles, not input-only topology assertions."""
import json,sys
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union
from integrate_library_v001_2 import read_glb
from audit_campus_ground_quality import matrices
from audit_dorm_shapes import active_roof
P=Path(__file__).resolve().parents[1];version='v006' if '--next-v006' in sys.argv else 'v005';D=P/('reference/buildings/academic_refinement_'+version)
manifest=json.loads((D/'manifest.json').read_text(encoding='utf-8'))
doc,blob=read_glb(P/('output/campus_shape_review_'+version+'.glb'));worlds,_=matrices(doc)
roots={n['extras']['feature_id']:i for i,n in enumerate(doc['nodes']) if 'mesh' not in n and n.get('extras',{}).get('feature_id')}
rows=[]
for group in manifest['groups']+manifest.get('facadeOnly',[]):
    actual=unary_union([active_roof(doc,blob,worlds,roots[fid]) for fid in [group.get('root',group.get('id')),*group.get('members',[])]
      if not doc['nodes'][roots[fid]].get('extras',{}).get('shape_review_reference_only')])
    expected=shape(group['geometryLocal']);error=actual.symmetric_difference(expected).area
    assert error<.03,(group['name'],error)
    assert actual.geom_type==expected.geom_type
    neighbor=active_roof(doc,blob,worlds,roots['buildings:c4413d5a7dda1c0312d4'])
    assert actual.intersection(neighbor).area<.01
    rows.append({'name':group['name'],'projectedRoofErrorSqm':error,'geometryType':actual.geom_type,'overlapD2Sqm':actual.intersection(neighbor).area})
(D/'triangle_readback.json').write_text(json.dumps({'status':'PASS','rows':rows},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(rows,ensure_ascii=False))
