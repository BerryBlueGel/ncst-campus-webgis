"""Promote checked display topology; do not rebuild already matching roofs."""
import copy,json,gzip
from pathlib import Path
from integrate_library_v001_2 import read_glb,write_glb,sha256
P=Path(__file__).resolve().parents[1];D=P/'reference/buildings/campus_shapes_v004'
source=P/'output/campus_shape_review_v003.glb';out=P/'output/campus_shape_review_v004.glb'
assert not out.exists(),'Preserve release history'
data=json.loads((D/'input.json').read_text(encoding='utf-8'))
before_audit=json.loads((D/'audit_before.json').read_text(encoding='utf-8'))
assert not before_audit['mismatches'],'Review shape mismatches before publishing'
protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb','output/campus_detail_release_v004.glb',
 'output/campus_shape_review_v001.glb','output/campus_shape_review_v002.glb','output/campus_shape_review_v003.glb',
 'output/geojson/buildings.geojson','web/public/data/buildings.geojson']
hashes={p:sha256(P/p) for p in protected};old,binary=read_glb(source);doc=copy.deepcopy(old);changed=[]
for g in data['groups']:
    if not g['members']:continue
    for binding in g['bindings']:
        i=binding['nodeIndices'][0];extras=doc['nodes'][i].setdefault('extras',{})
        extras.update(shape_review_display_id=g['root'],shape_review_group_members=[g['root'],*g['members']]);changed.append(i)
scene=doc['scenes'][doc.get('scene',0)];scene.setdefault('extras',{}).update(shape_review_version='v004',
    shape_release_status='DISPLAY_REVIEW_NOT_SURVEYED',non_dorm_review_scopes=len(data['groups']))
write_glb(out,doc,binary);r,b=read_glb(out)
checks={'binaryExact':binary==b,'geometryMaterialsImagesExact':all(old.get(k)==r.get(k) for k in ['meshes','accessors','bufferViews','buffers','materials','images','textures']),
 'allNodeTransformsExact':all({k:v for k,v in n.items() if k!='extras'}=={k:v for k,v in r['nodes'][i].items() if k!='extras'} for i,n in enumerate(old['nodes'])),
 'unrelatedNodesExact':all(n==r['nodes'][i] for i,n in enumerate(old['nodes']) if i not in changed),
 'protectedInputsUnchanged':hashes=={p:sha256(P/p) for p in protected},'all58NonDormRoofsMatch':not before_audit['mismatches']}
assert all(checks.values()),checks
out.with_suffix('.glb.gz').write_bytes(gzip.compress(out.read_bytes(),compresslevel=9,mtime=0))
report={'status':'PASS','sha256':sha256(out),'sourceHash':sha256(source),'bytes':out.stat().st_size,'checks':checks,
 'nonDormScopes':len(data['groups']),'wholePickingGroups':[{'id':g['root'],'name':g['name'],'members':g['members']} for g in data['groups'] if g['members']],
 'changedMetadataNodes':changed,'protectedInputs':hashes,'geometryChangedThisStep':False,'authorityGISChanged':False,
 'limitations':['58 non-dorm display scopes agree with the registered schematic, not individually surveyed actual buildings.',
 'v003 dormitory low connections retain their 6.2m/two-level estimate.','Source IDs/areas remain separate, grouping is for display/picking only.']}
(D/'release_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['status','sha256','nonDormScopes','wholePickingGroups','geometryChangedThisStep']},ensure_ascii=False))
