"""Map-registered presentation copies; source GLB/GIS remain protected.
v001/v002 preserve separate roofs and elevations. Explicit v003 compounds use
user-confirmed connectivity, plan-located low blocks and estimated elevations.
"""
import copy,gzip,json,math,sys
from pathlib import Path
from collections import Counter
import numpy as np
from shapely.geometry import Polygon,shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely import constrained_delaunay_triangles,set_precision
from integrate_library_v001_2 import read_glb,write_glb,sha256,descendants
from audit_campus_ground_quality import matrices,mesh_triangles,accessor
from audit_shape_review import audit
P=Path(__file__).resolve().parents[1];dorm_mode='--dormitories-v002' in sys.argv;compound_mode='--compounds-v003' in sys.argv
VERSION='v003' if compound_mode else 'v002' if dorm_mode else 'v001'
D=P/('reference/buildings/dorm_compounds_v003' if compound_mode else 'reference/buildings/dorm_shapes_v002' if dorm_mode else 'reference/buildings/shape_review_v001')
OUT=P/('output/campus_shape_review_'+VERSION+'.glb')
WORK=OUT.with_suffix('.pending.glb')
assert not OUT.exists() and not (D/'validation.json').exists(),'Keep earlier work'
protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
 'output/campus_detail_release_v004.glb','output/geojson/buildings.geojson','web/public/data/buildings.geojson']
if dorm_mode or compound_mode:protected.append('output/campus_shape_review_v001.glb')
if compound_mode:protected.append('output/campus_shape_review_v002.glb')
before={p:sha256(P/p) for p in protected}
SOURCE='output/campus_shape_review_v002.glb' if compound_mode else 'output/campus_shape_review_v001.glb' if dorm_mode else protected[2]
old,blob=read_glb(P/SOURCE);doc=copy.deepcopy(old);binary=bytearray(blob);worlds,_=matrices(old)
input_data=json.loads((D/('input.json' if compound_mode else 'corrected_input.json' if dorm_mode else 'registered_input_v002.json')).read_text(encoding='utf-8'))
if compound_mode:
    # WGS/local round-trips can leave 1e-9 m coincident-edge spurs. Normalize
    # only numerical precision (5 micrometres), not a gap-filling buffer.
    for group in input_data['groups']:group['geometryLocal']=set_precision(shape(group['geometryLocal']),.00001).__geo_interface__
    for compound in input_data['compounds']:
        for connection in compound['connections']:connection['geometry']=set_precision(shape(connection['geometry']),.00001).__geo_interface__
if dorm_mode or compound_mode:
    from audit_dorm_shapes import active_roof
    audit_rows={}
    for g in input_data['groups']:
        actual=unary_union([active_roof(old,blob,worlds,b['nodeIndices'][0]) for b in g['bindings']]);expected=shape(g['geometryLocal'])
        audit_rows[g['id']]={'id':g['id'],'name':g['name'],'symmetricDifferenceSqm':actual.symmetric_difference(expected).area}
else:audit_rows={r['id']:r for r in audit()}
rows=[];changed=set();hidden=set();changed_roots=set()
roots={n['extras']['feature_id']:i for i,n in enumerate(old['nodes']) if 'mesh' not in n and n.get('extras',{}).get('feature_id')}
def roof(i):
    members=[j for j,_ in descendants(old,i) if 'mesh' in old['nodes'][j]]
    selected=[j for j in members if old['nodes'][j].get('extras',{}).get('mesh_role')=='roof']
    polys=[];zs=[]
    for j in selected or members:
        for t in mesh_triangles(old,blob,old['nodes'][j],worlds[j]):
            p=Polygon(t[:,:2]);zs.extend(t[:,2])
            if p.is_valid and p.area>1e-6:polys.append(p)
    return unary_union(polys),zs
