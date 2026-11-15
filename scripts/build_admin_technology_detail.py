"""Blender-only independent work batch; source GIS and campus files are read-only."""
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
PARAMS = json.loads((PROJECT/'reference/buildings/admin_technology_detail_v001/parameters.json').read_text(encoding='utf-8'))
VERSION = sys.argv[sys.argv.index('--version')+1] if '--version' in sys.argv else 'v001'
if VERSION not in ('v001','v002'):
    raise RuntimeError('Only explicitly named versions supported')
BLEND = PROJECT/f'blender/admin_technology_working_{VERSION}.blend'
GLB = PROJECT/f'output/admin_technology_preview_{VERSION}.glb'
REPORT = PROJECT/f'blender/admin_technology_{VERSION}_report.json'
VALIDATION = PROJECT/f'blender/admin_technology_{VERSION}_validation.json'
PREVIEWS = PROJECT/f'blender/previews/admin_technology_{VERSION}'
for path in (BLEND,GLB,REPORT,VALIDATION):
    if path.exists():
        raise RuntimeError(f'Refusing to overwrite {path}')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()

protected_names = ['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
                   'web/public/data/buildings.geojson','output/geojson/buildings.geojson',
                   'blender/campus_buildings_working_v007.blend','output/campus_remaining_preview_v001.glb',
                   'blender/gym_detail_working_v002.blend','output/gym_detail_preview_v002.glb']
before = {name:digest(PROJECT/name) for name in protected_names}
if VERSION=='v002':
    protected_names += ['blender/admin_technology_working_v001.blend','output/admin_technology_preview_v001.glb']
    before.update({name:digest(PROJECT/name) for name in protected_names if name not in before})
if before['output/campus_refined_v005.glb'] != '7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65':
    raise RuntimeError('Unexpected formal baseline')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(PROJECT/'output/campus_refined_v005.glb'))
bpy.context.view_layer.update()

def find_source(path):
    parts = path.split('/')
    node = bpy.data.objects.get(parts[0])
    for name in parts[1:]:
        node = next((c for c in node.children if c.name.split('.')[0]==name),None) if node else None
    if not node:
        raise RuntimeError(f'Missing source hierarchy {path}')
    return node

kept = set()
references = {}
ground = {}
for a in PARAMS['assets']:
    node = find_source(a['sourcePath'])
    nodes = [node,*node.children_recursive]
    reference = bpy.data.collections.new(f"SOURCE_{a['key']}_UNCHANGED_REFERENCE_ONLY")
    bpy.context.scene.collection.children.link(reference)
    references[a['key']] = {'collection':reference.name,'nodes':[o.name for o in nodes],
                             'matrices':{o.name:[list(row) for row in o.matrix_world] for o in nodes}}
    for obj in nodes:
        reference.objects.link(obj)
        obj.hide_render = True
        obj.hide_set(True)
        obj.display_type = 'WIRE'
        obj['reference_only'] = True
        obj['source_path'] = a['sourcePath']
    kept.update(nodes)
    ancestor = node.parent
    while ancestor:
        kept.add(ancestor)
        ancestor = ancestor.parent
    cx,cn = a['centerEastNorth']
    samples = {}
    for label,dx,dn in [('center',0,0),('north',0,22),('south',0,-22),('east',22,0),('west',-22,0)]:
        origin = Vector((cx+dx,-500,cn+dn))
        direction = Vector((0,1,0))
        hits = []
        for obj in bpy.data.objects:
            if obj.type!='MESH' or 'TPX_Ground' not in obj.name:
                continue
            inv = obj.matrix_world.inverted()
            hit,location,normal,index = obj.ray_cast(inv@origin,(inv.to_3x3()@direction).normalized(),distance=2000)
            if hit:
                world = obj.matrix_world@location
                hits.append({'world':list(world),'elevationMeters':-world.y,'distance':(world-origin).length,'object':obj.name})
        samples[label] = min(hits,key=lambda h:h['distance']) if hits else None
    if not all(samples.values()):
        raise RuntimeError('Ground probes missing')
    ground[a['key']] = samples
for obj in list(bpy.data.objects):
    if obj not in kept:
        bpy.data.objects.remove(obj,do_unlink=True)

collection = bpy.data.collections.new(f'ADMIN_TECH_DETAIL_{VERSION.upper()}_PROVISIONAL')
bpy.context.scene.collection.children.link(collection)

def material(name,color,metallic=0,roughness=.65):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color,1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

