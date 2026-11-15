"""Independent residential type study. No official/public asset replacement."""
import hashlib
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector

PROJECT = Path(__file__).resolve().parents[1]
PARAMS = json.loads((PROJECT/'reference/buildings/residential_detail_v001/parameters.json').read_text(encoding='utf-8'))
BLEND = PROJECT/'blender/residential_detail_working_v001.blend'
GLB = PROJECT/'output/residential_detail_preview_v001.glb'
REPORT = PROJECT/'blender/residential_detail_v001_report.json'
VALIDATION = PROJECT/'blender/residential_detail_v001_validation.json'
DUMP = PROJECT/'blender/residential_detail_v001_readback_geometry.json'
PREVIEWS = PROJECT/'blender/previews/residential_detail_v001'
for path in (BLEND, GLB, REPORT, VALIDATION, DUMP):
    if path.exists():
        raise RuntimeError(f'Refusing to overwrite {path}')
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()
protected = ['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
    'web/public/data/buildings.geojson','output/geojson/buildings.geojson',
    'blender/campus_buildings_working_v007.blend','output/campus_remaining_preview_v001.glb',
    'output/residential_area_preview_v004.glb',
    'blender/teaching_area_working_v004.blend','output/teaching_area_preview_v004.glb',
    'blender/gym_detail_working_v002.blend','output/gym_detail_preview_v002.glb',
    'blender/admin_technology_working_v002.blend','output/admin_technology_preview_v002.glb',
    'blender/teaching_detail_working_v001.blend','output/teaching_detail_preview_v001.glb',
    *PARAMS['sourceFileHashes'].keys()]
before = {p:digest(PROJECT/p) for p in protected}
assert before['output/campus_refined_v005.glb'] == '7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
assert all(before[p] == h for p,h in PARAMS['sourceFileHashes'].items())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'output/campus_refined_v005.glb'))
bpy.context.view_layer.update()
def find_source(path):
    parts = path.split('/')
    node = bpy.data.objects.get(parts[0])
    for name in parts[1:]:
        node = next((c for c in node.children if c.name.split('.')[0] == name), None) if node else None
    if node is None:
        raise RuntimeError(f'Missing source {path}')
    return node
keep = set()
references = {}
source_heights = {}
for binding in PARAMS['independentReferences']:
    node = find_source(binding['modelPath'])
    nodes = [node, *node.children_recursive]
    references[binding['id']] = {'blenderSourcePath':binding['modelPath'],
        'nodes':[o.name for o in nodes], 'matrices':{o.name:[list(row) for row in o.matrix_world] for o in nodes}}
    points = [o.matrix_world@v.co for o in nodes if o.type == 'MESH' for v in o.data.vertices]
    source_heights[binding['id']] = max(p.y for p in points)-min(p.y for p in points)
    keep.update(nodes)
    ancestor = node.parent
    while ancestor:
        keep.add(ancestor)
        ancestor = ancestor.parent
    for obj in nodes:
        obj.hide_render = True
        obj.hide_set(True)
        obj.display_type = 'WIRE'
        obj['reference_only'] = True
        obj['source_feature_id'] = binding['id']
ground = {}
ground_objects = [o for o in bpy.data.objects if o.type == 'MESH' and 'TPX_Ground' in o.name]
for a in PARAMS['assets']:
    cx,cn = a['centerEastNorth']
    coords = a['geometry']['coordinates'][0]
    dx = min(20, (max(p[0] for p in coords)-min(p[0] for p in coords))/4)
    dn = min(20, (max(p[1] for p in coords)-min(p[1] for p in coords))/4)
    samples = {}
    for label,ox,on in [('center',0,0),('north',0,dn),('south',0,-dn),('east',dx,0),('west',-dx,0)]:
        origin = Vector((cx+ox,-500,cn+on))
        direction = Vector((0,1,0))
        hits = []
        for obj in ground_objects:
            inv = obj.matrix_world.inverted()
            hit,loc,normal,index = obj.ray_cast(inv@origin,(inv.to_3x3()@direction).normalized(),distance=2000)
            if hit:
                world = obj.matrix_world@loc
                hits.append({'world':list(world),'elevationMeters':-world.y,'distance':(world-origin).length,'object':obj.name})
        samples[label] = min(hits,key=lambda h:h['distance']) if hits else None
    assert all(samples.values()), f"Missing Ground for {a['name']}"
    ground[a['id']] = samples
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj,do_unlink=True)
collection = bpy.data.collections.new('RESIDENTIAL_DETAIL_V001_ILLUSTRATIVE_HEIGHT_PLACEHOLDER')
bpy.context.scene.collection.children.link(collection)
district_collections = {}
for district in ['梅园','兰园','竹园','菊园']:
    c = bpy.data.collections.new(district)
    collection.children.link(c)
    district_collections[district] = c