def append(array,kind,component,target):
    a=np.ascontiguousarray(array);binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(a.tobytes())
    view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':a.nbytes,'target':target})
    acc={'bufferView':view,'componentType':component,'count':len(a),'type':kind}
    if kind=='VEC3':acc.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
    idx=len(doc['accessors']);doc['accessors'].append(acc);return idx
def suppress(i):doc['nodes'][i].setdefault('extras',{})['shape_review_reference_only']=True;changed.add(i);hidden.add(i)
def rebuild(root_i,poly,fid,group_id,source_i=None,low_height=None):
    original_i=root_i if source_i is None else source_i
    root=doc['nodes'][root_i];oldroof,zs=roof(original_i);assert zs,'Exact source geometry required'
    children=[j for j,_ in descendants(old,original_i) if 'mesh' in old['nodes'][j]]
    roles={old['nodes'][j].get('extras',{}).get('mesh_role'):old['meshes'][old['nodes'][j]['mesh']]['primitives'][0].get('material',0) for j in children}
    fallback=old['meshes'][old['nodes'][children[0]]['mesh']]['primitives'][0].get('material',0)
    wallmat=roles.get('wall',roles.get('cream',roles.get('frame',fallback)));glassmat=roles.get('glass',wallmat)
    roofmat=roles.get('roof',wallmat);basemat=roles.get('base',wallmat)
    # Keep existing root elevation, top and type-specific storeys, not photo guesses.
    w=worlds[original_i];inv=np.linalg.inv(w);origin_z=float(w[2,3]);extras=root.setdefault('extras',{})
    mesh_origin=(inv@np.array([poly.centroid.x,poly.centroid.y,origin_z,1]))[:3]
    floor_count=extras.get('floor_count');floors=int(floor_count) if floor_count in [2,4,5] else 0
    all_z=[]
    for j in children:
        for t in mesh_triangles(old,blob,old['nodes'][j],worlds[j]):all_z.extend(t[:,2])
    bottom=min(all_z);top=max(all_z) if low_height is None else origin_z+low_height;body_bottom=max(bottom,origin_z+(.32 if floors==5 else .35 if floors in [2,4] else 0))
    roof_z=top-.25 if floors else top
    buffers={role:([],[],[]) for role in ['wall','glass','roof','base']}
    def face(role,points):
        vs=(np.c_[np.asarray(points),np.ones(len(points))]@inv.T)[:,:3]-mesh_origin
        normal=np.cross(vs[1]-vs[0],vs[2]-vs[0]);size=np.linalg.norm(normal)
        if size<1e-10:return
        normal/=size;v,n,t=buffers[role];offset=len(v);v.extend(vs.tolist());n.extend([normal.tolist()]*len(vs))
        t.extend([[offset,offset+k,offset+k+1] for k in range(1,len(vs)-1)])
    components=list(poly.geoms) if hasattr(poly,'geoms') else [poly]
    for component in components:
        component=orient(component,sign=1)
        cap=list(constrained_delaunay_triangles(component).geoms)
        assert unary_union(cap).symmetric_difference(component).area<.001,'Triangulation must retain courtyard holes'
        for t in cap:
            points=list(t.exterior.coords)[:-1]
            if not t.exterior.is_ccw:points.reverse()
            face('roof',[(x,y,roof_z) for x,y in points]);face('base',[(x,y,body_bottom) for x,y in points])
        for ring in [component.exterior,*component.interiors]:
            r=list(ring.coords)[:-1]
            for p,q in zip(r,r[1:]+r[:1]):
                p,q=np.array(p),np.array(q);delta=q-p;length=float(np.linalg.norm(delta));normal=np.array([delta[1],-delta[0]])/length
                def point(u,z,inset=0):xy=p+delta*u-normal*inset;return [float(xy[0]),float(xy[1]),z]
                def panel(u,v,lo,hi,role,inset=0):
                    if hi>lo and v-u>1e-8:face(role,[point(u,lo,inset),point(v,lo,inset),point(v,hi,inset),point(u,hi,inset)])
                panel(0,1,bottom,body_bottom,'base');panel(0,1,roof_z,top,'wall')
                if not floors or length<2.8:panel(0,1,body_bottom,roof_z,'wall');continue
                step=(roof_z-body_bottom)/floors;bays=max(1,round(length/(5.2 if floors==5 else 7)))
                for row in range(floors):
                    lo=body_bottom+row*step;hi=lo+step;wl=lo+step*.25;wh=lo+step*.72
                    for bay in range(bays):
                        u,v=bay/bays,(bay+1)/bays;left=u+(v-u)*.30;right=v-(v-u)*.30
                        panel(u,v,lo,wl,'wall');panel(u,v,wh,hi,'wall');panel(u,left,wl,wh,'wall');panel(right,v,wl,wh,'wall')
                        panel(left,right,wl,wh,'glass',.09)
    reference=copy.deepcopy(root)
    if source_i is not None:reference_children=[]
    elif 'mesh' in root:
        reference['name']=root.get('name','Shape')+'_source_reference';reference['extras']={};reference.pop('children',None)
        for key in ['matrix','translation','rotation','scale']:reference.pop(key,None)
        ref_i=len(doc['nodes']);doc['nodes'].append(reference);root.pop('mesh');reference_children=[ref_i]
    else:reference_children=root.get('children',[])[:]
    root['children']=[]
    if reference_children:
        refnode={'name':'SHAPE_ORIGINAL_REFERENCE_'+str(root_i),'children':reference_children,'extras':{'shape_review_reference_only':True}}
        ref_i=len(doc['nodes']);doc['nodes'].append(refnode);root['children']=[ref_i]
    for role,(vs,ns,ts) in buffers.items():
        if not ts:continue
        mesh=len(doc['meshes']);doc['meshes'].append({'name':'SHAPE_'+str(root_i)+'_'+role,'primitives':[{'attributes':{
            'POSITION':append(np.array(vs,dtype='<f4'),'VEC3',5126,34962),'NORMAL':append(np.array(ns,dtype='<f4'),'VEC3',5126,34962)},
            'indices':append(np.array(ts,dtype='<u4').reshape(-1),'SCALAR',5125,34963),'material':{'wall':wallmat,'glass':glassmat,'roof':roofmat,'base':basemat}[role],'mode':4}]})
        node=len(doc['nodes']);doc['nodes'].append({'name':'SHAPE_'+str(root_i)+'_'+role,'mesh':mesh,'translation':mesh_origin.tolist(),'extras':{'mesh_role':role,'feature_id':fid}});root['children'].append(node)
    extras.update(feature_id=fid,shape_review_display_id=group_id,shape_status='USER_MAP_REGISTERED_APPROXIMATE_NOT_AS_BUILT')
    changed.add(root_i);changed_roots.add(root_i)
    return {'node':root_i,'id':fid,'baseWorldZ':bottom,'topWorldZ':top,'storeysPreserved':floor_count,'area':poly.area}
