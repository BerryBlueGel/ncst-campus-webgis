"""User-confirmed typical storeys; metre heights and individual facades remain estimates.

Regenerate eligible facade buffers only. Keep v002 foundation meshes, transforms,
original binary prefix, all other nodes, and formal/public assets unchanged.
"""
import copy, json, math
from collections import Counter
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union
from audit_campus_ground_quality import accessor, matrices, primitive_points, mesh_triangles
from integrate_library_v001_2 import read_glb, write_glb, sha256, descendants

P=Path(__file__).resolve().parents[1]
SOURCE=P/'output/campus_detail_preview_v002.glb'
OUT=P/'output/campus_detail_preview_v003.glb'
DEST=P/'reference/buildings/storeys_v003'
PROTECTED=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
 'output/geojson/buildings.geojson','web/public/data/buildings.geojson',
 'output/campus_detail_preview_v001.glb','output/campus_detail_preview_v002.glb',
 'blender/campus_detail_working_v001.blend','blender/campus_detail_working_v002.blend']
assert not OUT.exists() and not DEST.exists(), 'Preserve previous delivery; use a new version'
before={s:sha256(P/s) for s in PROTECTED}
assert before[PROTECTED[0]]=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
assert before['output/campus_detail_preview_v002.glb']=='EE08AB1AF8D33C33EB33900AC58D586C8E536C53503A034FF908184788EA07E3'
old,old_binary=read_glb(SOURCE); doc=copy.deepcopy(old); binary=bytearray(old_binary)
worlds,parents=matrices(old)
roots={n.get('extras',{}).get('feature_id'):i for i,n in enumerate(old['nodes'])
       if n.get('extras',{}).get('feature_id') and 'mesh' not in n}
eligible=[]; unchanged=[]
for group in ['residential','teaching','other_areas']:
    data=json.loads((P/f'reference/buildings/{group}_detail_v001/parameters.json').read_text(encoding='utf-8'))
    for a in data['assets']:
        dorm=group=='residential' and a['role']=='dormitory'
        teaching=group=='teaching' or (group=='other_areas' and
            ((a['role']=='academic' and not any(s in a['name'] for s in ['行政楼','信息中心','图书馆']))
             or a['name']=='体育教学楼'))
        if dorm or teaching:
            eligible.append({**a,'group':group,'storeys':5 if dorm else 4,
                             'storeyHeightMeters':3.1 if dorm else 4.2,
                             'heightType':'DORMITORY' if dorm else 'TEACHING'})
        else:
            unchanged.append({'id':a['id'],'name':a['name'],'role':a.get('role'),
                              'reason':'Outside user-confirmed teaching/dormitory type; retain previous estimate'})

def append_accessor(array,kind,component,target):
    global binary
    array=np.ascontiguousarray(array)
    binary.extend(b'\0'*((-len(binary))%4)); offset=len(binary); binary.extend(array.tobytes())
    view=len(doc['bufferViews']); doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
    a={'bufferView':view,'componentType':component,'count':len(array),'type':kind}
    if kind=='VEC3': a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    index=len(doc['accessors']);doc['accessors'].append(a);return index

def components(g): return g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
def rings(g,cx,cn):
    for part in components(g):
        for ri,ring in enumerate(part):
            r=np.array(ring[:-1],dtype=float)-[cx,cn]
            area=sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r))/2
            if (area>0)!=(ri==0):r=r[::-1]
            yield ri,r

