"""Lossless release candidate: weld identical vertex records and repack live accessors.
No quantization, simplification, floor/footprint changes, or formal replacement.
"""
import copy,gzip,hashlib,json
from pathlib import Path
import numpy as np
from integrate_library_v001_2 import read_glb,write_glb,sha256
from audit_campus_ground_quality import accessor,matrices

P=Path(__file__).resolve().parents[1];src=P/'output/campus_detail_preview_v003.glb'
out=P/'output/campus_detail_release_v004.glb';dest=P/'reference/buildings/release_v004'
assert not out.exists() and not dest.exists(),'Keep prior candidate'
protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
 'output/geojson/buildings.geojson','web/public/data/buildings.geojson',
 'output/campus_detail_preview_v001.glb','output/campus_detail_preview_v002.glb','output/campus_detail_preview_v003.glb']
before={p:sha256(P/p) for p in protected}
assert before[protected[0]]=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
assert before[protected[-1]]=='77C27985558769A1717977CDC345AD75DE08B6D0F4148E3B947F55CA89AAE7D7'
old,bin0=read_glb(src);doc=copy.deepcopy(old); arrays={};welds=[]
def data(i):
    if i not in arrays:arrays[i]=accessor(old,bin0,i)
    return arrays[i]
def new(array,template):
    i=len(doc['accessors']);a=copy.deepcopy(template);a.pop('bufferView',None);a.pop('byteOffset',None);a['count']=len(array)
    if 'min' in a:a['min']=array.min(axis=0).tolist()
    if 'max' in a:a['max']=array.max(axis=0).tolist()
    doc['accessors'].append(a);arrays[i]=array;return i
for mi,mesh in enumerate(doc['meshes']):
    for pi,primitive in enumerate(mesh['primitives']):
        if primitive.get('mode',4)!=4 or primitive.get('targets'):continue
        attrs=primitive['attributes'];items=list(attrs.items());values=[data(i) for _,i in items]
        assert len({len(v) for v in values})==1
        count=len(values[0]);records=np.concatenate([v.view('u1').reshape(count,-1) for v in values],axis=1)
        _,unique,inverse=np.unique(records,axis=0,return_index=True,return_inverse=True)
        if len(unique)==count:continue
        indices=data(primitive['indices']).reshape(-1) if 'indices' in primitive else np.arange(count)
        for (name,i),v in zip(items,values):attrs[name]=new(v[unique],doc['accessors'][i])
        ids=inverse[indices];dtype='<u2' if int(ids.max())<=65535 else '<u4'
        primitive['indices']=new(ids.astype(dtype).reshape(-1,1),{'componentType':5123 if dtype=='<u2' else 5125,'type':'SCALAR'})
        welds.append({'mesh':mi,'primitive':pi,'beforeVertices':count,'afterVertices':len(unique)})

used=set()
def refs():
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            yield p['attributes'],list(p['attributes'])
            if 'indices' in p:yield p,['indices']
            for target in p.get('targets',[]):yield target,list(target)
    for skin in doc.get('skins',[]):
        if 'inverseBindMatrices' in skin:yield skin,['inverseBindMatrices']
    for animation in doc.get('animations',[]):
        for sampler in animation['samplers']:yield sampler,['input','output']
for obj,keys in refs():used.update(obj[k] for k in keys)
accmap={i:j for j,i in enumerate(sorted(used))}
new_acc=[];views=[];binary=bytearray();payloads={}
def store(payload,target=None):
    key=(target,hashlib.sha256(payload).digest());cached=payloads.get(key)
    if cached is not None:
        v=views[cached];assert bytes(binary[v['byteOffset']:v['byteOffset']+v['byteLength']])==payload;return cached
    binary.extend(b'\0'*((-len(binary))%4));v={'buffer':0,'byteOffset':len(binary),'byteLength':len(payload)}
    if target:v['target']=target
    binary.extend(payload);idx=len(views);views.append(v);payloads[key]=idx;return idx
for i in sorted(used):
    a=copy.deepcopy(doc['accessors'][i]);v=data(i)
    # Unsigned-short indices are lossless where the vertex range permits them.
    if a['type']=='SCALAR' and a['componentType'] in [5123,5125] and int(v.max())<=65535:
        v=v.astype('<u2');a['componentType']=5123
    target=34963 if a['type']=='SCALAR' and a['componentType'] in [5123,5125] else 34962
    a['bufferView']=store(np.ascontiguousarray(v).tobytes(),target);a.pop('byteOffset',None);new_acc.append(a)
for image in doc.get('images',[]):
    if 'bufferView' in image:
        v=old['bufferViews'][image['bufferView']];offset=v.get('byteOffset',0)
        image['bufferView']=store(bin0[offset:offset+v['byteLength']])
