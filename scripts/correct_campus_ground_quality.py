"""Non-destructive v002: extend type-study foundations and lift obscured plinths only."""
import argparse,copy,json
import numpy as np
from audit_campus_ground_quality import ROOT,FORMAL_HASH,PREVIEW_HASH,accessor,matrices,audit
from integrate_library_v001_2 import read_glb,write_glb,sha256,count_triangles,count_primitive_modes

SOURCE=ROOT/'output/campus_detail_preview_v001.glb'
TARGET=ROOT/'output/campus_detail_preview_v002.glb'
REPORT=ROOT/'reference/buildings/quality_v002/correction_report.json'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-existing',action='store_true');args=parser.parse_args()
    if args.verify_existing:
        assert TARGET.exists() and REPORT.exists()
        assert json.loads(REPORT.read_text(encoding='utf-8'))['status']=='FAIL','Never replace a successful delivery'
    else:assert not TARGET.exists() and not REPORT.exists(),'Never overwrite an existing delivery'
    assert sha256(SOURCE)==PREVIEW_HASH
    assert sha256(ROOT/'output/campus_refined_v005.glb')==FORMAL_HASH
    before=json.loads((REPORT.parent/'ground_audit_before.json').read_text(encoding='utf-8'))
    doc,original=read_glb(SOURCE); source_doc=copy.deepcopy(doc);binary=bytearray(original)
    worlds,parents=matrices(doc);changed=[];changed_nodes=set();changed_meshes=set()
    for r in before['buildings']:
        if not r['correctableTypeStudy']:continue
        if max(r['maximumPossibleBottomGapMeters'],r['maximumTerrainAbovePlinthMeters'])<=.1:continue
        # A root lift is used only when terrain actually obscures the plinth by over 10cm.
        lift=r['groundMaxMeters']+.05-r['foundationTopMeters'] if r['maximumTerrainAbovePlinthMeters']>.1 else 0
        i=r['rootNode'];n=doc['nodes'][i]
        if lift:
            parent=worlds[parents[i]] if i in parents else np.eye(4)
            shift=np.linalg.solve(parent[:3,:3],np.array([0,0,lift]))
            if 'matrix' in n:
                for axis in range(3): n['matrix'][12+axis]+=float(shift[axis])
            else:n['translation']=[float(v+s) for v,s in zip(n.get('translation',[0,0,0]),shift)]
            changed_nodes.add(i)
        target_bottom=r['groundMinMeters']-.12
        edited=0
        for j in r['baseNodes']:
            meshindex=doc['nodes'][j]['mesh'];changed_meshes.add(meshindex)
            # Base meshes must be private, horizontal, two-level prisms.
            assert sum(n.get('mesh')==meshindex for n in doc['nodes'])==1
            w=worlds[j].copy();w[2,3]+=lift;inv=np.linalg.inv(w)
            for p in doc['meshes'][meshindex]['primitives']:
                ai=p['attributes']['POSITION'];arr=accessor(doc,original,ai)
                points=np.c_[arr,np.ones(len(arr))] @ w.T
                bottom=r['foundationBottomMeters']+lift
                isbottom=np.abs(points[:,2]-bottom)<1e-4
                istop=np.abs(points[:,2]-(r['foundationTopMeters']+lift))<1e-4
                assert np.all(isbottom|istop),'Do not distort a nonuniform or sloped foundation'
                points[isbottom,2]=target_bottom
                corrected=(points @ inv.T)[:,:3].astype('<f4')
                binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);payload=corrected.tobytes();binary.extend(payload)
                view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(payload),'target':34962})
                new_accessor=copy.deepcopy(doc['accessors'][ai]);new_accessor.update(bufferView=view,byteOffset=0,
                    min=corrected.min(axis=0).astype(float).tolist(),max=corrected.max(axis=0).astype(float).tolist())
                p['attributes']['POSITION']=len(doc['accessors']);doc['accessors'].append(new_accessor)
                edited+=int(isbottom.sum())
        changed.append({'id':r['id'],'name':r['name'],'rootNode':i,'rootLiftMeters':lift,
            'foundationBottomAfterMeters':target_bottom,'foundationBottomBeforeMeters':r['foundationBottomMeters'],
            'bottomVerticesEdited':edited,'heightPolicy':'No change to wall/roof dimensions or unverified height',
            'groundPolicy':'Original terrain unchanged; horizontal foundation extends to cover full footprint ground range'})
    doc['buffers'][0]['byteLength']=len(binary)
    if args.verify_existing:
        actual_doc,actual_bin=read_glb(TARGET)
        assert actual_doc==doc and actual_bin[:len(binary)]==bytes(binary),'Existing candidate differs from reproducible correction'
    else:write_glb(TARGET,doc,bytes(binary))
    after=audit(TARGET)
    check_nodes=all(n==source_doc['nodes'][i] for i,n in enumerate(doc['nodes']) if i not in changed_nodes)
    checks={'124FeatureRoots':after['counts']['features']==124,
        'originalBinaryPrefixUnchanged':bytes(binary[:len(original)])==original,
        'materialsUnchanged':doc['materials']==source_doc['materials'],
        'onlyApprovedRootsMoved':check_nodes,
        'onlyBaseMeshPositionReferencesChanged':all(m==source_doc['meshes'][i] for i,m in enumerate(doc['meshes']) if i not in changed_meshes),
        'trianglesUnchanged':count_triangles(doc)==count_triangles(source_doc),
        'primitiveModesUnchanged':count_primitive_modes(doc)==count_primitive_modes(source_doc),
        'allCorrectedFoundationBottomsBelowFullGroundMinimum':all(r['maximumPossibleBottomGapMeters']<.0001 for r in after['buildings'] if r['id'] in {c['id'] for c in changed}),
        # Small original intrusion <=10cm was outside the stated correction threshold.
        'allCorrectedPlinthsWithin10cmTolerance':all(r['maximumTerrainAbovePlinthMeters']<=.1001 for r in after['buildings'] if r['id'] in {c['id'] for c in changed}),
        'noNewFootprintOverlaps':after['overlaps']==before['overlaps'],
        'officialV005Unchanged':sha256(ROOT/'output/campus_refined_v005.glb')==FORMAL_HASH,
        'publicModelUnchanged':sha256(ROOT/'web/public/models/campus_refined_v005.glb')==FORMAL_HASH,
        'previewV001Unchanged':sha256(SOURCE)==PREVIEW_HASH}
    for c in changed:
        i=c['rootNode'];new_worlds,_=matrices(doc)
        assert np.allclose(new_worlds[i][:2,:],worlds[i][:2,:],atol=1e-10),'No horizontal drift'
        assert np.allclose(new_worlds[i][:3,:3],worlds[i][:3,:3],atol=1e-10),'No root rotation or rescaling'
    report={'status':'PASS' if all(checks.values()) else 'FAIL','version':'v002',
        'formalModelUpdated':False,'cloudUpdated':False,'auditoriumChanged':False,
        'source':str(SOURCE.relative_to(ROOT)),'output':str(TARGET.relative_to(ROOT)),
        'sha256':sha256(TARGET),'bytes':TARGET.stat().st_size,'triangles':count_triangles(doc),
        'changedBuildings':len(changed),'liftedBuildings':sum(c['rootLiftMeters']>0 for c in changed),
        'maximumLiftMeters':max(c['rootLiftMeters'] for c in changed),
        'checks':checks,'changes':changed,'beforeCounts':before['counts'],'afterCounts':after['counts'],
        'limits':['Terrain ranges are from existing rough terrain, not survey or real ground measurement.',
            'Level foundations may show retaining-plinth faces on low sides. No terrain flattening or surrounding-road edits.',
            'Gym, administration and technology-building special geometry was not automatically corrected.',
            'Existing building heights and floor counts are still unverified unless separately source-bound.']}
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (REPORT.parent/'ground_audit_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['status','changedBuildings','liftedBuildings','maximumLiftMeters','bytes','sha256','afterCounts']},ensure_ascii=False))
    assert all(checks.values()),checks

if __name__=='__main__':main()