changed_nodes=set(); changed_meshes=set(); rows=[]
mesh_uses=Counter(n['mesh'] for n in old['nodes'] if 'mesh' in n)
for a in eligible:
    fid=a['id']; root_i=roots[fid]; root=doc['nodes'][root_i]; changed_nodes.add(root_i)
    cx,cn=a['centerEastNorth']; members=[j for j,_ in descendants(doc,root_i) if 'mesh' in doc['nodes'][j]]
    byrole={doc['nodes'][j]['extras']['mesh_role']:j for j in members}
    assert 'base' in byrole and 'roof' in byrole
    assert all(np.allclose(worlds[j],worlds[root_i],atol=1e-8) for j in members),'Unexpected child transform'
    for j in members:assert mesh_uses[doc['nodes'][j]['mesh']]==1,'Do not mutate a shared mesh'
    plinth=.35 if a['group']=='teaching' else (.32 if a['group']=='residential' else .30)
    floors=a['storeys'];sh=a['storeyHeightMeters'];wall_top=plinth+floors*sh;top=wall_top+.28
    wallmat='cream' if a['group']=='teaching' else 'wall'
    frame='cream' if a['group']=='teaching' else 'frame'
    buffers={role:([],[],[]) for role in byrole if role!='base'}
    def face(mat,vs):
        vs=np.asarray(vs,float); normal=np.cross(vs[1]-vs[0],vs[2]-vs[0]);size=np.linalg.norm(normal)
        if size<1e-10:return
        normal/=size;v,n,t=buffers[mat];idx=len(v);v.extend(vs.tolist());n.extend([normal.tolist()]*len(vs))
        t.extend([[idx,idx+k,idx+k+1] for k in range(1,len(vs)-1)])
    def cap(ts,h,mat):
        for t in ts:
            vs=[[p[0]-cx,p[1]-cn,h] for p in t]
            if np.cross(np.array(vs[1])-vs[0],np.array(vs[2])-vs[0])[2]<0:vs.reverse()
            face(mat,vs)
    cap(a['roofTrianglesEastNorth'],wall_top+.02,'roof')
    for ri,r in rings(a['parapetGeometry'],cx,cn):
        for i,p in enumerate(r):
            q=r[(i+1)%len(r)];face(frame,[(p[0],p[1],wall_top),(q[0],q[1],wall_top),(q[0],q[1],top),(p[0],p[1],top)])
    cap(a['parapetTrianglesEastNorth'],top,frame)
    panels=0; row_windows=[0]*floors; rows_z=[]
    for row in range(floors):
        low=plinth+row*sh;lo=low+(.8 if floors==5 else .9);hi=low+(2.25 if floors==5 else 2.85)
        rows_z.append([lo,hi])
    for ri,r in rings(a['geometry'],cx,cn):
        for i,p in enumerate(r):
            q=r[(i+1)%len(r)];d=q-p;length=float(np.linalg.norm(d))
            if length<.001:continue
            normal=np.array([d[1],-d[0]])/length
            def point(u,z,inset=0):
                xy=p+d*u-normal*inset;return [float(xy[0]),float(xy[1]),float(z)]
            def panel(u,v,lo,hi,mat,inset=0):
                if v-u>1e-8 and hi-lo>1e-8:face(mat,[point(u,lo,inset),point(v,lo,inset),point(v,hi,inset),point(u,hi,inset)])
            if length<2.8:
                panel(0,1,plinth,wall_top,wallmat);continue
            primary=a['group']=='teaching' and ri==0 and length>12 and (normal[0]>.9 if a.get('axisFacingDirection')=='EAST' else normal[0]<-.9)
            pane='warm_glass' if primary else 'glass'
            if floors==5:
                bays=max(1,round(length/5.2));margin=0
            else:
                bays=max(1,round(length/(2.2 if primary else (3.8 if a['group']=='teaching' else 7))))
                margin=min(.7,length/6)/length
                panel(0,margin,plinth,wall_top,wallmat);panel(1-margin,1,plinth,wall_top,wallmat)
            for row,(wl,wh) in enumerate(rows_z):
                low=plinth+row*sh;high=plinth+(row+1)*sh
                for b in range(bays):
                    u=margin+(1-2*margin)*b/bays;v=margin+(1-2*margin)*(b+1)/bays
                    if floors==5:left=u+(v-u)*.30;right=v-(v-u)*.30
                    else:
                        pier=min(.18/length,(v-u)/5);left=u+pier;right=v-pier
                    panel(u,v,low,wl,wallmat);panel(u,v,wh,high,wallmat)
                    panel(u,left,wl,wh,wallmat);panel(right,v,wl,wh,wallmat)
                    inset=.09 if floors==5 else .18 if a['group']=='teaching' else .1
                    panel(left,right,wl,wh,pane,inset)
                    for e in [left,right]:face(frame,[point(e,wl),point(e,wl,inset),point(e,wh,inset),point(e,wh)])
                    for z in [wl,wh]:face(frame,[point(left,z),point(right,z),point(right,z,inset),point(left,z,inset)])
                    if 'mullion' in buffers:
                        middle=(left+right)/2;panel(middle,middle+.045/length,wl,wh,'mullion',inset*.7)
                    panels+=1;row_windows[row]+=1
    for role,(vs,ns,ts) in buffers.items():
        assert vs and ts,(fid,role,'empty mesh')
        j=byrole[role];mi=doc['nodes'][j]['mesh'];changed_nodes.add(j);changed_meshes.add(mi)
        mesh=doc['meshes'][mi];material=mesh['primitives'][0]['material']
        assert len(mesh['primitives'])==1
        pos=np.array(vs,dtype='<f4');norm=np.array(ns,dtype='<f4');indices=np.array(ts,dtype='<u4').reshape(-1)
        mesh['primitives']=[{'attributes':{'POSITION':append_accessor(pos,'VEC3',5126,34962),
            'NORMAL':append_accessor(norm,'VEC3',5126,34962)},'indices':append_accessor(indices,'SCALAR',5125,34963),'material':material,'mode':4}]
        doc['nodes'][j]['extras'].update(window_rows=floors,storeys=floors,storey_count_status='USER_CONFIRMED_TYPICAL_STOREYS',height_status='ESTIMATED_FROM_STOREYS_NOT_MEASURED')
    root['extras'].update(height_m=top,height_status='ESTIMATED_FROM_STOREYS_NOT_MEASURED',floor_count=floors,
        floor_count_status='USER_CONFIRMED_TYPICAL_STOREYS',storey_height_m=sh,body_height_m=floors*sh,
        window_rows=floors,individual_storey_count_surveyed=False)
    rows.append({'id':fid,'name':a['name'],'rootNode':root_i,'group':a['group'],'type':a['heightType'],
        'storeys':floors,'storeyHeightMeters':sh,'bodyHeightMeters':floors*sh,'heightAboveRootMeters':top,
        'rootWorldENU':worlds[root_i][:3,3].tolist(),'windowRowsLocalZ':rows_z,'windowPanelsPerRow':row_windows,
        'heightStatus':'ESTIMATED_FROM_STOREYS_NOT_MEASURED','storeyCountStatus':'USER_CONFIRMED_TYPICAL_STOREYS',
        'appliedAsTypeDefault':True,'individualFacadePhotoMatched':False})