for obj,keys in refs():
    for k in keys:obj[k]=accmap[obj[k]]
doc['accessors']=new_acc;doc['bufferViews']=views;doc['buffers']=[{'byteLength':len(binary)}]
scene=doc['scenes'][doc.get('scene',0)];scene.setdefault('extras',{})['campus_detail_version']='release_v004'
scene['extras']['height_policy']='USER_CONFIRMED_TYPICAL_STOREYS_ESTIMATED_METRE_HEIGHTS'
write_glb(out,doc,bytes(binary));d,b=read_glb(out)
checks={};geometry_errors=[]
for mi,mesh in enumerate(old['meshes']):
    for pi,p in enumerate(mesh['primitives']):
        q=d['meshes'][mi]['primitives'][pi]
        ia=accessor(old,bin0,p['indices']).reshape(-1) if 'indices' in p else np.arange(old['accessors'][p['attributes']['POSITION']]['count'])
        ib=accessor(d,b,q['indices']).reshape(-1) if 'indices' in q else np.arange(d['accessors'][q['attributes']['POSITION']]['count'])
        assert len(ia)==len(ib) and p.get('mode',4)==q.get('mode',4)
        assert p.get('material')==q.get('material')
        for name,i in p['attributes'].items():
            va=accessor(old,bin0,i)[ia];vb=accessor(d,b,q['attributes'][name])[ib]
            geometry_errors.append(np.array_equal(va,vb))
checks['allExpandedPrimitiveAttributesExact']=all(geometry_errors)
checks['nodeTransformsNamesIdsMetadataExact']=old['nodes']==d['nodes']
checks['sameMeshCount']=len(old['meshes'])==len(d['meshes'])==1870
checks['materialsTexturesSamplersExact']=all(old.get(k)==d.get(k) for k in ['materials','textures','samplers'])
checks['embeddedImagesExact']=all(
    bin0[old['bufferViews'][a['bufferView']].get('byteOffset',0):old['bufferViews'][a['bufferView']].get('byteOffset',0)+old['bufferViews'][a['bufferView']]['byteLength']]
    ==b[d['bufferViews'][z['bufferView']]['byteOffset']:d['bufferViews'][z['bufferView']]['byteOffset']+d['bufferViews'][z['bufferView']]['byteLength']]
    for a,z in zip(old.get('images',[]),d.get('images',[])) if 'bufferView' in a)
checks['124FeatureRootsExact']=sum(bool(n.get('extras',{}).get('feature_id')) and 'mesh' not in n for n in d['nodes'])==124
checks['protectedInputsExact']=before=={p:sha256(P/p) for p in protected}
checks['smallerFile']=out.stat().st_size<src.stat().st_size
gzip_path=out.with_suffix('.glb.gz');gzip_path.write_bytes(gzip.compress(out.read_bytes(),compresslevel=9,mtime=0))
dest.mkdir(parents=True)
rows=json.loads((P/'reference/buildings/storeys_v003/storey_parameters.json').read_text(encoding='utf-8'))['assets']
manifest={'version':'release_v004','sha256':sha256(out),'url':'/__campus_review/model.glb',
 'heightEstimates':{a['id']:{'storeys':a['storeys'],'storeyHeightMeters':a['storeyHeightMeters'],
 'bodyHeightMeters':a['bodyHeightMeters'],'heightAboveRootMeters':a['heightAboveRootMeters']} for a in rows}}
(dest/'review_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
report={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'passed':sum(checks.values()),'total':len(checks),
 'sourceSha256':before[protected[-1]],'sha256':sha256(out),'sourceBytes':src.stat().st_size,'bytes':out.stat().st_size,
 'gzipBytes':gzip_path.stat().st_size,'savedBytes':src.stat().st_size-out.stat().st_size,
 'accessorsBefore':len(old['accessors']),'accessorsAfter':len(d['accessors']),
 'bufferViewsBefore':len(old['bufferViews']),'bufferViewsAfter':len(d['bufferViews']),
 'weldedPrimitives':len(welds),'savedVertexRecords':sum(r['beforeVertices']-r['afterVertices'] for r in welds),
 'expandedTriangleCountUnchanged':True,'welds':welds,'protectedInputs':before,
 'formalUpdated':False,'cloudUpdated':False,'limitations':['Lossless packing does not reduce triangle or draw-call counts.','Retains user floor assumptions, estimated heights, uncertain types and original terrain.']}
(dest/'pack_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['status','passed','total','bytes','gzipBytes','savedBytes','sha256','accessorsAfter','savedVertexRecords']}))
assert all(checks.values())
