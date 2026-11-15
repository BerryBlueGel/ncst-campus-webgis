"""Independent teaching facade study. Registered plans are immutable input."""
import hashlib
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector

PROJECT=Path(__file__).resolve().parents[1]
PARAMS=json.loads((PROJECT/'reference/buildings/teaching_detail_v001/parameters.json').read_text(encoding='utf-8'))
BLEND=PROJECT/'blender/teaching_detail_working_v001.blend'
GLB=PROJECT/'output/teaching_detail_preview_v001.glb'
REPORT=PROJECT/'blender/teaching_detail_v001_report.json'
VALIDATION=PROJECT/'blender/teaching_detail_v001_validation.json'
DUMP=PROJECT/'blender/teaching_detail_v001_readback_geometry.json'
PREVIEWS=PROJECT/'blender/previews/teaching_detail_v001'
for path in (BLEND,GLB,REPORT,VALIDATION,DUMP):
    if path.exists():
        raise RuntimeError(f'Refusing to overwrite {path}')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()

protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
           'web/public/data/buildings.geojson','output/geojson/buildings.geojson',
           'blender/campus_buildings_working_v007.blend','output/campus_remaining_preview_v001.glb',
           'blender/teaching_area_working_v004.blend','output/teaching_area_preview_v004.glb',
           'blender/gym_detail_working_v002.blend','output/gym_detail_preview_v002.glb',
           'blender/admin_technology_working_v002.blend','output/admin_technology_preview_v002.glb',
           *PARAMS['sourceFileHashes'].keys()]
before={p:digest(PROJECT/p) for p in protected}
assert before['output/campus_refined_v005.glb']=='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
assert all(before[p]==h for p,h in PARAMS['sourceFileHashes'].items())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'output/campus_refined_v005.glb'))
bpy.context.view_layer.update()

# glTF importer preserves original names; Three.js public paths are uniquified.
raw_paths=[
    'Area_02/TPX_Buildings/TPX_Buildings_8','Area_04/TPX_Buildings/TPX_Buildings_35',
    'Area_01/TPX_Buildings/TPX_Buildings_65','Area_03/TPX_Buildings/TPX_Buildings_48',
    'Area_01/TPX_Buildings/TPX_Buildings_54','Area_03/TPX_Buildings/TPX_Buildings_49',
    'Area_01/TPX_Buildings/TPX_Buildings_53','Area_03/TPX_Buildings/TPX_Buildings_50',
    'Area_04/TPX_Buildings/TPX_Buildings_33','Area_04/TPX_Buildings/TPX_Buildings_34',
    'Area_01/TPX_Buildings/TPX_Buildings_66']

def find_source(path):
    parts=path.split('/')
    node=bpy.data.objects.get(parts[0])
    for name in parts[1:]:
        node=next((c for c in node.children if c.name.split('.')[0]==name),None) if node else None
    if node is None:
        raise RuntimeError(f'Missing source {path}')
    return node

keep=set()
references={}
source_heights={}
for binding,path in zip(PARAMS['independentReferences'],raw_paths):
    node=find_source(path)
    nodes=[node,*node.children_recursive]
    references[binding['id']]={'publicModelPath':binding['path'],'blenderSourcePath':path,
        'nodes':[o.name for o in nodes],'matrices':{o.name:[list(row) for row in o.matrix_world] for o in nodes}}
    points=[o.matrix_world@v.co for o in nodes if o.type=='MESH' for v in o.data.vertices]
    source_heights[binding['id']]=max(p.y for p in points)-min(p.y for p in points)
    keep.update(nodes)
    ancestor=node.parent
    while ancestor:
        keep.add(ancestor)
        ancestor=ancestor.parent
    for obj in nodes:
        obj.hide_render=True
        obj.hide_set(True)
        obj.display_type='WIRE'
        obj['reference_only']=True
        obj['source_feature_id']=binding['id']
