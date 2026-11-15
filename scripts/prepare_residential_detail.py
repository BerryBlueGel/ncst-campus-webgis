"""Prepare a non-authoritative residential facade study from frozen plans."""
import hashlib
import json
import re
from pathlib import Path
from shapely import constrained_delaunay_triangles
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

PROJECT = Path(__file__).resolve().parents[1]
DIRECTORY = PROJECT / 'reference/buildings/residential_detail_v001'
TARGET = DIRECTORY / 'parameters.json'
if TARGET.exists():
    raise RuntimeError('Existing parameter version is protected')
inputs = ['reference/buildings/residential_batch_v004.json',
          'reference/buildings/remaining_batch_v001.json']
life, remaining = [json.loads((PROJECT / p).read_text(encoding='utf-8')) for p in inputs]
selected = [r for r in life['records'] if '校医院' not in r['planLabel']]
selected += [r for r in remaining['records'] if re.search(
    r'^兰园6号楼|^菊园6号楼|^菊园食堂$|^西区大学生活动中心$', r['planLabel'])]
assert len(selected) == 61 and len({r['id'] for r in selected}) == 61
excluded = [r for r in life['records'] if '校医院' in r['planLabel']]
excluded += [r for r in remaining['records'] if re.search(r'建筑 (022|154|156)$', r['sourceLabel'])]
assert len(excluded) == 5
assets = []
for record in selected:
    polygon = shape(record['geometryLocal'])
    assert polygon.geom_type == 'Polygon' and polygon.is_valid
    roof = list(constrained_delaunay_triangles(polygon).geoms)
    assert unary_union(roof).symmetric_difference(polygon).area < 1e-7
    frame = polygon.difference(polygon.buffer(-.28, join_style='mitre'))
    frame_triangles = list(constrained_delaunay_triangles(frame).geoms)
    assert unary_union(frame_triangles).symmetric_difference(frame).area < 1e-7
    label = record['planLabel']
    role = 'dormitory' if re.match(r'^[梅兰竹菊]园\d+号楼', label) else 'dining' if '食堂' in label else 'centre'
    district = next((x for x in ['梅园', '兰园', '竹园', '菊园'] if label.startswith(x)), None)
    if district is None:
        district = {'050': '竹园', '085': '菊园', '090': '梅园', '046': '兰园'}[record['sourceLabel'][-3:]]
    assets.append({
        'id': record['id'], 'name': label, 'key': record['sourceLabel'][-3:],
        'district': district, 'role': role, 'modelPath': record['sourceModelPath'],
        'geometry': record['geometryLocal'], 'centerEastNorth': list(polygon.centroid.coords[0]),
        'registeredAreaSqm': polygon.area, 'courtyardHoleCount': len(polygon.interiors),
        'heightMeters': record['sourceBodyHeightMeters'], 'floorCount': None,
        'heightStatus': 'SOURCE_ROUGH_PLACEHOLDER_NOT_MEASURED',
        'individualFacadeBindingStatus': 'ILLUSTRATIVE_TYPE_STYLE_NOT_INDIVIDUAL_PHOTO_MATCH',
        'roofTrianglesEastNorth': [list(t.exterior.coords)[:-1] for t in roof],
        'parapetGeometry': mapping(frame),
        'parapetTrianglesEastNorth': [list(t.exterior.coords)[:-1] for t in frame_triangles],
        'existingSourceBaseElevationMeters': record['sourceBaseElevationMeters']})
assert {role: sum(a['role'] == role for a in assets) for role in ['dormitory', 'dining', 'centre']} == {
    'dormitory': 53, 'dining': 4, 'centre': 4}
params = {
    'version': 'v001', 'status': 'INDEPENDENT_ILLUSTRATIVE_DETAIL_NOT_AS_BUILT',
    'axisConvention': 'BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP',
    'sourceFileHashes': {p: hashlib.sha256((PROJECT / p).read_bytes()).hexdigest().upper() for p in inputs},
    'assets': assets,
    'independentReferences': [{'id': r['id'], 'modelPath': r['sourceModelPath'], 'name': r['planLabel']}
                              for r in selected + excluded],
    'excludedDetailIds': [r['id'] for r in excluded],
    'facadePolicy': 'Dormitory punched windows; dining large glazing; centres generic. No doors, balconies, floor counts or bridges are asserted.',
    'windowRowsStatus': 'TWO_PROPORTIONAL_DISPLAY_BANDS_NOT_TWO_STOREYS',
    'roofPolicy': 'INSIDE_EXISTING_HEIGHT_AND_FOOTPRINT',
    'publicWebsiteUpdated': False, 'cloudUpdated': False}
DIRECTORY.mkdir(parents=True, exist_ok=True)
TARGET.write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'assets': len(assets), 'references': len(params['independentReferences']),
                  'districtCounts': {d: sum(a['district'] == d for a in assets) for d in ['梅园','兰园','竹园','菊园']}}, ensure_ascii=False))