mats = {'cream':material('AT_PaleLimestone',(.79,.72,.61)),
        'orange':material('AT_WarmTerracotta',(.61,.32,.16)),
        'glass':material('AT_RecessedBlueGlass',(.07,.23,.34),.3,.24),
        'shadow':material('AT_DarkLouvers',(.085,.075,.065),.15),
        'white':material('AT_PaleCylindricalColumns',(.84,.87,.86)),
        'roof':material('AT_RoofMembrane',(.30,.33,.34)),
        'base':material('AT_Concrete',(.53,.56,.55))}
all_objects = []
asset_reports = []
roots = []
root_names = {}

def ring_area(ring):
    return sum(ring[i][0]*ring[(i+1)%len(ring)][1]-ring[(i+1)%len(ring)][0]*ring[i][1] for i in range(len(ring)))/2

def on_segment(pt,p,q):
    v=Vector(q)-Vector(p)
    if v.length<1e-8:
        return math.dist(pt,p)<.001
    t=max(0,min(1,(Vector(pt)-Vector(p)).dot(v)/v.length_squared))
    return (Vector(pt)-(Vector(p)+v*t)).length<.001

def inside(pt,ring):
    x,y=pt
    odd=False
    for i,p in enumerate(ring):
        q=ring[(i+1)%len(ring)]
        if on_segment(pt,p,q):
            return True
        if (p[1]>y)!=(q[1]>y) and x<(q[0]-p[0])*(y-p[1])/(q[1]-p[1])+p[0]:
            odd=not odd
    return odd