for group in input_data['groups']:
    oldrow=audit_rows[group['root']]
    if oldrow['symmetricDifferenceSqm']<=.1 and not compound_mode:continue
    poly=shape(group['geometryLocal']);parts=list(poly.geoms) if hasattr(poly,'geoms') else [poly]
    bindings=group['bindings'];assert all(len(b['nodeIndices'])==1 for b in bindings),'Ambiguous binding'
    actions=[]
    if compound_mode or len(parts)==1:
        main=bindings[0]['nodeIndices'][0];oldmain,_=roof(main)
        if compound_mode or oldmain.symmetric_difference(poly).area>.1:actions.append(rebuild(main,poly,group['root'],group['root']))
        for b in bindings[1:]:suppress(b['nodeIndices'][0])
    else:
        assert len(parts)==len(bindings),'No inferred component ownership'
        remaining=parts[:]
        for b in bindings:
            i=b['nodeIndices'][0];oldpart,_=roof(i)
            target=max(remaining,key=lambda p:oldpart.intersection(p).area)
            assert oldpart.intersection(target).area>0,'Detached component cannot be assigned by a proximity guess'
            remaining.remove(target)
            if oldpart.symmetric_difference(target).area>.1:actions.append(rebuild(i,target,b['id'],group['root']))
            doc['nodes'][i].setdefault('extras',{})['shape_review_display_id']=group['root'];changed.add(i)
    main=bindings[0]['nodeIndices'][0]
    doc['nodes'][main].setdefault('extras',{}).update(shape_review_display_id=group['root'],shape_review_group_members=[b['id'] for b in bindings]);changed.add(main)
    if compound_mode:doc['nodes'][main]['extras'].update(dorm_compound_root=group['compoundRoot'],dorm_compound_members=group['compoundMembers'])
    rows.append({**oldrow,'actions':actions,'geometryLocal':group['geometryLocal']})