ground={}
for a in PARAMS['assets']:
    cx,cn=a['centerEastNorth']
    samples={}
    for label,dx,dn in [('center',0,0),('north',0,25),('south',0,-25),('east',25,0),('west',-25,0)]:
        origin=Vector((cx+dx,-500,cn+dn))
        direction=Vector((0,1,0))
        hits=[]
        for obj in bpy.data.objects:
            if obj.type!='MESH' or 'TPX_Ground' not in obj.name:
                continue
            inv=obj.matrix_world.inverted()
            hit,loc,normal,index=obj.ray_cast(inv@origin,(inv.to_3x3()@direction).normalized(),distance=2000)
            if hit:
                world=obj.matrix_world@loc
                hits.append({'world':list(world),'elevationMeters':-world.y,'distance':(world-origin).length,'object':obj.name})
        samples[label]=min(hits,key=lambda h:h['distance']) if hits else None
    assert all(samples.values()),f"Missing Ground for {a['name']}"
    ground[a['id']]=samples
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj,do_unlink=True)
collection=bpy.data.collections.new('TEACHING_DETAIL_V001_GROUP_STYLE_HEIGHT_PLACEHOLDER')
bpy.context.scene.collection.children.link(collection)

# Preserve the exact existing Ground-draped connection surfaces. No raised bridges.
old_objects=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'output/teaching_area_preview_v004.glb'))
bpy.context.view_layer.update()
imported=set(bpy.data.objects)-old_objects
connections=[]
connection_geometry={}
for obj in imported:
    if obj.type=='MESH' and obj.name.startswith('plan-connection-'):
        matrix=obj.matrix_world.copy()
        obj.parent=None
        obj.matrix_world=matrix
        collection.objects.link(obj)
        obj['geometry_status']='EXISTING_GROUND_REFERENCE_NOT_RAISED_BRIDGE'
        obj['not_building_height']=True
        connections.append(obj)
        connection_geometry[obj.name]=[list(obj.matrix_world@v.co) for v in obj.data.vertices]
assert len(connections)==2
for obj in imported:
    if obj not in connections:
        bpy.data.objects.remove(obj,do_unlink=True)

def material(name,color,metallic=0,roughness=.65):
    mat=bpy.data.materials.new(name)
    mat.diffuse_color=(*color,1)
    mat.use_nodes=True
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value=(*color,1)
    bsdf.inputs['Metallic'].default_value=metallic
    bsdf.inputs['Roughness'].default_value=roughness
    return mat

mats={'cream':material('TCH_PaleFrame',(.79,.74,.63)),
      'warm_glass':material('TCH_WarmGroupGlazing',(.22,.10,.055),.35,.25),
      'glass':material('TCH_CourtyardGlazing',(.12,.23,.26),.25,.28),
      'mullion':material('TCH_DarkFineMullions',(.06,.055,.05),.15),
      'roof':material('TCH_ThinRoof',(.39,.42,.40)),
      'base':material('TCH_ConcreteBase',(.57,.58,.54))}
roots=[]
meshes=[]
asset_reports=[]

def area(r):
    return sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r))/2

