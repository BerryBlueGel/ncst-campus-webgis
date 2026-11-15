"""Independent GLB/PNG/source evidence audit, without Blender state reuse."""
import hashlib
import json
import struct
from pathlib import Path

from PIL import Image
from shapely.geometry import shape
from shapely.ops import unary_union

PROJECT=Path(__file__).resolve().parents[1]
VERSION='v002'
REPORT=PROJECT/f'blender/admin_technology_{VERSION}_report.json'
OUT=PROJECT/f'reference/buildings/admin_technology_detail_v001/artifact_audit_{VERSION}.json'
if OUT.exists():
    raise RuntimeError('Previous audit is protected')
report=json.loads(REPORT.read_text(encoding='utf-8'))
validation=json.loads((PROJECT/f'blender/admin_technology_{VERSION}_validation.json').read_text(encoding='utf-8'))
raw=(PROJECT/f'output/admin_technology_preview_{VERSION}.glb').read_bytes()
magic,version,total=struct.unpack_from('<4sII',raw)
length,kind=struct.unpack_from('<II',raw,12)
gltf=json.loads(raw[20:20+length])
primitives=[p for m in gltf['meshes'] for p in m['primitives']]
triangles=sum(gltf['accessors'][p['indices']]['count']//3 for p in primitives if p.get('mode',4)==4)
source=json.loads((PROJECT/'reference/buildings/remaining_batch_v001.json').read_text(encoding='utf-8'))['records']
checks={'blenderReadbackPass':validation['status']=='PASS',
        'glbHeaderValid':magic==b'glTF' and version==2 and total==len(raw) and kind==0x4E4F534A,
        'glbMeshCountMatches':len(gltf['meshes'])==report['meshes'],
        'glbTriangleCountMatches':triangles==report['triangles'],
        'sevenSharedMaterials':len(gltf['materials'])==report['materials']==7,
        'noCameraLightOrPhotoInGlb':not gltf.get('cameras') and not gltf.get('images') and not gltf.get('extensions'),
        'protectedHashesStillUnchanged':all(hashlib.sha256((PROJECT/n).read_bytes()).hexdigest().upper()==h for n,h in report['protectedBefore'].items()),
        'glbHashMatches':hashlib.sha256(raw).hexdigest().upper()==report['glbSha256'],
        'noAutomaticWebsiteCloudUpdate':report['publicWebsiteUpdated'] is False and report['cloudUpdated'] is False}
for a in report['assets']:
    record=next(r for r in source if r['id']==a['featureId'])
    original=shape(record['geometryLocal'])
    pieces=[shape(p['geometry']) for p in a['regions']]
    union=unary_union(pieces)
    checks[f"{a['key']}_RegisteredFootprintUnchanged"]=original.symmetric_difference(shape(a['footprint'])).area<1e-8
    checks[f"{a['key']}_RegionUnionExact"]=union.symmetric_difference(original).area<1e-8
    checks[f"{a['key']}_RegionValidity"]=all(p.is_valid for p in pieces)
    checks[f"{a['key']}_NoRegionAreaOverlap"]=abs(sum(p.area for p in pieces)-union.area)<1e-8
    checks[f"{a['key']}_SourcePhotoUnchanged"]=hashlib.sha256((PROJECT/a['photo']).read_bytes()).hexdigest().upper()==a['sourcePhotoSha256']
    checks[f"{a['key']}_NoVerifiedFloorsInvented"]=a['heightStatus']=='PROVISIONAL_PHOTO_RATIO_NOT_MEASURED' and 'floorCount' not in a
images=[]
for name in report['previews']:
    with Image.open(PROJECT/name) as im:
        im.load()
        images.append({'path':name,'width':im.width,'height':im.height,'format':im.format})
checks['sevenPngsReadable']=len(images)==7 and all(i['format']=='PNG' and i['width']==1200 and i['height']==900 for i in images)
audit={'version':VERSION,'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
       'glbMeshes':len(gltf['meshes']),'glbTriangles':triangles,'glbMaterials':len(gltf['materials']),'glbBytes':len(raw),'images':images,
       'note':'Structural and coordinate audit. Candidate tower placement and heights remain unmeasured.'}
OUT.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(audit,ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Artifact audit failed')