for a in PARAMS['assets']:
    key=a['key']
    cx,cn=a['centerEastNorth']
    base=ground[key]['center']['elevationMeters']-.05
    root=bpy.data.objects.new(f'{key}_Detail_Work_{VERSION}',None)
    collection.objects.link(root)
    root.location=(cx,-base,cn)
    root['feature_id']=a['featureId']
    root['binding_status']=a['bindingStatus']
    root['height_status']=a['heightStatus']
    root['height_m']=a['tallHeight']
    root['source_height_m']=a['sourceHeightMeters']
    root['source_path']=a['sourcePath']
    root['do_not_publish_as_surveyed']=True
    roots.append(root)
    root_names[key]=root.name
    buffers={name:([],[]) for name in mats}
    def add(mat,verts,faces):
        v,f=buffers[mat]
        off=len(v)
        v.extend(verts)
        f.extend(tuple(off+i for i in face) for face in faces)
    def quad(mat,verts):
        add(mat,verts,[(0,1,2,3)])
    def local_ring(geometry):
        if len(geometry['coordinates'])!=1:
            raise RuntimeError('Unexpected polygon hole; never fill it with fan triangles')
        ring=[(x-cx,n-cn) for x,n in geometry['coordinates'][0][:-1]]
        return ring if ring_area(ring)>0 else list(reversed(ring))
    original=local_ring(a['footprint'])
    def cap(ring,h,mat):
        vecs=[Vector((x,n,h)) for x,n in ring]
        triangles=tessellate_polygon([vecs])
        for triangle in triangles:
            add(mat,[tuple(vecs[p]) if isinstance(p,int) else tuple(p) for p in triangle],[(0,1,2)])
    def extrusion(ring,lo,hi,mat):
        for i,p in enumerate(ring):
            q=ring[(i+1)%len(ring)]
            quad(mat,[(p[0],p[1],lo),(q[0],q[1],lo),(q[0],q[1],hi),(p[0],p[1],hi)])
        cap(ring,hi,mat)
        cap(list(reversed(ring)),lo,mat)
    def box_(x,n,w,d,lo,hi,mat):
        extrusion([(x-w/2,n-d/2),(x+w/2,n-d/2),(x+w/2,n+d/2),(x-w/2,n+d/2)],lo,hi,mat)
    def panel(p,q,u,v,lo,hi,inset,mat):
        d=Vector(q)-Vector(p)
        normal=Vector((d.y,-d.x)).normalized()
        s=Vector(p)+d*u-normal*inset
        t=Vector(p)+d*v-normal*inset
        quad(mat,[(s.x,s.y,lo),(t.x,t.y,lo),(t.x,t.y,hi),(s.x,s.y,hi)])
    def cylinder_(x,n,r,lo,hi,mat):
        extrusion([(x+r*math.cos(i*math.tau/12),n+r*math.sin(i*math.tau/12)) for i in range(12)],lo,hi,mat)
    bottom=min(s['elevationMeters'] for s in ground[key].values())-base-.1
    extrusion(original,bottom,.35,'base')
    column_count=0
    window_count=0
    primary_edge_count=0
    for region in a['regions']:
        ring=local_ring(region['geometry'])
        height=region['heightMeters']
        tall=region['role']=='tall'
        body_top=height-2.2 if tall else height-.45
        cap(ring,body_top,'roof')
        cap(list(reversed(ring)),.35,'base')
        extrusion(ring,height-.45,height,'cream')
        # Thin top membrane stays within exact region, never spans courtyards.
        cap(ring,height+.015,'roof')
        for i,p in enumerate(ring):
            q=ring[(i+1)%len(ring)]
            d=Vector(q)-Vector(p)
            length=d.length
            if length<.01:
                continue
            mid=(Vector(p)+Vector(q))/2
            exterior=any(on_segment(mid,original[j],original[(j+1)%len(original)]) for j in range(len(original)))
            if not exterior:
                quad('cream',[(p[0],p[1],.35),(q[0],q[1],.35),(q[0],q[1],body_top),(p[0],p[1],body_top)])
                continue
            normal=Vector((d.y,-d.x)).normalized()
            primary=tall and length>18 and (normal.y<-.9 if a['front']=='SOUTH' else normal.y>.9)
            if primary:
                primary_edge_count+=1
            ground_inset=2.6 if VERSION=='v002' and (primary or not tall) and length>18 else .22
            panel(p,q,0,1,.35,4.1,ground_inset,'glass')
            panel(p,q,0,1,4.1,body_top,.24,'orange' if (primary or not tall) else 'cream')
            if primary:
                slot0,slot1=(.60,.79) if key=='ADM' else (.44,.58)
                warm_end=slot0
                panel(p,q,slot0,slot1,4.1,body_top,.21,'glass')
                panel(p,q,slot1,1,4.1,height,.035,'cream')
                if VERSION=='v002':
                    for row in range(1,a['windowRows']*2):
                        h=4.1+(body_top-4.1)*row/(a['windowRows']*2)
                        panel(p,q,slot0,slot1,h,h+.085,.16,'shadow')
                    for j in range(1,4):
                        u=slot0+(slot1-slot0)*j/4
                        panel(p,q,u,u+.075/length,4.1,body_top,.16,'shadow')
                if key=='TEC':
                    panel(p,q,.78,.84,11,body_top-3,.02,'glass')
                # An actual open upper strip: facade stops below roof.
                for u in (.015,.28,.54,.975):
                    s=Vector(p)+d*u-normal*.9
                    if inside((s.x,s.y),original):
                        box_(s.x,s.y,.75,.75,body_top,height-.45,'cream')
                for u in (.08,.25,.42,.58):
                    s=Vector(p)+d*u-normal*1.55
                    if inside((s.x,s.y),original):
                        cylinder_(s.x,s.y,.72,.35,4.15,'white')
                        column_count+=1
            else:
                warm_end=1
            rows=a['windowRows'] if tall else 1
            step=(body_top-5.0)/rows
            bays=max(2,round(length/2.7))
            for row in range(rows):
                lo=4.6+row*step
                hi=min(body_top-.25,lo+step*.74)
                for bay in range(bays):
                    u=(bay+.19)/bays
                    v=(bay+.68+(bay%3)*.06)/bays
                    if v>warm_end-.015:
                        continue
                    # Staggered slender panes approximate the photo's vertical rhythm.
                    if VERSION=='v002' and primary:
                        pane_lo=max(4.35,lo-(.5 if bay%4==1 else 0))
                        pane_hi=min(body_top-.25,hi+(.5 if bay%4==2 else 0))
                    else:
                        pane_lo,pane_hi=lo,hi
                    panel(p,q,u,v,pane_lo,pane_hi,.19,'glass')
                    window_count+=1
                if row%2==1 or not tall:
                    panel(p,q,0,warm_end,hi+.07,min(body_top,hi+.22),.12,'shadow')
            for u in [j/max(1,bays) for j in range(1,bays)]:
                panel(p,q,u,min(1,u+.06/length),.35,4.1,ground_inset-.04,'white')
            panel(p,q,0,1,4.08,4.27,.09,'shadow')
            # Reveal the edge depth with narrow returns, not pasted flat blocks.
            for u in (0,1):
                s=Vector(p)+d*u
                t=s-normal*.24
                quad('cream',[(s.x,s.y,4.1),(t.x,t.y,4.1),(t.x,t.y,body_top),(s.x,s.y,body_top)])
                t=s-normal*ground_inset
                quad('cream',[(s.x,s.y,.35),(t.x,t.y,.35),(t.x,t.y,4.1),(s.x,s.y,4.1)])
    objects=[]
    for mat,(verts,faces) in buffers.items():
        if not faces:
            continue
        data=bpy.data.meshes.new(f'{key}_{mat}')
        data.from_pydata([(x,-h,n) for x,n,h in verts],[],faces)
        data.update()
        bm=bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        data.materials.append(mats[mat])
        obj=bpy.data.objects.new(f'{key}_{mat}',data)
        collection.objects.link(obj)
        obj.parent=root
        obj['feature_id']=a['featureId']
        obj['geometry_status']=PARAMS['status']
        objects.append(obj)
    bpy.context.view_layer.update()
    for obj in objects:
        obj.data.calc_loop_triangles()
    positions=[obj.matrix_world@Vector(v) for obj in objects for v in obj.bound_box]
    bounds={'min':[min(p[i] for p in positions) for i in range(3)],'max':[max(p[i] for p in positions) for i in range(3)]}
    all_objects.extend(objects)
    asset_reports.append({**a,'rootBlender':list(root.location),'workingBaseElevationMeters':base,
                          'verticalAdjustmentMeters':base-a['sourceBaseElevationMeters'],
                          'foundationBottomRelativeMeters':bottom,'groundProbes':ground[key],
                          'groundRangeMeters':max(s['elevationMeters'] for s in ground[key].values())-min(s['elevationMeters'] for s in ground[key].values()),
                          'meshCount':len(objects),'triangleCount':sum(len(o.data.loop_triangles) for o in objects),
                          'windowModuleCountNotFloorCount':window_count,'columnCount':column_count,
                          'primaryPhotoFacingEdges':primary_edge_count,'boundsBlender':bounds})

