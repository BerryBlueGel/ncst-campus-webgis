"""Independent actual-export geometry audit; requires project GIS Python."""
import hashlib
import json
import struct
from pathlib import Path
from PIL import Image
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

PROJECT=Path(__file__).resolve().parents[1]
PARAMS=json.loads((PROJECT/'reference/buildings/teaching_detail_v001/parameters.json').read_text(encoding='utf-8'))
REPORT=json.loads((PROJECT/'blender/teaching_detail_v001_report.json').read_text(encoding='utf-8'))
READBACK=json.loads((PROJECT/'blender/teaching_detail_v001_readback_geometry.json').read_text(encoding='utf-8'))
validation_path=PROJECT/'blender/teaching_detail_v001_validation_v002.json'
if not validation_path.exists():
    validation_path=PROJECT/'blender/teaching_detail_v001_validation.json'
VALIDATION=json.loads(validation_path.read_text(encoding='utf-8'))
TARGET=PROJECT/'blender/teaching_detail_v001_geometry_audit.json'
if TARGET.exists():
    raise RuntimeError('Existing audit is protected')
checks={'blenderReadbackPassed':VALIDATION['status']=='PASS'}
asset_audits=[]
for asset in PARAMS['assets']:
    fid=asset['id']
    polygon=shape(asset['geometry'])
    roof=unary_union([Polygon(t) for t in READBACK['roofs'][fid]])
    all_nonzero=[Polygon(t) for t in READBACK['allProjectedTriangles'][fid] if Polygon(t).area>1e-10]
    projected=unary_union(all_nonzero)
    # Float32 roundtrip creates submillimetre boundary error, not exact doubles.
    tolerance=.08
    difference=roof.symmetric_difference(polygon).area
    outside=projected.difference(polygon).area
    missing=polygon.difference(projected).area
    holes=[Polygon(r) for r in asset['geometry']['coordinates'][1:]]
    intrusion=sum(projected.intersection(p.buffer(-.002)).area for p in holes)
    checks[f"{asset['block']}_RoofMatchesRegisteredPlan"]=difference<tolerance
    checks[f"{asset['block']}_AllGeometryWithinPlan"]=outside<tolerance
    checks[f"{asset['block']}_NoLostFootprint"]=missing<tolerance
    checks[f"{asset['block']}_CourtyardUncovered"]=intrusion<1e-6
    asset_audits.append({'id':fid,'name':asset['name'],'registeredAreaSqm':polygon.area,
        'actualRoofProjectionDifferenceSqm':difference,'actualOutsideProjectionSqm':outside,
        'actualMissingProjectionSqm':missing,'courtyardIntrusionSqmExcluding2mmTolerance':intrusion,
        'courtyardHoleCount':len(holes),'float32AreaToleranceSqm':tolerance})
blob=(PROJECT/'output/teaching_detail_preview_v001.glb').read_bytes()
magic,version,length=struct.unpack_from('<III',blob)
assert magic==0x46546c67 and version==2 and length==len(blob)
chunk_size,chunk_type=struct.unpack_from('<II',blob,12)
assert chunk_type==0x4e4f534a
gltf=json.loads(blob[20:20+chunk_size])
triangle_count=0
for mesh in gltf['meshes']:
    for primitive in mesh['primitives']:
        assert primitive.get('mode',4)==4
        count=gltf['accessors'][primitive['indices']]['count'] if 'indices' in primitive else gltf['accessors'][primitive['attributes']['POSITION']]['count']
        triangle_count+=count//3
checks['actualGlbTriangleCount']=triangle_count==REPORT['triangles']
checks['actualGlbMeshCount']=len(gltf['meshes'])==REPORT['meshes']
checks['noSourcePhotosInGlb']=not gltf.get('images') and not gltf.get('textures')
checks['sharedMaterialBudget']=len(gltf.get('materials',[]))<=7
checks['eightDistinctStableIdRoots']=len({n['extras']['feature_id'] for n in gltf['nodes'] if 'mesh' not in n and n.get('extras',{}).get('feature_id')})==8
checks['protectedHashesStillUnchanged']=all(hashlib.sha256((PROJECT/name).read_bytes()).hexdigest().upper()==digest for name,digest in REPORT['protectedBefore'].items())
checks['primaryPhotoUnchanged']=hashlib.sha256((PROJECT/PARAMS['sourcePhoto']).read_bytes()).hexdigest().upper()==PARAMS['sourcePhotoSha256']
previews=[]
for filename in REPORT['previews']:
    with Image.open(PROJECT/filename) as image:
        image.load()
        previews.append({'path':filename,'size':list(image.size),'mode':image.mode})
checks['tenReadablePngPreviews']=len(previews)==10 and all(p['size']==[1200,900] for p in previews)
audit={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),
       'checks':checks,'assets':asset_audits,'glbMeshes':len(gltf['meshes']),
       'glbTriangles':triangle_count,'glbMaterials':len(gltf.get('materials',[])),
       'previews':previews,'note':'Geometry/readback audit, not a claim of measured heights or as-built facade match.'}
TARGET.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in audit.items() if k not in ('previews','assets')},ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Artifact audit failed; keep outputs for investigation')