for a in PARAMS['assets']:
    key=a['block']
    fid=a['id']
    cx,cn=a['centerEastNorth']
    base=ground[fid]['center']['elevationMeters']-.05
    root=bpy.data.objects.new(f'TCH_{key}_FacadeStudy',None)
    collection.objects.link(root)
    root.location=(cx,-base,cn)
    root['feature_id']=fid
    root['building_name']=a['name']
    root['height_status']=a['heightStatus']
    root['height_m']=6.0
    root['floor_count_status']='UNKNOWN'
    root['source_model_path']=a['modelPath']
    root['individual_photo_binding']=a['individualFacadeBindingStatus']
    root['geometry_status']=PARAMS['status']
    roots.append(root)
    buffers={name:([],[]) for name in mats}
    def add(mat,verts,faces):
        v,f=buffers[mat]
        offset=len(v)
        v.extend(verts)
        f.extend(tuple(offset+i for i in face) for face in faces)
    def quad(mat,verts):
        add(mat,verts,[(0,1,2,3)])
    def rings(geometry):
        for i,r in enumerate(geometry['coordinates']):
            points=[(x-cx,n-cn) for x,n in r[:-1]]
            # Outer CCW, holes CW: right-side normal always points out of building.
            if (area(points)>0)!=(i==0):
                points.reverse()
            yield points
    def walls(geometry,lo,hi,mat):
        for ring in rings(geometry):
            for i,p in enumerate(ring):
                q=ring[(i+1)%len(ring)]
                quad(mat,[(p[0],p[1],lo),(q[0],q[1],lo),(q[0],q[1],hi),(p[0],p[1],hi)])
    def caps(triangles,h,mat):
        for triangle in triangles:
            add(mat,[(x-cx,n-cn,h) for x,n in triangle],[(0,1,2)])
    bottom=min(s['elevationMeters'] for s in ground[fid].values())-base-.12
    walls(a['geometry'],bottom,.35,'base')
    caps(a['roofTrianglesEastNorth'],.35,'base')
    caps(a['roofTrianglesEastNorth'],5.76,'roof')
    frame=a['parapetGeometry']
    parts=frame['coordinates'] if frame['type']=='MultiPolygon' else [frame['coordinates']]
    for part in parts:
        walls({'coordinates':part},5.72,6.0,'cream')
    caps(a['parapetTrianglesEastNorth'],6.0,'cream')
    panel_count=0
    primary_edges=0
    for ring_index,ring in enumerate(rings(a['geometry'])):
        for i,p in enumerate(ring):
            q=ring[(i+1)%len(ring)]
            d=Vector(q)-Vector(p)
            length=d.length
            if length<.001:
                continue
            normal=Vector((d.y,-d.x)).normalized()
            primary=ring_index==0 and length>12 and (normal.x>.9 if a['axisFacingDirection']=='EAST' else normal.x<-.9)
            primary_edges+=int(primary)
            def panel(u,v,lo,hi,inset,mat):
                s=Vector(p)+d*u-normal*inset
                t=Vector(p)+d*v-normal*inset
                quad(mat,[(s.x,s.y,lo),(t.x,t.y,lo),(t.x,t.y,hi),(s.x,s.y,hi)])
            margin=min(.7,length/6)/length
            # No wall behind panes: actual shallow recess, no coplanar overlay.
            panel(0,margin,.35,5.72,0,'cream')
            panel(1-margin,1,.35,5.72,0,'cream')
            panel(margin,1-margin,.35,.72,0,'cream')
            panel(margin,1-margin,5.30,5.72,0,'cream')
            pane_mat='warm_glass' if primary else 'glass'
            panel(margin,1-margin,.72,5.30,.18,pane_mat)
            # Proportional grid is illustrative facade rhythm, NOT storey count.
            for h in (2.20,3.72):
                panel(margin,1-margin,h,h+.12,.035,'cream')
            bays=max(1,round(length/(2.2 if primary else 3.8)))
            for j in range(1,bays):
                u=j/bays
                if margin<u<1-margin:
                    panel(u,min(1-margin,u+.055/length),.72,5.30,.12,'mullion')
                    panel_count+=1
            for h in (1.44,2.98,4.50):
                panel(margin,1-margin,h,h+.035,.12,'mullion')
            for u in (margin,1-margin):
                s=Vector(p)+d*u
                t=s-normal*.18
                quad('cream',[(s.x,s.y,.72),(t.x,t.y,.72),(t.x,t.y,5.30),(s.x,s.y,5.30)])
            for h in (.72,5.30):
                s=Vector(p)+d*margin
                t=Vector(p)+d*(1-margin)
                quad('cream',[(s.x,s.y,h),(t.x,t.y,h),(t.x-normal.x*.18,t.y-normal.y*.18,h),(s.x-normal.x*.18,s.y-normal.y*.18,h)])
    objects=[]
    for mat,(verts,faces) in buffers.items():
        if not faces:
            continue
        data=bpy.data.meshes.new(f'TCH_{key}_{mat}')
        data.from_pydata([(x,-h,n) for x,n,h in verts],[],faces)
        data.update()
        bm=bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        data.materials.append(mats[mat])
        obj=bpy.data.objects.new(data.name,data)
        collection.objects.link(obj)
        obj.parent=root
        obj['feature_id']=fid
        obj['mesh_role']=mat
        objects.append(obj)
        data.calc_loop_triangles()
    bpy.context.view_layer.update()
    positions=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    meshes.extend(objects)
    asset_reports.append({'id':fid,'name':a['name'],'block':key,'rootBlender':list(root.location),
        'rootName':root.name,'geometry':a['geometry'],'heightMeters':6.0,'heightStatus':a['heightStatus'],
        'floorCount':None,'sourceHeightMeters':source_heights[fid],
        'individualFacadeBindingStatus':a['individualFacadeBindingStatus'],
        'courtyardHoleCount':a['courtyardHoleCount'],'groundProbes':ground[fid],
        'workingBaseElevationMeters':base,'foundationBottomRelativeMeters':bottom,
        'meshCount':len(objects),'triangleCount':sum(len(o.data.loop_triangles) for o in objects),
        'fineMullionCountNotFloorCount':panel_count,'illustrativeAxisFacingEdges':primary_edges,
        'boundsBlender':{'min':[min(p[i] for p in positions) for i in range(3)],'max':[max(p[i] for p in positions) for i in range(3)]}})