bpy.ops.object.select_all(action='DESELECT')
for obj in roots+all_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active=roots[0]
bpy.ops.export_scene.gltf(filepath=str(GLB),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)

# Unexported neutral studio ground, camera and lights.
for a in asset_reports:
    x,n=a['centerEastNorth']
    base=a['workingBaseElevationMeters']
    data=bpy.data.meshes.new(f"{a['key']}_ReviewPlane")
    data.from_pydata([(x-90,-base+.15,n-90),(x+90,-base+.15,n-90),(x+90,-base+.15,n+90),(x-90,-base+.15,n+90)],[],[(0,1,2,3)])
    plane=bpy.data.objects.new(data.name,data)
    bpy.context.scene.collection.objects.link(plane)
    data.materials.append(mats['base'])
    plane['review_only']=True
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x,scene.render.resolution_y=1200,900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.world=bpy.data.worlds.new('AT_Review_Daylight')
scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
bg.inputs[0].default_value=(.70,.83,.95,1)
bg.inputs[1].default_value=.7
scene.view_settings.view_transform='AgX'
light_data=bpy.data.lights.new('AT_Review_Sun','SUN')
light_data.energy=3
sun=bpy.data.objects.new('AT_Review_Sun',light_data)
scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(30),math.radians(-25),math.radians(-25))
cam_data=bpy.data.cameras.new('AT_Review_Camera')
cam=bpy.data.objects.new('AT_Review_Camera',cam_data)
scene.collection.objects.link(cam)
cam_data.type='ORTHO'
cam_data.clip_end=3000
scene.camera=cam
PREVIEWS.mkdir(parents=True,exist_ok=True)
def render(name,target,dx,dn,height,scale):
    x,base,n=target
    cam.location=(x+dx,-base-height,n+dn)
    forward=(Vector((x,-base-9,n))-cam.location).normalized()
    up=Vector((0,-1,0))
    if abs(forward.dot(up))>.99:
        up=Vector((0,0,1))
    right=forward.cross(up).normalized()
    cam.rotation_euler=Matrix((right,right.cross(forward).normalized(),-forward)).transposed().to_euler()
    cam_data.ortho_scale=scale
    scene.render.filepath=str(PREVIEWS/name)
    bpy.ops.render.render(write_still=True)
for a in asset_reports:
    x,n=a['centerEastNorth']
    target=(x,a['workingBaseElevationMeters'],n)
    key=a['key'].lower()
    sign=-1 if a['front']=='SOUTH' else 1
    render(f'{key}_top.png',target,0,0,230,140)
    render(f'{key}_front_provisional.png',target,0,sign*210,22,120)
    render(f'{key}_oblique.png',target,sign*125,sign*130,85,145)
