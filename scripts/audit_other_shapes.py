"""Compare every registered non-dorm roof with the actual visible candidate."""
import json,sys
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely import set_precision
from audit_dorm_shapes import active_roof
from audit_campus_ground_quality import matrices
from integrate_library_v001_2 import read_glb,sha256
P=Path(__file__).resolve().parents[1];D=P/'reference/buildings/campus_shapes_v004'
data=json.loads((D/'input.json').read_text(encoding='utf-8'))
after='--after' in sys.argv;model='output/campus_shape_review_v004.glb' if after else data['sourceModel']
doc,binary=read_glb(P/model);worlds,_=matrices(doc);rows=[]
for g in data['groups']:
    actual=unary_union([active_roof(doc,binary,worlds,b['nodeIndices'][0]) for b in g['bindings'] if not doc['nodes'][b['nodeIndices'][0]].get('extras',{}).get('shape_review_reference_only')])
    expected=set_precision(shape(g['geometryLocal']),.00001)
    rows.append({'id':g['root'],'name':g['name'],'areaDifferenceSqm':actual.symmetric_difference(expected).area,
        'boundaryDifferenceMeters':set_precision(actual,.001).hausdorff_distance(set_precision(expected,.001)),
        'components':len(expected.geoms) if hasattr(expected,'geoms') else 1,'actualGeometryLocal':actual.__geo_interface__,
        'insideSampleLocal':list(expected.representative_point().coords)[0],
        'holes':sum(len(p.interiors) for p in expected.geoms) if hasattr(expected,'geoms') else len(expected.interiors)})
report={'model':model,'sha256':sha256(P/model),'count':len(rows),'rows':rows,
    'mismatches':[r for r in rows if r['areaDifferenceSqm']>.1 or r['boundaryDifferenceMeters']>.01],
    'status':'PASS' if all(r['areaDifferenceSqm']<.1 and r['boundaryDifferenceMeters']<.01 for r in rows) else 'REVIEW_REQUIRED' if not after else 'FAIL'}
(D/('audit_after.json' if after else 'audit_before.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'count':report['count'],'status':report['status'],'mismatches':[{'name':r['name'],'areaSqm':r['areaDifferenceSqm'],'boundary':r['boundaryDifferenceMeters']} for r in report['mismatches']]},ensure_ascii=False))