bpy.ops.object.select_all(action='DESELECT')
for obj in roots+meshes+connections:
    obj.select_set(True)
bpy.context.view_layer.objects.active=roots[0]
bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)

# Neutral review floor is not exported. Courtyard floors remain unroofed.
scene=bpy.context.scene
data=bpy.data.meshes.new('TCH_ReviewFloor')
data.from_pydata([(780,.4,620),(1190,.4,620),(1190,.4,1160),(780,.4,1160)],[],[(0,1,2,3)])
plane=bpy.data.objects.new(data.name,data)
scene.collection.objects.link(plane)
plane['review_only']=True
data.materials.append(mats['base'])
scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x,scene.render.resolution_y=1200,900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world=bpy.data.worlds.new('TCH_Daylight')
scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
bg.inputs[0].default_value=(.70,.83,.95,1)
bg.inputs[1].default_value=.7
scene.view_settings.view_transform='AgX'
light=bpy.data.lights.new('TCH_Sun','SUN')
light.energy=3
sun=bpy.data.objects.new(light.name,light)
scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(30),math.radians(-25),math.radians(-25))
cam_data=bpy.data.cameras.new('TCH_ReviewCamera')
cam=bpy.data.objects.new(cam_data.name,cam_data)
scene.collection.objects.link(cam)
cam_data.type='ORTHO'
cam_data.clip_end=3000
scene.camera=cam
PREVIEWS.mkdir(parents=True,exist_ok=True)

def render(name,x,n,dx,dn,height,scale):
    target=Vector((x,-3,n))
    cam.location=(x+dx,-height,n+dn)
    forward=(target-cam.location).normalized()
    up=Vector((0,-1,0))
    if abs(forward.dot(up))>.99:
        up=Vector((0,0,1))
    right=forward.cross(up).normalized()
    cam.rotation_euler=Matrix((right,right.cross(forward).normalized(),-forward)).transposed().to_euler()
    cam_data.ortho_scale=scale
    scene.render.filepath=str(PREVIEWS/name)
    bpy.ops.render.render(write_still=True)

for a in asset_reports:
    x,y,n=a['rootBlender']
    render(f"{a['block'].lower()}_oblique.png",x,n,100,-100,100,155)
xs=[x for a in PARAMS['assets'] for x,n in a['geometry']['coordinates'][0]]
ns=[n for a in PARAMS['assets'] for x,n in a['geometry']['coordinates'][0]]
cx,cn=(min(xs)+max(xs))/2,(min(ns)+max(ns))/2
render('all_top.png',cx,cn,0,0,650,650)
render('all_oblique.png',cx,cn,260,-430,440,630)
scene['axis_convention']='BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'
scene['height_status']='6M_SOURCE_PLACEHOLDER_NOT_MEASURED'
scene['new_entrances']=False
scene['new_raised_connectors']=False
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
for o in connections:
    o.data.calc_loop_triangles()