def material(name,color,metallic=0,roughness=.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color,1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat
mats = {'wall':material('LIFE_PaleWall_Illustrative',(.77,.76,.69)),
        'frame':material('LIFE_LightTrim',(.87,.86,.77)),
        'glass':material('LIFE_BlueGreyWindow',(.13,.25,.30),.25,.28),
        'roof':material('LIFE_Roof',(.40,.44,.45)),
        'base':material('LIFE_ConcreteBase',(.57,.59,.58)),
        'mullion':material('LIFE_DarkWindowFrame',(.15,.18,.18),.1)}
roots,meshes,asset_reports = [],[],[]
def area(r):
    return sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r))/2
for a in PARAMS['assets']:
    key,fid = a['key'],a['id']
    cx,cn = a['centerEastNorth']
    height = a['heightMeters']
    base = ground[fid]['center']['elevationMeters']-.05
    c = district_collections[a['district']]
    root = bpy.data.objects.new(f'LIFE_{key}_{a["role"]}',None)
    c.objects.link(root)
    root.location = (cx,-base,cn)
    for k,v in {'feature_id':fid,'building_name':a['name'],'district':a['district'],
                'height_status':a['heightStatus'],'height_m':height,'floor_count_status':'UNKNOWN',
                'source_model_path':a['modelPath'],'individual_photo_binding':a['individualFacadeBindingStatus'],
                'geometry_status':PARAMS['status'],'facade_role':a['role']}.items():
        root[k] = v
    roots.append(root)
    buffers = {name:([],[]) for name in mats}
    def add(mat,verts,faces):
        vs,fs = buffers[mat]
        offset = len(vs)
        vs.extend(verts)
        fs.extend(tuple(offset+i for i in face) for face in faces)
    def quad(mat,verts):
        add(mat,verts,[(0,1,2,3)])
    def rings(geometry):
        for i,r in enumerate(geometry['coordinates']):
            points = [(x-cx,n-cn) for x,n in r[:-1]]
            if (area(points)>0) != (i==0):
                points.reverse()
            yield points
    def walls(geometry,lo,hi,mat):
        for ring in rings(geometry):
            for i,p in enumerate(ring):
                q = ring[(i+1)%len(ring)]
                quad(mat,[(p[0],p[1],lo),(q[0],q[1],lo),(q[0],q[1],hi),(p[0],p[1],hi)])
    def caps(triangles,h,mat):
        for t in triangles:
            add(mat,[(x-cx,n-cn,h) for x,n in t],[(0,1,2)])
    bottom = min(s['elevationMeters'] for s in ground[fid].values())-base-.12
    walls(a['geometry'],bottom,.32,'base')
    caps(a['roofTrianglesEastNorth'],.32,'base')
    caps(a['roofTrianglesEastNorth'],height-.25,'roof')
    frame = a['parapetGeometry']
    parts = frame['coordinates'] if frame['type'] == 'MultiPolygon' else [frame['coordinates']]
    for part in parts:
        walls({'coordinates':part},height-.28,height,'frame')
    caps(a['parapetTrianglesEastNorth'],height,'frame')
    windows = 0
    for ring in rings(a['geometry']):
        for i,p in enumerate(ring):
            q = ring[(i+1)%len(ring)]
            d = Vector(q)-Vector(p)
            length = d.length
            if length < .001:
                continue
            normal = Vector((d.y,-d.x)).normalized()
            def point(u,h,inset=0):
                t = Vector(p)+d*u-normal*inset
                return (t.x,t.y,h)
            def panel(u,v,lo,hi,inset,mat):
                if v-u > 1e-8 and hi-lo > 1e-8:
                    quad(mat,[point(u,lo,inset),point(v,lo,inset),point(v,hi,inset),point(u,hi,inset)])
            if length < 2.8:
                panel(0,1,.32,height-.28,0,'wall')
                continue
            if a['role'] == 'dining':
                margin = min(.75,length/5)/length
                panel(0,margin,.32,height-.28,0,'wall')
                panel(1-margin,1,.32,height-.28,0,'wall')
                panel(margin,1-margin,.32,.9,0,'wall')
                panel(margin,1-margin,height-.65,height-.28,0,'frame')
                lo,hi = .9,height-.65
                panel(margin,1-margin,lo,hi,.12,'glass')
                for u in [margin,1-margin]:
                    quad('frame',[point(u,lo),point(u,lo,.12),point(u,hi,.12),point(u,hi)])
                for h in [lo,hi]:
                    quad('frame',[point(margin,h),point(1-margin,h),point(1-margin,h,.12),point(margin,h,.12)])
                panel(margin,1-margin,height*.49,height*.49+.15,.025,'frame')
                bays = max(1,round(length/3.8))
                for j in range(1,bays):
                    u = j/bays
                    if margin<u<1-margin:
                        panel(u,min(1-margin,u+.065/length),lo,hi,.07,'mullion')
                windows += bays
            else:
                # Two proportional visual bands, NOT floor/storey information.
                bays = max(1,round(length/(5.2 if a['role']=='dormitory' else 6.5)))
                for j in range(bays):
                    u,v = j/bays,(j+1)/bays
                    left,right = u+(v-u)*.30,v-(v-u)*.30
                    levels = [.95,height*.55,height-.28]
                    for row in range(2):
                        low = .32 if row==0 else height*.49
                        high = height*.49 if row==0 else height-.28
                        wl = low+(high-low)*.22
                        wh = low+(high-low)*.76
                        panel(u,v,low,wl,0,'wall')
                        panel(u,v,wh,high,0,'wall')
                        panel(u,left,wl,wh,0,'wall')
                        panel(right,v,wl,wh,0,'wall')
                        panel(left,right,wl,wh,.09,'glass')
                        for edge in [left,right]:
                            quad('frame',[point(edge,wl),point(edge,wl,.09),point(edge,wh,.09),point(edge,wh)])
                        for h in [wl,wh]:
                            quad('frame',[point(left,h),point(right,h),point(right,h,.09),point(left,h,.09)])
                        middle = (left+right)/2
                        panel(middle,middle+.045/length,wl,wh,.06,'mullion')
                        windows += 1
    objects = []
    for mat,(verts,faces) in buffers.items():
        if not faces:
            continue
        data = bpy.data.meshes.new(f'LIFE_{key}_{mat}')
        data.from_pydata([(x,-h,n) for x,n,h in verts],[],faces)
        data.update()
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        data.materials.append(mats[mat])
        obj = bpy.data.objects.new(data.name,data)
        c.objects.link(obj)
        obj.parent = root
        obj['feature_id'] = fid
        obj['mesh_role'] = mat
        objects.append(obj)
        data.calc_loop_triangles()
    bpy.context.view_layer.update()
    positions = [o.matrix_world@v.co for o in objects for v in o.data.vertices]
    meshes.extend(objects)
    asset_reports.append({'id':fid,'name':a['name'],'key':key,'district':a['district'],'role':a['role'],
        'rootName':root.name,'rootBlender':list(root.location),'geometry':a['geometry'],
        'heightMeters':height,'heightStatus':a['heightStatus'],'floorCount':None,
        'sourceHeightMeters':source_heights[fid],'groundProbes':ground[fid],
        'workingBaseElevationMeters':base,'foundationBottomRelativeMeters':bottom,
        'individualFacadeBindingStatus':a['individualFacadeBindingStatus'],
        'meshCount':len(objects),'triangleCount':sum(len(o.data.loop_triangles) for o in objects),
        'illustrativeWindowPanelsNotMeasured':windows,
        'boundsBlender':{'min':[min(p[i] for p in positions) for i in range(3)],
                         'max':[max(p[i] for p in positions) for i in range(3)]}})
