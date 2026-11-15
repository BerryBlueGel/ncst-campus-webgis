"""Independent, photo-informed gym prototype. Never changes baseline or GIS data.

Run with Blender background. All unmeasured sectional/elevation choices are
declared provisional in the parameter file and in the resulting report.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

PROJECT = Path(__file__).resolve().parents[1]
VERSION = sys.argv[sys.argv.index('--version')+1] if '--version' in sys.argv else 'v001'
if VERSION not in ('v001','v002'):
    raise RuntimeError('Only explicitly named work versions supported')
PARAMS = json.loads((PROJECT / 'reference/buildings/detail_research_v001/gym_detail_parameters.json').read_text(encoding='utf-8'))
RECORD = next(r for r in json.loads((PROJECT / 'reference/buildings/remaining_batch_v001.json').read_text(encoding='utf-8'))['records'] if r['id'] == PARAMS['featureId'])
BLEND = PROJECT / f'blender/gym_detail_working_{VERSION}.blend'
GLB = PROJECT / f'output/gym_detail_preview_{VERSION}.glb'
REPORT = PROJECT / f'blender/gym_detail_{VERSION}_report.json'
VALIDATION = PROJECT / f'blender/gym_detail_{VERSION}_validation.json'
PREVIEWS = PROJECT / f'blender/previews/gym_detail_{VERSION}'
for path in (BLEND, GLB, REPORT, VALIDATION):
    if path.exists():
        raise RuntimeError(f'Refusing to overwrite any previous result: {path}')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()

protected = {p.relative_to(PROJECT).as_posix(): digest(p) for p in [
    PROJECT / 'output/campus_refined_v005.glb',
    PROJECT / 'web/public/models/campus_refined_v005.glb',
    PROJECT / 'web/public/data/buildings.geojson',
    PROJECT / 'output/geojson/buildings.geojson',
    PROJECT / 'blender/campus_buildings_working_v007.blend',
    PROJECT / 'output/campus_remaining_preview_v001.glb',
]}
if protected['output/campus_refined_v005.glb'] != '7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65':
    raise RuntimeError('Unexpected formal baseline')

ring = RECORD['geometryLocal']['coordinates'][0][:-1]
cx = sum(p[0] for p in ring) / len(ring)
cn = sum(p[1] for p in ring) / len(ring)
area = abs(sum(ring[i][0] * ring[(i+1)%len(ring)][1] - ring[(i+1)%len(ring)][0] * ring[i][1] for i in range(len(ring)))) / 2
points = [(x-cx, n-cn) for x,n in ring]
xx = sum(x*x for x,n in points)
nn = sum(n*n for x,n in points)
xn = sum(x*n for x,n in points)
theta = 0.5 * math.atan2(2*xn, xx-nn)
long_axis = Vector((math.cos(theta), math.sin(theta)))
if long_axis.y < 0:
    long_axis.negate()
cross_axis = Vector((long_axis.y, -long_axis.x))
along = [Vector(p).dot(long_axis) for p in points]
across = [Vector(p).dot(cross_axis) for p in points]
bmin, bmax = min(along), max(along)
radius = max(abs(v) for v in across)
HEIGHT = PARAMS['bodyHeightMeters']
BASE = RECORD['sourceBaseElevationMeters']
SOURCE_BASE = BASE

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT / 'output/campus_refined_v005.glb'))
bpy.context.view_layer.update()

# Probe only authoritative Ground, do not silently reassign the source base.
ground_probes = {}
for label,dx,dn in [('center',0,0),('north',0,45),('south',0,-45),('east',18,0),('west',-18,0)]:
    origin = Vector((cx+dx,-500,cn+dn))
    direction = Vector((0,1,0))
    hits = []
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or 'TPX_Ground' not in obj.name:
            continue
        inverse = obj.matrix_world.inverted()
        hit,location,normal,index = obj.ray_cast(inverse @ origin, (inverse.to_3x3() @ direction).normalized(), distance=2000)
        if hit:
            world = obj.matrix_world @ location
            hits.append({'world': list(world), 'elevationMeters': -world.y, 'distance': (world-origin).length, 'object': obj.name})
    ground_probes[label] = min(hits, key=lambda h:h['distance']) if hits else None

if VERSION == 'v002':
    if not all(ground_probes.values()):
        raise RuntimeError('All five Ground probes required before vertical work adjustment')
    BASE = ground_probes['center']['elevationMeters']-0.05
foundation_bottom = min(h['elevationMeters'] for h in ground_probes.values() if h)-BASE-0.10 if VERSION == 'v002' else 0

# Preserve original source in the work file as hidden wire reference.
node = bpy.data.objects.get('Area_03')
for part in ['TPX_Buildings','TPX_Buildings_14']:
    node = next((child for child in node.children if child.name.split('.')[0] == part), None) if node else None
if not node:
    raise RuntimeError('Exact gym source hierarchy missing')
source_reference = bpy.data.collections.new('SOURCE_GYM_099_UNCHANGED_REFERENCE_ONLY')
bpy.context.scene.collection.children.link(source_reference)
source_nodes = [node, *node.children_recursive]
source_ancestors = []
ancestor = node.parent
while ancestor:
    source_ancestors.append(ancestor)
    ancestor = ancestor.parent
for obj in source_nodes:
    source_reference.objects.link(obj)
    obj.hide_render = True
    obj.hide_set(True)
    obj.display_type = 'WIRE'
    obj['reference_only'] = True
    obj['source_path'] = RECORD['sourceModelPath']
for obj in list(bpy.data.objects):
    if obj not in source_nodes and obj not in source_ancestors:
        bpy.data.objects.remove(obj, do_unlink=True)

collection = bpy.data.collections.new(f'GYM_DETAIL_{VERSION.upper()}_PHOTO_INFORMED_PROVISIONAL')
bpy.context.scene.collection.children.link(collection)
root = bpy.data.objects.new(f'Gym_099_Detail_Work_{VERSION}', None)
collection.objects.link(root)
root.location = (cx, -BASE, cn)
root['feature_id'] = PARAMS['featureId']
root['height_m'] = HEIGHT
root['source_height_m'] = RECORD['sourceBodyHeightMeters']
root['height_status'] = PARAMS['heightEvidence']['status']
root['geometry_status'] = PARAMS['status']
root['do_not_publish_as_surveyed'] = True

def material(name,color,metallic=0,roughness=0.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    bsdf = next(node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color,1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

mats = {
    'shell': material('GYM_BlueGray_MetalShell',(0.22,0.34,0.48),0.55,0.42),
    'wall': material('GYM_WarmOchre_Wall',(0.52,0.34,0.19),0.1),
    'glass': material('GYM_DarkBlue_Glass',(0.08,0.22,0.3),0.35,0.3),
    'trim': material('GYM_Pale_EntranceTrim',(0.65,0.72,0.75),0.2),
    'shadow': material('GYM_Recess_Shadow',(0.055,0.09,0.13)),
    'base': material('GYM_Concrete_Plinth',(0.45,0.47,0.46)),
}
asset_objects = []

def mesh(name,verts,faces,mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x,-h,n) for x,n,h in verts],[],faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name,data)
    collection.objects.link(obj)
    obj.parent = root
    data.materials.append(mat)
    obj['feature_id'] = PARAMS['featureId']
    obj['detail_geometry_status'] = 'PROVISIONAL_PHOTO_INFORMED'
    asset_objects.append(obj)
    return obj

def band(name,outline,low,high,mat):
    count = len(outline)
    verts = [(x,n,low(x,n) if callable(low) else low) for x,n in outline] + [(x,n,high(x,n) if callable(high) else high) for x,n in outline]
    faces = [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return mesh(name,verts,faces,mat)

def roof_h(x,n):
    # Folded fan surrogate, NOT an extracted measured roof section.
    a = Vector((x,n)).dot(cross_axis)
    b = Vector((x,n)).dot(long_axis)
    return HEIGHT - 2.1*abs(a)/radius - 0.65*abs(b)/(max(abs(bmin),abs(bmax)))

inner = [(x*(1-0.55/math.hypot(x,n)),n*(1-0.55/math.hypot(x,n))) for x,n in points]
band('GYM_GlassPlinth',inner,0.35,3.3,mats['glass'])
band('GYM_WarmWall',inner,3.3,lambda x,n:roof_h(x,n)-0.3,mats['wall'])
band('GYM_ConcreteBase',points,foundation_bottom,0.35,mats['base'])
decorator = [(x*(1+0.025/math.hypot(x,n)),n*(1+0.025/math.hypot(x,n))) for x,n in inner]
band('GYM_EntranceLintel',decorator,3.28,3.55,mats['trim'])
band('GYM_RoofFascia',points,lambda x,n:roof_h(x,n)-0.8,roof_h,mats['shell'])
roof_verts = [(0,0,HEIGHT)] + [(x,n,roof_h(x,n)) for x,n in points]
mesh('GYM_FoldedRoof_Approximate',roof_verts,[(0,i+1,(i+1)%len(points)+1) for i in range(len(points))],mats['shell'])

# Two low-cost slit-window bands. Exact lengths and levels are provisional.
for level in [7.2,13.0]:
    band(f'GYM_SlitWindowBand_{level}',decorator,level,level+0.55,mats['shadow'])
for level in [5,9,11,15,17]:
    band(f'GYM_HorizontalWallJoint_{level}',decorator,level,level+0.08,mats['trim'])

# Mullions follow each curved/faceted wall; consolidated into one mesh.
verts,faces = [],[]
for i,p in enumerate(decorator):
    q = decorator[(i+1)%len(decorator)]
    length = math.dist(p,q)
    count = max(1,math.ceil(length/5.5))
    for j in range(count):
        u = j/count
        u2 = min(1,u+0.13/length)
        a = (p[0]+u*(q[0]-p[0]),p[1]+u*(q[1]-p[1]))
        b = (p[0]+u2*(q[0]-p[0]),p[1]+u2*(q[1]-p[1]))
        idx = len(verts)
        verts += [(a[0],a[1],0.35),(b[0],b[1],0.35),(b[0],b[1],3.3),(a[0],a[1],3.3)]
        faces.append((idx,idx+1,idx+2,idx+3))
mesh('GYM_EntranceMullions',verts,faces,mats['trim'])

# Blue wrapping band with real skipped opening cells and inset reveals.
# Side/spacing are provisional because the photos lack calibrated azimuth.
panels,panel_faces,reveals,reveal_faces = [],[],[],[]
opening_count = 0
for i,p in enumerate(points):
    q = points[(i+1)%len(points)]
    mid = Vector(((p[0]+q[0])/2,(p[1]+q[1])/2))
    if mid.dot(cross_axis) > -radius*0.18:
        continue
    length = math.dist(p,q)
    count = max(1,math.ceil(length/6.5))
    for j in range(count):
        a = Vector(p).lerp(Vector(q),j/count)
        b = Vector(p).lerp(Vector(q),(j+1)/count)
        for k in range(10):
            t0,t1 = k/10,(k+1)/10
            def lower(pt):
                t = (pt.dot(long_axis)-bmin)/(bmax-bmin)
                return 0.8+18.5*t
            ah0 = lower(a)+(roof_h(*a)-lower(a))*t0
            ah1 = lower(a)+(roof_h(*a)-lower(a))*t1
            bh0 = lower(b)+(roof_h(*b)-lower(b))*t0
            bh1 = lower(b)+(roof_h(*b)-lower(b))*t1
            cell = [(a.x,a.y,ah0),(b.x,b.y,bh0),(b.x,b.y,bh1),(a.x,a.y,ah1)]
            opening = k in (2,5,8) and j%2 == 0 and min(ah1-ah0,bh1-bh0)>1.1
            if opening:
                opening_count += 1
                center = (a+b)*0.5
                inward = -center.normalized()*0.5
                idx = len(reveals)
                reveals += cell + [(x+inward.x,n+inward.y,h) for x,n,h in cell]
                reveal_faces += [(idx+t,idx+(t+1)%4,idx+(t+1)%4+4,idx+t+4) for t in range(4)]
                reveal_faces.append((idx+4,idx+5,idx+6,idx+7))
            else:
                idx = len(panels)
                panels += cell
                panel_faces.append((idx,idx+1,idx+2,idx+3))
mesh('GYM_DiagonalBlueWrap_ProvisionalWest',panels,panel_faces,mats['shell'])
mesh('GYM_DeepRectangularRecesses_Illustrative',reveals,reveal_faces,mats['shadow'])

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
root.select_set(True)
for obj in asset_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)

if VERSION == 'v002':
    # Neutral plane for studio review only; never exported or counted as asset.
    plane = mesh('Review_GroundPlane', [(-125,-125,0),(125,-125,0),(125,125,0),(-125,125,0)],[(0,1,2,3)],mats['base'])
    asset_objects.remove(plane)
    del plane['feature_id']
    plane['review_only_not_authoritative_ground'] = True

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x,scene.render.resolution_y = 1200,900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('Gym_Review_Daylight')
scene.world.use_nodes = True
background = next(node for node in scene.world.node_tree.nodes if node.type == 'BACKGROUND')
background.inputs[0].default_value = (0.72,0.82,0.94,1)
background.inputs[1].default_value = 0.7
scene.view_settings.view_transform = 'AgX'
light_data = bpy.data.lights.new('Gym_Review_Sun','SUN')
light_data.energy = 3
sun = bpy.data.objects.new('Gym_Review_Sun',light_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(30),math.radians(-25),math.radians(-25))
camera_data = bpy.data.cameras.new('Gym_Review_Camera')
camera = bpy.data.objects.new('Gym_Review_Camera',camera_data)
scene.collection.objects.link(camera)
camera_data.type = 'ORTHO'
camera_data.clip_end = 3000
scene.camera = camera
PREVIEWS.mkdir(parents=True,exist_ok=True)

def render(name,dx,dn,height,scale):
    camera.location = (cx+dx,-BASE-height,cn+dn)
    target = Vector((cx,-BASE-10,cn))
    forward = (target-camera.location).normalized()
    up = Vector((0,-1,0))
    if abs(forward.dot(up))>0.99:
        up = Vector((0,0,1))
    right = forward.cross(up).normalized()
    camera.rotation_euler = Matrix((right,right.cross(forward).normalized(),-forward)).transposed().to_euler()
    camera_data.ortho_scale = scale
    scene.render.filepath = str(PREVIEWS/name)
    bpy.ops.render.render(write_still=True)

render('top.png',0,0,250,220)
render('southwest_oblique.png',-170,-160,95,200)
render('west_elevation.png',-240,0,30,175)
render('northeast_oblique.png',160,170,90,200)
scene['geometry_status'] = PARAMS['status']
scene['axis_convention'] = 'BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'
scene['formal_model_unchanged'] = True
scene['literature_height_not_surveyed'] = 22.8
scene['source_base_elevation_retained_in_reference'] = SOURCE_BASE
scene['working_base_elevation'] = BASE
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

for obj in asset_objects:
    obj.data.calc_loop_triangles()
triangles = sum(len(obj.data.loop_triangles) for obj in asset_objects)
positions = [obj.matrix_world @ Vector(v) for obj in asset_objects for v in obj.bound_box]
bounds = {'min': [min(p[i] for p in positions) for i in range(3)], 'max':[max(p[i] for p in positions) for i in range(3)]}
report = {
    'version':VERSION, 'status':PARAMS['status'], 'featureId':PARAMS['featureId'],
    'sourcePath':RECORD['sourceModelPath'], 'rootBlender':list(root.location),
    'sourceBodyHeightMeters':RECORD['sourceBodyHeightMeters'], 'targetPublishedHeightMeters':HEIGHT,
    'sourceBaseElevationMeters':SOURCE_BASE, 'workingBaseElevationMeters':BASE,
    'basePolicy':'SOURCE_BASE_RETAINED_GROUND_CHECK_ONLY' if VERSION=='v001' else 'WORK_ROOT_CENTER_GROUND_MINUS_0_05_SOURCE_REFERENCE_UNCHANGED',
    'foundationBottomRelativeMeters':foundation_bottom,
    'workingVerticalAdjustmentMeters':BASE-SOURCE_BASE,
    'groundProbes':ground_probes,
    'registeredPlanAreaSqm':area, 'publishedBaseAreaSqm':6111.4,
    'areaDifferencePercent':(area/6111.4-1)*100,
    'footprintPolicy':'REGISTERED_PLAN_UNCHANGED_NO_FIT_TO_PUBLISHED_AREA',
    'dimensionsBlender':[bounds['max'][i]-bounds['min'][i] for i in range(3)],
    'boundsBlender':bounds, 'meshes':len(asset_objects), 'triangles':triangles, 'materials':len(mats),
    'illustrativeShellOpeningCount':opening_count,
    'provisionalParameters':PARAMS['provisionalParameters'],
    'originalSourceNodesRetained':len(source_nodes),
    'previewBytes':GLB.stat().st_size, 'previewSha256':digest(GLB),
    'protectedBefore':protected,
    'protectedAfter':{name:digest(PROJECT/name) for name in protected},
    'previews':[str(p.relative_to(PROJECT)) for p in sorted(PREVIEWS.glob('*.png'))],
    'publicWebsiteUpdated':False, 'cloudUpdated':False,
    'limitations':['Roof fan planes are a provisional silhouette, not calibrated structural geometry.','West wrap assignment, window layout and rear elevation are unmeasured.','6m source height and source base are preserved in reference; the v002 independent root is grounded separately.','Five Ground samples do not constitute a surveyed foundation design.','Plan base area is schematic and is not rescaled to the engineering article.'],
}
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

# Read back actual saved Blender and exported GLB in independent scenes.
root_name = root.name
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
read_root = bpy.data.objects.get(root_name)
blend_meshes = [o for o in bpy.data.objects if o.name.startswith('GYM_') and o.type=='MESH']
source_retained = bpy.data.collections.get('SOURCE_GYM_099_UNCHANGED_REFERENCE_ONLY')
checks = {
    'blendReadable':read_root is not None,
    'sourceReferenceRetained':source_retained is not None and len(source_retained.objects)==len(source_nodes),
    'blendMeshCount':len(blend_meshes)==len(asset_objects),
    'heightAboveWorkingBase22_8':abs(-bounds['min'][1]-BASE-22.8)<0.0001,
    'baselineAndGisUnchanged':report['protectedBefore']==report['protectedAfter'],
    'allFiveGroundProbesHit':all(ground_probes.values()),
    'triangleBudget':triangles<6000,
    'sourceIdRetained':read_root.get('feature_id')==PARAMS['featureId'] if read_root else False,
    'uncertaintyDeclared':report['status']=='INDEPENDENT_PHOTO_INFORMED_PROTOTYPE_NOT_SURVEYED',
    'fourPreviewImages':len(report['previews'])==4,
}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
bpy.context.view_layer.update()
exported = [o for o in bpy.data.objects if o.type=='MESH']
checks['glbReadableMeshCount'] = len(exported)==report['meshes']
exported_root = next((o for o in bpy.data.objects if o.get('feature_id')==PARAMS['featureId'] and o.type=='EMPTY'),None)
checks['glbRootLocationStable'] = exported_root is not None and max(abs(exported_root.matrix_world.translation[i]-report['rootBlender'][i]) for i in range(3))<0.0002
exported_positions = [o.matrix_world @ Vector(v) for o in exported for v in o.bound_box]
checks['glbBoundsStable'] = max(abs(min(p[i] for p in exported_positions)-bounds['min'][i]) for i in range(3))<0.0002 and max(abs(max(p[i] for p in exported_positions)-bounds['max'][i]) for i in range(3))<0.0002
VALIDATION.write_text(json.dumps({'version':VERSION,'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'passed':sum(checks.values()),'total':len(checks),'note':'Technical readback is not an as-built accuracy or visual similarity acceptance.'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'report':str(REPORT),'validation':str(VALIDATION),'checks':checks,'meshes':report['meshes'],'triangles':triangles},ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Prototype readback validation failed; preserve outputs for diagnosis')
