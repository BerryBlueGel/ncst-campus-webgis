"""Audit actual exported residential geometry, IDs, PNGs and protected hashes."""
import hashlib
import json
import struct
from pathlib import Path
from PIL import Image
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

PROJECT = Path(__file__).resolve().parents[1]
PARAMS = json.loads((PROJECT/'reference/buildings/residential_detail_v001/parameters.json').read_text(encoding='utf-8'))
REPORT = json.loads((PROJECT/'blender/residential_detail_v001_report.json').read_text(encoding='utf-8'))
READBACK = json.loads((PROJECT/'blender/residential_detail_v001_readback_geometry.json').read_text(encoding='utf-8'))
VALIDATION = json.loads((PROJECT/'blender/residential_detail_v001_validation.json').read_text(encoding='utf-8'))
TARGET = PROJECT/'blender/residential_detail_v001_geometry_audit.json'
if TARGET.exists():
    raise RuntimeError('Existing audit is protected')
checks = {'blenderReadbackPassed':VALIDATION['status']=='PASS'}
assets = []
for a in PARAMS['assets']:
    fid = a['id']
    polygon = shape(a['geometry'])
    roof = unary_union([Polygon(t) for t in READBACK['roofs'][fid]])
    projected = unary_union([Polygon(t) for t in READBACK['allProjectedTriangles'][fid] if Polygon(t).area>1e-10])
    tolerance = .08
    difference = roof.symmetric_difference(polygon).area
    outside = projected.difference(polygon).area
    missing = polygon.difference(projected).area
    holes = [Polygon(r) for r in a['geometry']['coordinates'][1:]]
    intrusion = sum(projected.intersection(p.buffer(-.002)).area for p in holes)
    checks[f"{a['key']}_RoofMatchesFrozenPlan"] = difference<tolerance
    checks[f"{a['key']}_NoOutsideGeometry"] = outside<tolerance
    checks[f"{a['key']}_NoLostFootprint"] = missing<tolerance
    checks[f"{a['key']}_NoCourtyardBridge"] = intrusion<1e-6
    assets.append({'id':fid,'name':a['name'],'roofProjectionDifferenceSqm':difference,
        'outsideProjectionSqm':outside,'missingProjectionSqm':missing,
        'courtyardIntrusionSqmExcluding2mmTolerance':intrusion,'float32AreaToleranceSqm':tolerance})
blob = (PROJECT/'output/residential_detail_preview_v001.glb').read_bytes()
magic,version,length = struct.unpack_from('<III',blob)
assert magic==0x46546c67 and version==2 and length==len(blob)
size,chunk_type = struct.unpack_from('<II',blob,12)
assert chunk_type==0x4e4f534a
gltf = json.loads(blob[20:20+size])
triangles = 0
for mesh in gltf['meshes']:
    for primitive in mesh['primitives']:
        assert primitive.get('mode',4)==4
        count = gltf['accessors'][primitive['indices']]['count'] if 'indices' in primitive else gltf['accessors'][primitive['attributes']['POSITION']]['count']
        triangles += count//3
checks['actualGlbTriangleCount'] = triangles==REPORT['triangles']
checks['actualGlbMeshCount'] = len(gltf['meshes'])==REPORT['meshes']
checks['sixSharedMaterials'] = len(gltf.get('materials',[]))==6
checks['noWebPhotosOrTexturesEmbedded'] = not gltf.get('images') and not gltf.get('textures')
root_ids = [n['extras']['feature_id'] for n in gltf['nodes'] if 'mesh' not in n and n.get('extras',{}).get('feature_id')]
checks['sixtyOneUniqueIndependentRoots'] = len(root_ids)==len(set(root_ids))==61
checks['exactExpectedIdSet'] = set(root_ids)=={a['id'] for a in PARAMS['assets']}
checks['protectedHashesStillUnchanged'] = all(hashlib.sha256((PROJECT/name).read_bytes()).hexdigest().upper()==h for name,h in REPORT['protectedBefore'].items())
previews = []
for filename in REPORT['previews']:
    with Image.open(PROJECT/filename) as img:
        img.load()
        previews.append({'path':filename,'size':list(img.size)})
checks['sixteenReadablePreviews'] = len(previews)==16 and all(p['size']==[1200,900] for p in previews)
audit = {'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),
         'checks':checks,'assets':assets,'glbMeshes':len(gltf['meshes']),'glbTriangles':triangles,
         'glbMaterials':len(gltf.get('materials',[])),'previews':previews,
         'note':'Independent geometry audit, not as-built facade or floor-count verification.'}
TARGET.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in audit.items() if k not in ['assets','previews','checks']},ensure_ascii=False))
if not all(checks.values()):
    print(json.dumps({k:v for k,v in checks.items() if not v}))
    raise RuntimeError('Artifact audit failed; preserve output for inspection')