doc['buffers'][0]['byteLength']=len(binary)
write_glb(OUT,doc,bytes(binary)); result,result_bin=read_glb(OUT)
rw,_=matrices(result);checks={}
checks['unchangedBinaryPrefix']=result_bin[:len(old_binary)]==old_binary
checks['allRootTransformsPreserved']=all(np.allclose(worlds[i],rw[i],atol=0,rtol=0) for i in roots.values())
checks['materialsScenesTexturesUnchanged']=all(result.get(k)==old.get(k) for k in ['materials','scenes','textures','images','samplers'])
checks['allUnchangedNodesExact']=all(n==result['nodes'][i] for i,n in enumerate(old['nodes']) if i not in changed_nodes)
checks['allUnchangedMeshesExact']=all(m==result['meshes'][i] for i,m in enumerate(old['meshes']) if i not in changed_meshes)
checks['same124StableIds']=len(roots)==124 and {n.get('extras',{}).get('feature_id') for n in result['nodes'] if 'mesh' not in n}=={n.get('extras',{}).get('feature_id') for n in old['nodes'] if 'mesh' not in n}
checks['53DormsFiveRows']=sum(a['type']=='DORMITORY' for a in rows)==53 and all(len(a['windowRowsLocalZ'])==5 and min(a['windowPanelsPerRow'])>0 for a in rows if a['type']=='DORMITORY')
checks['allTeachingFourRows']=all(a['storeys']==4 and len(a['windowRowsLocalZ'])==4 and min(a['windowPanelsPerRow'])>0 for a in rows if a['type']=='TEACHING')
checks['allFoundationMeshesExact']=all(old['meshes'][n['mesh']]==result['meshes'][n['mesh']] for n in old['nodes'] if n.get('extras',{}).get('mesh_role')=='base' and 'mesh' in n)
roof_errors=[];height_errors=[];glass_errors=[]
for a in rows:
    members=[j for j,_ in descendants(result,a['rootNode']) if 'mesh' in result['nodes'][j]]
    roofnode=next(j for j in members if result['nodes'][j].get('extras',{}).get('mesh_role')=='roof')
    def roofpoly(d,b,w):return unary_union([Polygon(t[:,:2]) for t in mesh_triangles(d,b,d['nodes'][roofnode],w[roofnode])])
    roof_errors.append(roofpoly(old,old_binary,worlds).symmetric_difference(roofpoly(result,result_bin,rw)).area)
    pts=np.concatenate([primitive_points(result,result_bin,p,rw[j])[:,:3] for j in members for p in result['meshes'][result['nodes'][j]['mesh']]['primitives']])
    height_errors.append(abs(float(pts[:,2].max()-rw[a['rootNode']][2,3])-a['heightAboveRootMeters']))
    glass=[j for j in members if result['nodes'][j].get('extras',{}).get('mesh_role') in ['glass','warm_glass']]
    expected=sorted(round(z,4) for row in a['windowRowsLocalZ'] for z in row)
    for j in glass:
        zs=accessor(result,result_bin,result['meshes'][result['nodes'][j]['mesh']]['primitives'][0]['attributes']['POSITION'])[:,2]
        glass_errors.append(sorted(set(round(float(z),4) for z in zs))==expected)
