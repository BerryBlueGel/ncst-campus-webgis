"""Inspect registered dorm roofs and active GLB geometry without changing source data."""
import json,sys
from pathlib import Path
from collections import Counter
from shapely.geometry import Polygon,shape
from shapely.ops import unary_union
from integrate_library_v001_2 import read_glb,sha256
from audit_campus_ground_quality import matrices,mesh_triangles
P=Path(__file__).resolve().parents[1];D=P/'reference/buildings/dorm_shapes_v002'
def active_roof(doc,binary,worlds,root):
    mesh_nodes=[]
    def walk(i):
        node=doc['nodes'][i]
        if node.get('extras',{}).get('shape_review_reference_only') or node.get('extras',{}).get('reference_only'):return
        if 'mesh' in node:mesh_nodes.append(i)
        for child in node.get('children',[]):walk(child)
    walk(root)
    roofs=[i for i in mesh_nodes if doc['nodes'][i].get('extras',{}).get('mesh_role')=='roof']
    polys=[]
    for i in roofs or mesh_nodes:
        for t in mesh_triangles(doc,binary,doc['nodes'][i],worlds[i]):
            p=Polygon(t[:,:2])
            if p.is_valid and p.area>1e-6:polys.append(p)
    return unary_union(polys)
def audit(after=False):
    data=json.loads((D/('corrected_input.json' if after else 'input.json')).read_text(encoding='utf-8'))
    model='output/campus_shape_review_v002.glb' if after else data['sourceModel'];doc,binary=read_glb(P/model);worlds,_=matrices(doc)
    rows=[]
    for r in data['rows']:
        actual=unary_union([active_roof(doc,binary,worlds,b['nodeIndices'][0]) for b in r['bindings']]);expected=shape(r['geometryLocal'])
        rows.append({**r,'insideSampleLocal':list(expected.representative_point().coords)[0],'actualGeometryLocal':actual.__geo_interface__,'areaDifferenceSqm':actual.symmetric_difference(expected).area,
            'boundaryDifferenceMeters':actual.hausdorff_distance(expected),'expectedValid':expected.is_valid,'actualValid':actual.is_valid})
    overlaps=[]
    for i,r in enumerate(rows):
        for s in rows[i+1:]:
            area=shape(r['actualGeometryLocal']).intersection(shape(s['actualGeometryLocal'])).area
            if area>.01:overlaps.append({'a':r['id'],'b':s['id'],'areaSqm':area})
    # The new returns must not cut into a service building or another non-dorm
    # source. Skip reference subtrees globally, not just reference root flags.
    neighbor_conflicts=[]
    if after:
        visible_roots={}
        def visible(i):
            node=doc['nodes'][i];extra=node.get('extras',{})
            if extra.get('shape_review_reference_only') or extra.get('reference_only'):return
            if extra.get('feature_id','').startswith('buildings:') and 'mesh' not in node:visible_roots.setdefault(extra['feature_id'],i)
            for c in node.get('children',[]):visible(c)
        for i in doc['scenes'][doc.get('scene',0)]['nodes']:visible(i)
        for r in rows:
            if not r.get('correction'):continue
            expected=shape(r['geometryLocal']);own={b['id'] for b in r['bindings']}
            for fid,i in visible_roots.items():
                if fid in own:continue
                other=active_roof(doc,binary,worlds,i)
                area=expected.intersection(other).area
                if area>.01:neighbor_conflicts.append({'dormitory':r['id'],'neighbor':fid,'areaSqm':area})
    status='PASS' if len(rows)==53 and not overlaps and not neighbor_conflicts and all(r['expectedValid'] and r['actualValid'] and r['boundaryDifferenceMeters']<.0002 for r in rows) else 'FAIL'
    return {'status':status,'sourceModel':model,'sourceHash':sha256(P/model),'count':len(rows),'districts':dict(Counter(r['district'] for r in rows)),
        'rows':rows,'overlaps':overlaps,'newReturnNeighborConflicts':neighbor_conflicts,'limitations':['Geometric comparison with registered schematic is not independent as-built verification.','JPG pixel frame differs; coordinates are native registered TIFF pixels.','Narrow north/south links excluded where height/ownership is unverified.']}
if __name__=='__main__':
    after='--after' in sys.argv;report=audit(after);(D/('audit_after.json' if after else 'audit_before.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'count':report['count'],'districts':report['districts'],'differences':[{'name':r['name'],'area':r['areaDifferenceSqm'],'boundary':r['boundaryDifferenceMeters']} for r in report['rows'] if r['areaDifferenceSqm']>.1],'overlaps':report['overlaps']},ensure_ascii=False))
    assert report['status']=='PASS',report['status']
