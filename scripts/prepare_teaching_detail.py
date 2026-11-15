"""Triangulate roof WITH its holes and preflight exact registered contours."""
import hashlib
import json
from pathlib import Path

from shapely import constrained_delaunay_triangles
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

PROJECT=Path(__file__).resolve().parents[1]
DIRECTORY=PROJECT/'reference/buildings/teaching_detail_v001'
TARGET=DIRECTORY/'parameters.json'
if TARGET.exists():
    raise RuntimeError('Previous parameter version is protected')
params=json.loads((DIRECTORY/'registered_input.json').read_text(encoding='utf-8'))
params['sourcePhotoSha256']=hashlib.sha256((PROJECT/params['sourcePhoto']).read_bytes()).hexdigest().upper()
params['facadeEvidence']='Pale outer frame, warm dark glazed planes, fine mullions and thin cornice observed in group night photo. Individual floor counts and entrances are not established.'
params['roofDetailHeightPolicy']='CORNICE_AND_PARAPET_WITHIN_EXISTING_BODY_HEIGHT_NO_ADDED_STOREY'
for asset in params['assets']:
    polygon=shape(asset['geometry'])
    assert polygon.is_valid
    roof=list(constrained_delaunay_triangles(polygon).geoms)
    assert all(polygon.covers(p) for p in roof)
    assert unary_union(roof).symmetric_difference(polygon).area<1e-7
    frame=polygon.difference(polygon.buffer(-.38,join_style='mitre'))
    frame_triangles=list(constrained_delaunay_triangles(frame).geoms)
    assert all(frame.covers(p) for p in frame_triangles)
    assert unary_union(frame_triangles).symmetric_difference(frame).area<1e-7
    asset.update({'centerEastNorth':list(polygon.centroid.coords[0]),'registeredAreaSqm':polygon.area,
                  'heightMeters':6.0,'heightStatus':'SOURCE_ROUGH_PLACEHOLDER_NOT_MEASURED',
                  'floorCount':None,'courtyardHoleCount':len(polygon.interiors),
                  'roofTrianglesEastNorth':[list(p.exterior.coords)[:-1] for p in roof],
                  'parapetTrianglesEastNorth':[list(p.exterior.coords)[:-1] for p in frame_triangles],
                  'parapetGeometry':mapping(frame),
                  'roofProjectionDifferenceSqm':unary_union(roof).symmetric_difference(polygon).area,
                  'axisFacingDirection':'EAST' if polygon.centroid.x<990 else 'WEST',
                  'individualFacadeBindingStatus':'GROUP_STYLE_ONLY_NOT_SINGLE_BUILDING_PHOTO_MATCH'})
TARGET.write_text(json.dumps(params,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'parameters':str(TARGET),'assets':len(params['assets']),'closedCourtyards':sum(a['courtyardHoleCount'] for a in params['assets'])},ensure_ascii=False))
