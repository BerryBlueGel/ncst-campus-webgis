"""Non-destructive illustrative detailing of all remaining reviewed building bodies."""
import json,hashlib,math
from pathlib import Path
import bpy,bmesh
from mathutils import Vector,Matrix
P=Path(__file__).resolve().parents[1]
D=P/'reference/buildings/other_areas_detail_v001'
params=json.loads((D/'parameters.json').read_text(encoding='utf-8'))
blend=P/'blender/other_areas_detail_working_v001.blend'
glb=P/'output/other_areas_detail_preview_v001.glb'
reportfile=P/'blender/other_areas_detail_v001_report.json'
validationfile=P/'blender/other_areas_detail_v001_validation.json'
dumpfile=P/'blender/other_areas_detail_v001_readback_geometry.json'
previews=P/'blender/previews/other_areas_detail_v001'
for f in [blend,glb,reportfile,validationfile,dumpfile]:
    if f.exists(): raise RuntimeError(f'Existing version: {f}')
def sha(f): return hashlib.sha256(f.read_bytes()).hexdigest().upper()
protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
 'web/public/data/buildings.geojson','output/geojson/buildings.geojson','blender/campus_buildings_working_v007.blend',
 'blender/residential_detail_working_v001.blend','output/residential_detail_preview_v001.glb',
 'output/teaching_detail_preview_v001.glb','output/gym_detail_preview_v002.glb','output/admin_technology_preview_v002.glb',
 *params['sourceFileHashes']]
before={f:sha(P/f) for f in protected}
assert before['output/campus_refined_v005.glb']=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
assert all(before[f]==h for f,h in params['sourceFileHashes'].items())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(P/'output/campus_refined_v005.glb'))
bpy.context.view_layer.update()
def source(path):
    parts=path.split('/'); o=bpy.data.objects.get(parts[0])
    for part in parts[1:]: o=next((c for c in o.children if c.name.split('.')[0]==part),None) if o else None
    if o is None: raise RuntimeError(f'Missing source {path}')
    return o
def keep_ancestors(o):
    while o: keep.add(o); o=o.parent
keep=set(); refs={}; heights={}
for a in params['assets']:
    o=source(a['modelPath']); nodes=[o,*o.children_recursive]
    refs[a['id']]={n.name:[list(row) for row in n.matrix_world] for n in nodes}
    pts=[n.matrix_world@v.co for n in nodes if n.type=='MESH' for v in n.data.vertices]
    heights[a['id']]=max(v.y for v in pts)-min(v.y for v in pts)
    for n in nodes:
        keep_ancestors(n); n.hide_render=True; n.hide_set(True); n.display_type='WIRE'; n['reference_only']=True
groundobjs=[o for o in bpy.data.objects if o.type=='MESH' and 'TPX_Ground' in o.name]
for o in groundobjs: keep_ancestors(o); o['review_ground_only']=True
ground={}
def components(g): return g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
for a in params['assets']:
    x,n=a['centerEastNorth']; points=[p for c in components(a['geometry']) for p in c[0]]
    dx=min(20,(max(p[0] for p in points)-min(p[0] for p in points))/4)
    dn=min(20,(max(p[1] for p in points)-min(p[1] for p in points))/4); samples={}
    for label,ex,en in [('center',0,0),('north',0,dn),('south',0,-dn),('east',dx,0),('west',-dx,0)]:
        origin=Vector((x+ex,-500,n+en)); hits=[]
        for o in groundobjs:
            inv=o.matrix_world.inverted(); hit,loc,normal,index=o.ray_cast(inv@origin,(inv.to_3x3()@Vector((0,1,0))).normalized(),distance=2000)
            if hit:
                v=o.matrix_world@loc; hits.append({'world':list(v),'elevationMeters':-v.y,'distance':(v-origin).length,'object':o.name})
        samples[label]=min(hits,key=lambda h:h['distance']) if hits else None
    assert all(samples.values()),a['name']
    ground[a['id']]=samples
for o in list(bpy.data.objects):
    if o not in keep: bpy.data.objects.remove(o,do_unlink=True)