bpy.ops.object.select_all(action='DESELECT')
for obj in roots+meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = roots[0]
bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
scene = bpy.context.scene
data = bpy.data.meshes.new('LIFE_ReviewFloor')
data.from_pydata([(200,4,400),(1850,4,400),(1850,4,1500),(200,4,1500)],[],[(0,1,2,3)])
plane = bpy.data.objects.new(data.name,data)
scene.collection.objects.link(plane)
plane['review_only'] = True
data.materials.append(mats['base'])
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x,scene.render.resolution_y = 1200,900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('LIFE_Daylight')
scene.world.use_nodes = True
bg = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs[0].default_value = (.70,.83,.95,1)
bg.inputs[1].default_value = .7
scene.view_settings.view_transform = 'AgX'
light = bpy.data.lights.new('LIFE_Sun','SUN')
light.energy = 3
sun = bpy.data.objects.new(light.name,light)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(30),math.radians(-25),math.radians(-25))
cam_data = bpy.data.cameras.new('LIFE_ReviewCamera')
cam = bpy.data.objects.new(cam_data.name,cam_data)
scene.collection.objects.link(cam)
cam_data.type = 'ORTHO'
cam_data.clip_end = 4000
scene.camera = cam
PREVIEWS.mkdir(parents=True,exist_ok=True)
def render(name,x,n,dx,dn,height,scale):
    target = Vector((x,-3,n))
    cam.location = (x+dx,-height,n+dn)
    forward = (target-cam.location).normalized()
    up = Vector((0,-1,0))
    if abs(forward.dot(up))>.99:
        up = Vector((0,0,1))
    right = forward.cross(up).normalized()
    cam.rotation_euler = Matrix((right,right.cross(forward).normalized(),-forward)).transposed().to_euler()
    cam_data.ortho_scale = scale
    scene.render.filepath = str(PREVIEWS/name)
    bpy.ops.render.render(write_still=True)