# A shared roof junction must not create a new overlap with unchanged D6.
neighbor=None
if input_data['neighbors']:
    d4=next(r for r in rows if r['id']=='buildings:01f4781169cdebc320a0')
    neighbor=input_data['neighbors'][0];ni=neighbor['nodeIndices'][0];np_old,_=roof(ni);np_new=shape(neighbor['geometryLocal'])
    if np_old.intersection(shape(d4['geometryLocal'])).area>.01:
        assert np_new.intersection(shape(d4['geometryLocal'])).area<.01,'Registered neighbors conflict'
        rows.append({'id':neighbor['id'],'name':'D区6号楼','geometryLocal':neighbor['geometryLocal'],'actions':[rebuild(ni,np_new,neighbor['id'],neighbor['id'])]})
doc['buffers'][0]['byteLength']=len(binary)
scene=doc['scenes'][doc.get('scene',0)];scene.setdefault('extras',{})['shape_review_version']=VERSION
low_rows=[]
if compound_mode:
    for compound in input_data['compounds']:
        host=next(g for g in input_data['groups'] if g['root']==compound['root'])['bindings'][0]['nodeIndices'][0]
        for connection in compound['connections']:
            i=len(doc['nodes']);doc['nodes'].append({'name':'DORM_CONNECTION_'+connection['key'],'matrix':worlds[host].flatten(order='F').tolist(),
                'extras':{'feature_id':compound['root'],'floor_count':2,'height_status':'PANORAMA_TYPE_ESTIMATE_NOT_SURVEYED',
                 'dorm_compound_root':compound['root'],'dorm_connection':True}})
            scene['nodes'].append(i)
            action=rebuild(i,shape(connection['geometry']),compound['root'],compound['root'],host,connection['heightMeters'])
            low_rows.append({**action,'key':connection['key'],'heightEstimateMeters':connection['heightMeters'],'geometryLocal':connection['geometry']})
    scene['extras']['dorm_compound_count']=len(input_data['compounds'])
doc['buffers'][0]['byteLength']=len(binary)
scene['extras']['shape_review_reference']='https://www.720yun.com/vr/3a8jtrevsu9 + user registered campus plan'
assert not WORK.exists(),'Inspect any interrupted pending output first'
write_glb(WORK,doc,bytes(binary));out_doc,out_bin=read_glb(WORK);out_worlds,_=matrices(out_doc)
checks={'protectedInputsUnchanged':before=={p:sha256(P/p) for p in protected},'originalBinaryPrefixExact':out_bin[:len(blob)]==blob,
 'unrelatedNodesExact':all(out_doc['nodes'][i]==node for i,node in enumerate(old['nodes']) if i not in changed),
 'allOriginalWorldTransformsExact':all(np.array_equal(w,out_worlds[i]) for i,w in worlds.items()),
 'oldMeshesMaterialsAndImagesExact':all(out_doc[k][:len(old.get(k,[]))]==old.get(k,[]) for k in ['meshes','materials','images','textures']),
 'original124RootBusinessIdsRetained':all(any(n.get('extras',{}).get('feature_id')==fid and 'mesh' not in n for n in out_doc['nodes']) for fid in roots),
 'detachedComponentsRetained':all(shape(r['geometryLocal']).geom_type==input_data['groups'][next(i for i,g in enumerate(input_data['groups']) if g['root']==r['id'])]['geometryLocal']['type'] for r in rows if not neighbor or r['id']!=neighbor['id'])}