centerx=sum(a['centerEastNorth'][0] for a in asset_reports)/2
centern=sum(a['centerEastNorth'][1] for a in asset_reports)/2
render('batch_geographic_overview.png',(centerx,0,centern),0,-430,330,490)
scene['axis_convention']='BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'
scene['geometry_status']=PARAMS['status']
scene['no_cloud_or_formal_changes']=True
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
report={'version':VERSION,'status':PARAMS['status'],'assets':asset_reports,'sourceReferences':references,
        'meshes':len(all_objects),'triangles':sum(a['triangleCount'] for a in asset_reports),'materials':len(mats),
        'glbBytes':GLB.stat().st_size,'glbSha256':digest(GLB),'protectedBefore':before,
        'protectedAfter':{name:digest(PROJECT/name) for name in protected_names},
        'previews':[p.relative_to(PROJECT).as_posix() for p in sorted(PREVIEWS.glob('*.png'))],
        'publicWebsiteUpdated':False,'cloudUpdated':False,
        'limitations':['Absolute heights, floor counts and photo azimuths are unmeasured.',
                       'Administration north/south tall-wing assignment is a study hypothesis.',
                       'Technology northeast tower and photo/source identity remain candidate bindings.',
                       'Technical acceptance does not establish as-built accuracy or photo similarity.']}
REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
checks={'blendReadable':all(bpy.data.objects.get(name) is not None for name in root_names.values()),
        'protectedAssetsUnchanged':before==report['protectedAfter'],
        'twoIndependentSourceIds':len({a['featureId'] for a in asset_reports})==2,
        'allTenGroundProbesHit':all(s for samples in ground.values() for s in samples.values()),
        'splitUnionPreservesPlan':all(a['splitSymmetricDifferenceSqm']<1e-6 for a in asset_reports),
        'splitAreasDoNotOverlap':all(abs(a['regionAreaOverlapSqm'])<1e-6 for a in asset_reports),
        'uncertaintyRetained':all(a['heightStatus']=='PROVISIONAL_PHOTO_RATIO_NOT_MEASURED' for a in asset_reports),
        'sourceHeightRetained':all(abs(bpy.data.objects[root_names[a['key']]]['source_height_m']-a['sourceHeightMeters'])<1e-5 for a in asset_reports),
        'sourceReferencesHidden':all(bpy.data.objects[name].hide_render and bpy.data.objects[name].hide_get() for ref in references.values() for name in ref['nodes']),
        'sourceReferenceTransformsUnchanged':all(max(abs(bpy.data.objects[name].matrix_world[r][c]-matrix[r][c]) for r in range(4) for c in range(4))<1e-6 for ref in references.values() for name,matrix in ref['matrices'].items()),
        'sevenRenderedPreviews':len(report['previews'])==7,
        'triangleBudget':report['triangles']<6000}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))
bpy.context.view_layer.update()
exported=[o for o in bpy.data.objects if o.type=='MESH']
checks['glbMeshCount']=len(exported)==report['meshes']
checks['sourceAndReviewGeometryExcluded']=all(o.name.startswith(('ADM_','TEC_')) and o.get('feature_id') for o in exported)
checks['twoExportedRoots']=len([o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')])==2
for a in asset_reports:
    root=next((o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')==a['featureId']),None)
    checks[f"{a['key']}_RootStable"]=root is not None and max(abs(root.matrix_world.translation[i]-a['rootBlender'][i]) for i in range(3))<.0002
    points=[o.matrix_world@Vector(v) for o in exported if o.get('feature_id')==a['featureId'] for v in o.bound_box]
    checks[f"{a['key']}_BoundsStable"]=bool(points) and max(abs(min(p[i] for p in points)-a['boundsBlender']['min'][i]) for i in range(3))<.0002 and max(abs(max(p[i] for p in points)-a['boundsBlender']['max'][i]) for i in range(3))<.0002
    checks[f"{a['key']}_TallHeightParameterApplied"]=abs(-min(p.y for p in points)-a['workingBaseElevationMeters']-a['tallHeight']-.015)<.0002
VALIDATION.write_text(json.dumps({'version':VERSION,'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,'note':'Technical readback only; not as-built accuracy acceptance.'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'report':str(REPORT),'validation':str(VALIDATION),'meshes':report['meshes'],'triangles':report['triangles'],'checks':checks},ensure_ascii=False))
if not all(checks.values()):
    raise RuntimeError('Independent work readback failed; preserve artifacts for investigation')