for district,slug in [('梅园','mei'),('兰园','lan'),('竹园','zhu'),('菊园','ju')]:
    group = [a for a in PARAMS['assets'] if a['district']==district]
    xs = [p[0] for a in group for p in a['geometry']['coordinates'][0]]
    ns = [p[1] for a in group for p in a['geometry']['coordinates'][0]]
    cx,cn = (min(xs)+max(xs))/2,(min(ns)+max(ns))/2
    scale = max((max(xs)-min(xs))*1.12,(max(ns)-min(ns))*1.5)
    render(f'{slug}_top.png',cx,cn,0,0,600,scale)
    render(f'{slug}_oblique.png',cx,cn,130,-200,230,scale)
    dining = next(a for a in group if a['role']=='dining')
    x,n = dining['centerEastNorth']
    render(f'{slug}_dining.png',x,n,100,-110,80,160)
    dorm = next(a for a in group if a['role']=='dormitory')
    x,n = dorm['centerEastNorth']
    render(f'{slug}_dorm.png',x,n,70,-90,60,105)
scene['axis_convention'] = PARAMS['axisConvention']
scene['height_status'] = '6M_SOURCE_PLACEHOLDER_NOT_MEASURED'
scene['new_entrances'] = False
scene['new_raised_connectors'] = False
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
report = {'version':'v001','status':PARAMS['status'],'assets':asset_reports,'sourceReferences':references,
    'meshes':len(meshes),'triangles':sum(a['triangleCount'] for a in asset_reports),
    'glbBytes':GLB.stat().st_size,'glbSha256':digest(GLB),
    'protectedBefore':before,'protectedAfter':{p:digest(PROJECT/p) for p in protected},
    'previews':[p.relative_to(PROJECT).as_posix() for p in sorted(PREVIEWS.glob('*.png'))],
    'publicWebsiteUpdated':False,'cloudUpdated':False,'formalCampusUpdated':False,
    'limitations':['Source heights retained, approximately 6m. NOT measured; floor counts null.',
        'Punched windows are illustrative type vocabulary, not individual facade reconstruction.',
        'Dining frame/glazing reference not bound to each dining hall elevation.',
        'No surveyed entrances, balconies or bridges added. 5 excluded references remain independent.']}
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
checks = {'workingBlendReadable':all(bpy.data.objects.get(a['rootName']) for a in asset_reports),
    'protectedFilesUnchanged':before==report['protectedAfter'],
    'sixtyOneStableIds':len({a['id'] for a in asset_reports})==61,
    'roleCounts53Dorm4Dining4Centres':{r:sum(a['role']==r for a in asset_reports) for r in ['dormitory','dining','centre']}=={'dormitory':53,'dining':4,'centre':4},
    'threeHundredFiveGroundHits':sum(bool(h) for probes in ground.values() for h in probes.values())==305,
    'sourceRoughHeightNotInvented':all(abs(a['sourceHeightMeters']-a['heightMeters'])<.01 and a['floorCount'] is None for a in asset_reports),
    'sixtySixSourceReferencesHidden':len(references)==66 and all(bpy.data.objects[n].hide_render and bpy.data.objects[n].hide_get() for r in references.values() for n in r['nodes']),
    'sourceReferenceMatricesPreserved':all(max(abs(bpy.data.objects[n].matrix_world[i][j]-matrix[i][j]) for i in range(4) for j in range(4))<1e-6 for r in references.values() for n,matrix in r['matrices'].items()),
    'sixteenPreviews':len(report['previews'])==16,'triangleBudget':report['triangles']<100000}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