collection=bpy.data.collections.new('OTHER_AREAS_DETAIL_ILLUSTRATIVE_NOT_AS_BUILT'); bpy.context.scene.collection.children.link(collection)
groups={}
for group in 'ABCD':
    c=bpy.data.collections.new(group+'_AREA_DETAIL'); collection.children.link(c); groups[group]=c
def mat(name,color,metal=0):
    m=bpy.data.materials.new('OTHER_'+name); m.diffuse_color=(*color,1); m.use_nodes=True
    b=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Metallic'].default_value=metal; b.inputs['Roughness'].default_value=.4 if metal else .7
    return m
mats={'wall':mat('PaleWall',(.77,.77,.71)),'frame':mat('LightFrame',(.88,.89,.84)),
 'glass':mat('BlueGreyGlass',(.12,.26,.32),.2),'roof':mat('Roof',(.38,.44,.47)),
 'base':mat('Concrete',(.55,.58,.58))}
roots=[]; meshes=[]; reports=[]
def signed(r): return sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r))/2
for a in params['assets']:
    fid=a['id']; x,n=a['centerEastNorth']; height=a['heightMeters']; base=ground[fid]['center']['elevationMeters']-.05
    root=bpy.data.objects.new('OTHER_'+a['key']+'_'+a['role'],None); groups[a['district']].objects.link(root); root.location=(x,-base,n)
    for k,v in {'feature_id':fid,'building_name':a['name'],'source_model_path':a['modelPath'],'district':a['district'],
      'height_status':a['heightStatus'],'height_m':height,'floor_count_status':'UNKNOWN','facade_role':a['role'],
      'geometry_status':params['status'],'individual_photo_binding':'UNVERIFIED'}.items(): root[k]=v
    roots.append(root); buffers={m:([],[]) for m in mats}; panels=0
    def add(m,vs,fs):
        vertices,faces=buffers[m]; offset=len(vertices); vertices.extend(vs); faces.extend(tuple(i+offset for i in f) for f in fs)
    def quad(m,vs): add(m,vs,[(0,1,2,3)])
    def rings(g):
        for c in components(g):
            for i,r in enumerate(c):
                ring=[(p[0]-x,p[1]-n) for p in r[:-1]]
                if (signed(ring)>0)!=(i==0): ring.reverse()
                yield ring
    def walls(g,lo,hi,m):
        for r in rings(g):
            for i,p in enumerate(r):
                q=r[(i+1)%len(r)]; quad(m,[(p[0],p[1],lo),(q[0],q[1],lo),(q[0],q[1],hi),(p[0],p[1],hi)])
    def caps(ts,h,m):
        for t in ts: add(m,[(p[0]-x,p[1]-n,h) for p in t],[(0,1,2)])
    bottom=min(s['elevationMeters'] for s in ground[fid].values())-base-.12
    walls(a['geometry'],bottom,.3,'base'); caps(a['roofTrianglesEastNorth'],.3,'base')
    caps(a['roofTrianglesEastNorth'],height-.24,'roof')
    walls(a['parapetGeometry'],height-.26,height,'frame'); caps(a['parapetTrianglesEastNorth'],height,'frame')
    for r in rings(a['geometry']):
        for i,p in enumerate(r):
            q=r[(i+1)%len(r)]; d=Vector(q)-Vector(p); length=d.length
            if length<.001: continue
            normal=Vector((d.y,-d.x)).normalized()
            def point(u,h,inset=0):
                v=Vector(p)+d*u-normal*inset; return(v.x,v.y,h)
            def panel(u,v,lo,hi,m='wall',inset=0):
                if v>u and hi>lo: quad(m,[point(u,lo,inset),point(v,lo,inset),point(v,hi,inset),point(u,hi,inset)])
            if a['role'] in ['roof_fragment','unbound_body'] or length<3:
                panel(0,1,.3,height-.26); continue
            # A single proportional band is deliberately not a claimed storey/floor count.
            margin=min(.8,length/5)/length; lo=height*(.24 if a['role']=='public_hall' else .30); hi=height*.76
            panel(0,1,.3,lo); panel(0,1,hi,height-.26)
            panel(0,margin,lo,hi); panel(1-margin,1,lo,hi)
            bays=max(1,round(length/(7 if a['role']=='academic' else 9)))
            for j in range(bays):
                u=margin+(1-2*margin)*j/bays; v=margin+(1-2*margin)*(j+1)/bays
                pier=min(.18/length,(v-u)/5); panel(u,u+pier,lo,hi,'frame'); panel(v-pier,v,lo,hi,'frame')
                panel(u+pier,v-pier,lo,hi,'glass',.10); panels+=1
                for e in [u+pier,v-pier]: quad('frame',[point(e,lo),point(e,lo,.1),point(e,hi,.1),point(e,hi)])
                for h in [lo,hi]: quad('frame',[point(u+pier,h),point(v-pier,h),point(v-pier,h,.1),point(u+pier,h,.1)])
    objects=[]
    for role,(vs,fs) in buffers.items():
        if not fs: continue
        data=bpy.data.meshes.new('OTHER_'+a['key']+'_'+role); data.from_pydata([(e,-h,no) for e,no,h in vs],[],fs); data.update()
        bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
        data.materials.append(mats[role]); data.calc_loop_triangles(); o=bpy.data.objects.new(data.name,data)
        groups[a['district']].objects.link(o); o.parent=root; o['feature_id']=fid; o['mesh_role']=role; meshes.append(o); objects.append(o)
    bpy.context.view_layer.update(); pts=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    reports.append({**a,'rootName':root.name,'rootBlender':list(root.location),'workingBaseElevationMeters':base,
      'sourceHeightMeters':heights[fid],'groundProbes':ground[fid],'illustrativeWindowPanels':panels,
      'meshCount':len(objects),'triangleCount':sum(len(o.data.loop_triangles) for o in objects),
      'boundsBlender':{'min':[min(p[i] for p in pts) for i in range(3)],'max':[max(p[i] for p in pts) for i in range(3)]}})
