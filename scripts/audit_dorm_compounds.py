"""Topology/height checks for the user-confirmed compound presentation only."""
import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely import set_precision
from audit_dorm_shapes import active_roof
from integrate_library_v001_2 import read_glb,sha256
from audit_campus_ground_quality import matrices,mesh_triangles
P=Path(__file__).resolve().parents[1];D=P/'reference/buildings/dorm_compounds_v003'
data=json.loads((D/'input.json').read_text(encoding='utf-8'));validation=json.loads((D/'validation.json').read_text(encoding='utf-8'))
doc,binary=read_glb(P/'output/campus_shape_review_v003.glb');worlds,_=matrices(doc)
rows=[]
for compound in data['compounds']:
    bodies=[g for g in data['groups'] if g['root'] in compound['bodyIds']]
    low=[c for c in validation['connections'] if c['key'].startswith(f"{compound['district']}-{compound['number']}-")]
    nodes=[g['bindings'][0]['nodeIndices'][0] for g in bodies]+[c['node'] for c in low]
    actual=unary_union([active_roof(doc,binary,worlds,i) for i in nodes]);expected=set_precision(shape(compound['geometryLocal']),.001)
    topology=set_precision(actual,.001)
    rows.append({'name':compound['name'],'root':compound['root'],'members':compound['members'],'bodyIds':compound['bodyIds'],
        'roofGeometryLocal':actual.__geo_interface__,'components':len(topology.geoms) if hasattr(topology,'geoms') else 1,
        'boundaryErrorMeters':topology.hausdorff_distance(expected),'rawEnvelopeAreaErrorSqm':actual.symmetric_difference(shape(compound['geometryLocal'])).area,
        'rawEnvelopeAreaToleranceSqm':shape(compound['geometryLocal']).length*.0002+.001,'connectionCount':len(low),
        'bodyNodeIndices':nodes[:len(bodies)],'connectionNodeIndices':nodes[len(bodies):]})
overlaps=[]
for i,r in enumerate(rows):
    for s in rows[i+1:]:
        overlap=shape(r['roofGeometryLocal']).intersection(shape(s['roofGeometryLocal'])).area
        if overlap>.01:overlaps.append({'a':r['name'],'b':s['name'],'areaSqm':overlap})
visible_roots={}
def visible(i):
    node=doc['nodes'][i];extra=node.get('extras',{})
    if extra.get('shape_review_reference_only') or extra.get('reference_only'):return
    fid=extra.get('feature_id','')
    if fid.startswith('buildings:') and 'mesh' not in node and not extra.get('dorm_compound_root'):visible_roots.setdefault(fid,i)
    for child in node.get('children',[]):visible(child)
for i in doc['scenes'][doc.get('scene',0)]['nodes']:visible(i)
neighbors={fid:active_roof(doc,binary,worlds,i) for fid,i in visible_roots.items()}
neighbor_conflicts=[]
for row in rows:
    own={row['root'],*row['members']};roof=shape(row['roofGeometryLocal'])
    for fid,other in neighbors.items():
        if fid in own:continue
        area=roof.intersection(other).area
        if area>.01:neighbor_conflicts.append({'compound':row['name'],'neighbor':fid,'areaSqm':area})
checks={'twentyFiveCompounds':len(rows)==25,'fiftyTwoMainBodies':len(data['groups'])==52,
 'allCompoundsConnected':all(r['components']==1 for r in rows),'compoundEnvelopesMatch':all(r['boundaryErrorMeters']<.002 and r['rawEnvelopeAreaErrorSqm']<r['rawEnvelopeAreaToleranceSqm'] for r in rows),
 'compoundsDoNotOverlap':not overlaps,'lowConnectorsRemainLower':all(c['heightEstimateMeters']==6.2 for c in validation['connections']),
 'nonDormitoryRoofsDoNotOverlap':not neighbor_conflicts,
 'previousVersionsProtected':all(sha256(P/p)==h for p,h in validation['protectedInputs'].items())}
report={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'rows':rows,'overlaps':overlaps,'neighborConflicts':neighbor_conflicts,
 'limitations':['Topology rounding at 1mm is numerical seam analysis, not a geometry buffer or survey tolerance.','Main bodies are user-typical five-level estimates; low connectors are two-level/6.2m type estimates, not individually measured.','No authority GIS union or ownership inference.','Whole-campus reference view coverage is not an individual full-angle survey.']}
(D/'compound_validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'checks':checks,'disconnected':[{'name':r['name'],'components':r['components'],'boundary':r['boundaryErrorMeters']} for r in rows if r['components']!=1 or r['boundaryErrorMeters']>=.002],'overlaps':overlaps},ensure_ascii=False))
