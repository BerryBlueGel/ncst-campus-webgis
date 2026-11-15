"""Reopen the independent shape candidate; no GLB re-export or source overwrite."""
import json,hashlib,sys
from pathlib import Path
import bpy
P=Path(__file__).resolve().parents[1];version='v006' if '--academic-v006' in sys.argv else 'v005' if '--academic-v005' in sys.argv else 'v004' if '--campus-v004' in sys.argv else 'v003' if '--compounds-v003' in sys.argv else 'v002' if '--dormitories-v002' in sys.argv else 'v001'
model=P/f'output/campus_shape_review_{version}.glb';out=P/f'blender/campus_shape_review_{version}.blend'
assert not out.exists(),'Preserve previous working scenes'
before=hashlib.sha256(model.read_bytes()).hexdigest()
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(model))
refs=[]
for obj in bpy.data.objects:
    if obj.get('shape_review_reference_only'):
        refs.append(obj.name)
        for node in [obj,*obj.children_recursive]:node.hide_render=True;node.hide_set(True)
count=sum(o.type=='EMPTY' and bool(o.get('shape_review_display_id')) for o in bpy.data.objects)
bpy.ops.wm.save_as_mainfile(filepath=str(out));bpy.ops.wm.open_mainfile(filepath=str(out))
checks={'referencesHidden':all(bpy.data.objects[name].hide_render for name in refs),'shapeBindingsReopened':sum(o.type=='EMPTY' and bool(o.get('shape_review_display_id')) for o in bpy.data.objects)==count,
 'landmarksRetained':all(any(o.name==name for o in bpy.data.objects) for name in ['LIBRARY_REFINED_ROOT','AUDITORIUM_REFINED_ROOT','FUS_Root','SOUTH_GATE_REFINED_ROOT']),
 'glbNotReexported':hashlib.sha256(model.read_bytes()).hexdigest()==before}
assert all(checks.values()),checks
directory=P/('reference/buildings/academic_refinement_'+version if version in ['v005','v006'] else 'reference/buildings/campus_shapes_v004' if version=='v004' else 'reference/buildings/dorm_compounds_v003' if version=='v003' else 'reference/buildings/dorm_shapes_v002' if version=='v002' else 'reference/buildings/shape_review_v001')
(directory/'blender_readback.json').write_text(json.dumps({'status':'PASS','checks':checks,'shapeBoundObjects':count,'hiddenReferenceCount':len(refs)},indent=2),encoding='utf-8')
print(json.dumps(checks))