bpy.ops.object.select_all(action='DESELECT')
for o in roots+meshes: o.select_set(True)
bpy.context.view_layer.objects.active=roots[0]
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True)
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE_NEXT'; scene.render.resolution_x=1200; scene.render.resolution_y=900
scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'
scene.eevee.taa_render_samples=16; scene.world=bpy.data.worlds.new('OTHER_Daylight'); scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND'); bg.inputs[0].default_value=(.7,.83,.95,1); bg.inputs[1].default_value=.7
light=bpy.data.lights.new('OTHER_Sun','SUN'); light.energy=3; sun=bpy.data.objects.new(light.name,light); scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(30),math.radians(-25),math.radians(-25))
camdata=bpy.data.cameras.new('OTHER_ReviewCamera'); cam=bpy.data.objects.new(camdata.name,camdata); scene.collection.objects.link(cam)
camdata.type='ORTHO'; camdata.clip_end=4000; scene.camera=cam; previews.mkdir(parents=True,exist_ok=True)
def render(name,x,n,dx,dn,h,scale):
    target=Vector((x,-3,n)); cam.location=(x+dx,-h,n+dn); forward=(target-cam.location).normalized(); up=Vector((0,-1,0))
    if abs(forward.dot(up))>.99: up=Vector((0,0,1))
    right=forward.cross(up).normalized(); cam.rotation_euler=Matrix((right,right.cross(forward).normalized(),-forward)).transposed().to_euler()
    camdata.ortho_scale=scale; scene.render.filepath=str(previews/name); bpy.ops.render.render(write_still=True)
for group in 'ABCD':
    pts=[p for a in params['assets'] if a['district']==group for c in components(a['geometry']) for p in c[0]]
    x=(min(p[0] for p in pts)+max(p[0] for p in pts))/2; n=(min(p[1] for p in pts)+max(p[1] for p in pts))/2
    scale=max((max(p[0] for p in pts)-min(p[0] for p in pts))*1.15,(max(p[1] for p in pts)-min(p[1] for p in pts))*1.5)
    render(group.lower()+'_top.png',x,n,0,0,650,scale); render(group.lower()+'_oblique.png',x,n,150,-220,240,scale)