bpy.context.view_layer.update()
exported = [o for o in bpy.data.objects if o.type=='MESH']
exported_roots = [o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')]
checks['glbMeshCountStable'] = len(exported)==report['meshes']
checks['sixtyOneExportedRoots'] = len(exported_roots)==61
checks['sourceAndReviewExcluded'] = all(o.name.startswith('LIFE_') for o in exported)
checks['noSourceReferenceMetadataExported'] = not any(o.get('reference_only') for o in bpy.data.objects)
checks['fiveExcludedIdsNotExported'] = not set(PARAMS['excludedDetailIds']).intersection(o.get('feature_id') for o in exported_roots)
dump = {'roofs':{},'allProjectedTriangles':{}}
for a in asset_reports:
    fid = a['id']
    root = next((o for o in exported_roots if o.get('feature_id')==fid),None)
    checks[f"{a['key']}_RootStable"] = root is not None and max(abs(root.matrix_world.translation[i]-a['rootBlender'][i]) for i in range(3))<.0002
    objects = [o for o in exported if o.get('feature_id')==fid]
    points = [o.matrix_world@v.co for o in objects for v in o.data.vertices]
    checks[f"{a['key']}_HeightRetained"] = abs(-min(p.y for p in points)-a['workingBaseElevationMeters']-a['heightMeters'])<.0002
    checks[f"{a['key']}_BoundsStable"] = max(abs(min(p[i] for p in points)-a['boundsBlender']['min'][i]) for i in range(3))<.0002 and max(abs(max(p[i] for p in points)-a['boundsBlender']['max'][i]) for i in range(3))<.0002
    roof,alltri = [],[]
    for o in objects:
        o.data.calc_loop_triangles()
        for t in o.data.loop_triangles:
            vs = [o.matrix_world@o.data.vertices[i].co for i in t.vertices]
            projection = [[v.x,v.z] for v in vs]
            alltri.append(projection)
            if o.get('mesh_role')=='roof':
                roof.append(projection)
    dump['roofs'][fid] = roof
    dump['allProjectedTriangles'][fid] = alltri
DUMP.write_text(json.dumps(dump,ensure_ascii=False),encoding='utf-8')
validation = {'version':'v001','status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
              'note':'Technical readback, not measured height/as-built facade acceptance.'}
VALIDATION.write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':validation['status'],'passed':validation['passed'],'total':validation['total'],
                  'meshes':report['meshes'],'triangles':report['triangles']},ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Readback failed; preserve artifacts for inspection')