checks['registeredRoofFootprintsRetained']=max(roof_errors)<.001
checks['estimatedHeightsReadBack']=max(height_errors)<.00001
checks['actualGlassHasFourOrFiveDiscreteRows']=all(glass_errors)
after={s:sha256(P/s) for s in PROTECTED};checks['protectedInputsUnchanged']=before==after
DEST.mkdir(parents=True)
ledger={'version':'v003','userStatement':'中心教学区和其他教学楼基本都是四层，楼层高；宿舍都是五层，按合适高度处理',
 'source':'USER_MESSAGE_2026_10_09','policy':'Typical type defaults confirmed by user; metre heights estimated, not measured or surveyed per building',
 'assets':rows,'unchangedTypes':unchanged,'individualExceptions':'Not independently surveyed; later per-building observations override typical defaults'}
(DEST/'storey_parameters.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2),encoding='utf-8')
def stats(d):
    live={n['mesh'] for n in d['nodes'] if 'mesh' in n}
    return {'liveMeshDefinitions':len(live),'storedMeshDefinitions':len(d['meshes']),
        'liveUniqueMeshTriangles':sum(d['accessors'][p['indices']]['count']//3 for i in live for p in d['meshes'][i]['primitives'] if p.get('mode',4)==4)}
report={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'passed':sum(checks.values()),'total':len(checks),
 'model':str(OUT.relative_to(P)),'sha256':sha256(OUT),'bytes':OUT.stat().st_size,'updatedBuildings':len(rows),
 'countsByType':dict(Counter(a['type'] for a in rows)),'before':stats(old),'after':stats(result),
 'maxRoofSymmetricDifferenceSqm':max(roof_errors),'maxHeightReadbackErrorMeters':max(height_errors),
 'preservedInputs':before,'protectedAfter':after,'formalCampusUpdated':False,'cloudUpdated':False,
 'limits':['Typical floor counts come from user, not per-building survey.','Storey heights 4.2m/3.1m and window dimensions are adjustable visual estimates.',
 'Preserved v002 ground corrections; no terrain or source building footprints changed.','Special/non-teaching buildings and unresolved types retained.']}
(DEST/'build_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['status','passed','total','updatedBuildings','countsByType','bytes','after']},ensure_ascii=False))
assert all(checks.values()),'Candidate retained for inspection; do not overwrite formal model'