for key in ['013','165','059','004']:
    a=next(a for a in params['assets'] if a['key']==key); x,n=a['centerEastNorth']; pts=[p for c in components(a['geometry']) for p in c[0]]
    scale=max(max(p[0] for p in pts)-min(p[0] for p in pts),1.3*(max(p[1] for p in pts)-min(p[1] for p in pts)))+30
    render('body_'+key+'.png',x,n,80,-100,90,scale)
scene['status']=params['status']; bpy.context.preferences.filepaths.save_version=0; bpy.ops.wm.save_as_mainfile(filepath=str(blend))
report={'status':params['status'],'assets':reports,'sourceReferences':refs,'meshes':len(meshes),
 'triangles':sum(a['triangleCount'] for a in reports),'glbBytes':glb.stat().st_size,'glbSha256':sha(glb),
 'protectedBefore':before,'protectedAfter':{f:sha(P/f) for f in protected},'formalCampusUpdated':False,'cloudUpdated':False,
 'previews':[f.relative_to(P).as_posix() for f in sorted(previews.glob('*.png'))]}
reportfile.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.open_mainfile(filepath=str(blend)); checks={
 '52RootsSaved':all(bpy.data.objects.get(a['rootName']) for a in reports),'protectedUnchanged':before==report['protectedAfter'],
 '260GroundHits':sum(bool(h) for probes in ground.values() for h in probes.values())==260,
 '52SourceReferencesHidden':len(refs)==52 and all(bpy.data.objects[n].hide_render and bpy.data.objects[n].hide_get() for r in refs.values() for n in r),
 'sourceMatricesUnchanged':all(max(abs(bpy.data.objects[n].matrix_world[i][j]-m[i][j]) for i in range(4) for j in range(4))<1e-6 for r in refs.values() for n,m in r.items()),
 'sourceHeightsRetained':all(abs(a['heightMeters']-a['sourceHeightMeters'])<.01 and a['floorCount'] is None for a in reports),
 'noUnverifiedWindows':all(a['illustrativeWindowPanels']==0 for a in reports if a['role'] in ['roof_fragment','unbound_body']),
 '12Previews':len(report['previews'])==12,'triangleBudget':report['triangles']<60000}
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=str(glb)); bpy.context.view_layer.update()
exported=[o for o in bpy.data.objects if o.type=='MESH']; eroots=[o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')]
checks['52ExportedRoots']=len(eroots)==52; checks['meshCountStable']=len(exported)==report['meshes']; checks['noReviewExport']=all(o.name.startswith('OTHER_') for o in exported)
dump={'roofs':{},'allProjectedTriangles':{}}
for a in reports:
    fid=a['id']; root=next((o for o in eroots if o.get('feature_id')==fid),None); objects=[o for o in exported if o.get('feature_id')==fid]
    pts=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    checks[a['key']+'_root']=root is not None and max(abs(root.matrix_world.translation[i]-a['rootBlender'][i]) for i in range(3))<.0002
    checks[a['key']+'_height']=abs(-min(p.y for p in pts)-a['workingBaseElevationMeters']-a['heightMeters'])<.0002
    checks[a['key']+'_bounds']=max(abs(min(p[i] for p in pts)-a['boundsBlender']['min'][i]) for i in range(3))<.0002 and max(abs(max(p[i] for p in pts)-a['boundsBlender']['max'][i]) for i in range(3))<.0002
    roof=[]; alltri=[]
    for o in objects:
        o.data.calc_loop_triangles()
        for t in o.data.loop_triangles:
            vs=[o.matrix_world@o.data.vertices[i].co for i in t.vertices]; projected=[[v.x,v.z] for v in vs]; alltri.append(projected)
            if o.get('mesh_role')=='roof': roof.append(projected)
    dump['roofs'][fid]=roof; dump['allProjectedTriangles'][fid]=alltri
dumpfile.write_text(json.dumps(dump,ensure_ascii=False),encoding='utf-8')
validation={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
 'limitation':'Technical readback and type study; NOT surveyed/as-built facade or height acceptance.'}
validationfile.write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps({k:validation[k] for k in ['status','passed','total']}))
if not all(checks.values()): raise RuntimeError('Readback failed')