errors=[];boundary_errors=[];area_tolerances=[]
for row in rows+low_rows:
    visible=[]
    def collect(i):
        if out_doc['nodes'][i].get('extras',{}).get('shape_review_reference_only'):return
        if 'mesh' in out_doc['nodes'][i]:
            if out_doc['nodes'][i].get('extras',{}).get('mesh_role')=='roof':
                visible.extend(Polygon(t[:,:2]) for t in mesh_triangles(out_doc,out_bin,out_doc['nodes'][i],out_worlds[i]) if Polygon(t[:,:2]).area>1e-6)
        for c in out_doc['nodes'][i].get('children',[]):collect(c)
    group=None if 'key' in row else next((g for g in input_data['groups'] if g['root']==row['id']),None)
    for binding in group['bindings'] if group else [{'nodeIndices':[row['node'] if 'key' in row else ni]}]:
        i=binding['nodeIndices'][0]
        if not out_doc['nodes'][i].get('extras',{}).get('shape_review_reference_only'):collect(i)
    # An unchanged raw main is projected without a role, for the four suppression-only scopes.
    if not visible:
        i=group['bindings'][0]['nodeIndices'][0];visible=[roof(i)[0]]
    actual_roof=unary_union(visible);expected_roof=shape(row['geometryLocal'])
    errors.append(actual_roof.symmetric_difference(expected_roof).area)
    boundary_errors.append(actual_roof.hausdorff_distance(expected_roof))
    area_tolerances.append(expected_roof.length*.0002+.001)
checks['activeRoofFootprintsWithinFloat32Tolerance']=max(boundary_errors)<.0002 and all(e<t for e,t in zip(errors,area_tolerances))
print(json.dumps([{'name':r.get('name',r.get('key')),'roofAreaErrorSqm':e,'boundaryErrorMeters':b} for r,e,b in zip(rows+low_rows,errors,boundary_errors) if b>=.0002],ensure_ascii=False))
assert all(checks.values()),checks
WORK.replace(OUT)
OUT.with_suffix('.glb.gz').write_bytes(gzip.compress(OUT.read_bytes(),compresslevel=9,mtime=0))
report={'status':'PASS','version':VERSION,'checks':checks,'sha256':sha256(OUT),'bytes':OUT.stat().st_size,'sourceHash':before[SOURCE],
 'rows':rows,'connections':low_rows,'compoundCount':len(input_data.get('compounds',[])),'changedShapeScopes':len(rows),'rebuiltBodies':len(changed_roots),'hiddenReferenceNodes':sorted(hidden),'maxRoofAreaErrorSqm':max(errors),'maxBoundaryErrorMeters':max(boundary_errors),
 'protectedInputs':before,'sourceGeometryChanged':False,'cloudUpdated':False,'limitations':['Shape-only map registration, not a surveyed model.',
 'Existing body elevations and height estimates retained; no new floor measurement.',
 '720 site aerial and teaching/living views cross-check topology; not every corrected outline has an individual full-angle photo.',
 'No original 720 textures or remote model data redistributed.']}
(D/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(D/'runtime_manifest.json').write_text(json.dumps({'sha256':report['sha256'],'scopes':len(rows),'rebuiltBodies':len(changed_roots)},indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ['status','sha256','changedShapeScopes','rebuiltBodies','maxRoofAreaErrorSqm']},ensure_ascii=False))
