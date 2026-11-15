"""Read-only comparison of current GLB roofs and reviewed map shapes."""
import json
from pathlib import Path
from shapely.geometry import Polygon,shape
from shapely.ops import unary_union
from integrate_library_v001_2 import read_glb,descendants
from audit_campus_ground_quality import matrices,mesh_triangles
P=Path(__file__).resolve().parents[1]
def audit():
    doc,binary=read_glb(P/'output/campus_detail_release_v004.glb');worlds,_=matrices(doc)
    rows=[]
    for group in json.loads((P/'reference/buildings/shape_review_v001/registered_input_v002.json').read_text(encoding='utf-8'))['groups']:
        polys=[]
        for binding in group['bindings']:
            for root in binding['nodeIndices']:
                members=[i for i,_ in descendants(doc,root) if 'mesh' in doc['nodes'][i]]
                roofs=[i for i in members if doc['nodes'][i].get('extras',{}).get('mesh_role')=='roof']
                # Unmodeled source parts have no role: project their triangles for comparison only.
                for i in roofs or members:
                    for triangle in mesh_triangles(doc,binary,doc['nodes'][i],worlds[i]):
                        poly=Polygon(triangle[:,:2])
                        if poly.is_valid and poly.area>1e-6:polys.append(poly)
        old=unary_union(polys);new=shape(group['geometryLocal'])
        rows.append({'id':group['root'],'name':group['name'],'oldArea':old.area,'newArea':new.area,
                     'symmetricDifferenceSqm':old.symmetric_difference(new).area,
                     'components':len(new.geoms) if hasattr(new,'geoms') else 1,
                     'holes':sum(len(p.interiors) for p in new.geoms) if hasattr(new,'geoms') else len(new.interiors),
                     'bindings':group['bindings']})
    return rows
if __name__=='__main__':
    print(json.dumps(audit(),ensure_ascii=False,indent=2))