report={'version':'v001','status':PARAMS['status'],'assets':asset_reports,'sourceReferences':references,
    'meshes':len(meshes)+len(connections),'triangles':sum(a['triangleCount'] for a in asset_reports)+sum(len(o.data.loop_triangles) for o in connections),
    'teachingMeshes':len(meshes),'connectionMeshes':len(connections),
    'glbBytes':GLB.stat().st_size,'glbSha256':digest(GLB),
    'protectedBefore':before,'protectedAfter':{p:digest(PROJECT/p) for p in protected},
    'previews':[p.relative_to(PROJECT).as_posix() for p in sorted(PREVIEWS.glob('*.png'))],
    'publicWebsiteUpdated':False,'cloudUpdated':False,'formalCampusUpdated':False,
    'limitations':['6m is retained rough-model height, NOT as-built height. Floor counts remain null.',
        'Facade vocabulary comes from a group photo; individual axis-facing assignments are illustrative.',
        'No surveyed entrance, individual elevation or new raised connector is claimed.',
        'Fragments 054/150/151 remain independent hidden references; their ownership is unresolved.']}
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
checks={'workingBlendReadable':all(bpy.data.objects.get(a['rootName']) for a in asset_reports),
    'protectedFilesUnchanged':before==report['protectedAfter'],
    'eightStableIds':len({a['id'] for a in asset_reports})==8,
    'sixClosedCourtyardsTwoOpen':sum(a['courtyardHoleCount'] for a in asset_reports)==6 and len([a for a in asset_reports if not a['courtyardHoleCount']])==2,
    'fortyGroundHits':sum(bool(h) for probes in ground.values() for h in probes.values())==40,
    'sourceRoughHeightNotInvented':all(abs(a['sourceHeightMeters']-6)<.01 and a['floorCount'] is None for a in asset_reports),
    'elevenSourceReferencesHidden':len(references)==11 and all(bpy.data.objects[n].hide_render and bpy.data.objects[n].hide_get() for r in references.values() for n in r['nodes']),
    'sourceReferenceMatricesPreserved':all(max(abs(bpy.data.objects[n].matrix_world[i][j]-matrix[i][j]) for i in range(4) for j in range(4))<1e-6 for r in references.values() for n,matrix in r['matrices'].items()),
    'twoOriginalGroundMarkersRetained':all(max(abs((bpy.data.objects[name].matrix_world@bpy.data.objects[name].data.vertices[i].co)[j]-p[j]) for j in range(3))<1e-6 for name,verts in connection_geometry.items() for i,p in enumerate(verts)),
    'tenPreviews':len(report['previews'])==10,'triangleBudget':report['triangles']<15000}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
bpy.context.view_layer.update()
exported=[o for o in bpy.data.objects if o.type=='MESH']
exported_roots=[o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')]
checks['glbMeshCountStable']=len(exported)==report['meshes']
checks['eightExportedRoots']=len(exported_roots)==8
checks['sourceAndReviewExcluded']=all(o.name.startswith(('TCH_','plan-connection-')) for o in exported)
checks['noSourceReferenceMetadataExported']=not any(o.get('reference_only') for o in bpy.data.objects)
dump={'roofs':{},'allProjectedTriangles':{},'connectionVertices':{}}
for a in asset_reports:
    fid=a['id']
    root=next((o for o in exported_roots if o.get('feature_id')==fid),None)
    checks[f"{a['block']}_RootStable"]=root is not None and max(abs(root.matrix_world.translation[i]-a['rootBlender'][i]) for i in range(3))<.0002
    objects=[o for o in exported if o.get('feature_id')==fid]
    points=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
    checks[f"{a['block']}_HeightStillSixMetres"]=abs(-min(p.y for p in points)-a['workingBaseElevationMeters']-6)<.0002
    checks[f"{a['block']}_BoundsStable"]=max(abs(min(p[i] for p in points)-a['boundsBlender']['min'][i]) for i in range(3))<.0002 and max(abs(max(p[i] for p in points)-a['boundsBlender']['max'][i]) for i in range(3))<.0002
    triangles=[]
    alltri=[]
    for o in objects:
        o.data.calc_loop_triangles()
        for t in o.data.loop_triangles:
            vs=[o.matrix_world@o.data.vertices[i].co for i in t.vertices]
            projection=[[v.x,v.z] for v in vs]
            alltri.append(projection)
            if o.get('mesh_role')=='roof':
                triangles.append(projection)
    dump['roofs'][fid]=triangles
    dump['allProjectedTriangles'][fid]=alltri
for o in exported:
    if o.name.startswith('plan-connection-'):
        dump['connectionVertices'][o.name]=[list(o.matrix_world@v.co) for v in o.data.vertices]
checks['twoGroundMarkersExported']=len(dump['connectionVertices'])==2
def point_distance(p,q):
    return math.sqrt(sum((p[j]-q[j])**2 for j in range(3)))
checks['groundMarkerVerticesUnchangedAfterExport']=all(name in dump['connectionVertices'] and
    max(min(point_distance(p,q) for q in dump['connectionVertices'][name]) for p in verts)<.0002 and
    max(min(point_distance(q,p) for p in verts) for q in dump['connectionVertices'][name])<.0002
    for name,verts in connection_geometry.items())
DUMP.write_text(json.dumps(dump,ensure_ascii=False),encoding='utf-8')
validation={'version':'v001','status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,'note':'Technical readback only. Independent geometry audit checks actual exported roofs against registered polygons.'}
VALIDATION.write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'report':str(REPORT),'validation':validation,'meshes':report['meshes'],'triangles':report['triangles']},ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Readback failed; preserve artifacts for inspection')
