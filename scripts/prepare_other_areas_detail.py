"""Account for every authoritative record; prepare the remaining 52 reviewed bodies."""
import hashlib,json,re
from pathlib import Path
from shapely import constrained_delaunay_triangles
from shapely.geometry import shape,mapping
from shapely.ops import unary_union
P=Path(__file__).resolve().parents[1]
D=P/'reference/buildings/other_areas_detail_v001'
if (D/'parameters.json').exists(): raise RuntimeError('Version already exists')
inputs=['reference/buildings/residential_batch_v004.json','reference/buildings/academic_batch_v001.json',
        'reference/buildings/southwest_batch_v001.json','reference/buildings/remaining_batch_v001.json',
        'reference/buildings/residential_detail_v001/parameters.json','reference/buildings/teaching_detail_v001/parameters.json',
        'reference/buildings/campus_whole_school_queue_v004.json']
data=[json.loads((P/f).read_text(encoding='utf-8')) for f in inputs]
reviewed=[r for b in data[:4] for r in b['records']]
previous={a['id'] for a in data[4]['assets']}|{a['id'] for a in data[5]['assets']}
special={r['id'] for r in reviewed if r['sourceLabel'][-3:] in ['001','099','106']}
previous|=special
assert len(previous)==72
selected=[r for r in reviewed if r['id'] not in previous]
assert len(selected)==52 and len({r['id'] for r in selected})==52
assets=[]
for r in selected:
    key=r['sourceLabel'][-3:]; label=r['planLabel']; poly=shape(r['geometryLocal'])
    assert poly.is_valid
    role='academic'; group=label[0] if re.match(r'^[ABCD]区',label) else ('B' if poly.centroid.x<990 and poly.centroid.y<900 else 'C' if poly.centroid.x<990 else 'A' if poly.centroid.y<900 else 'D')
    if key in ['022','108','132','154','156']: role='roof_fragment'
    elif key in ['058','059']: role='unbound_body'
    elif key in ['128','129','079','078']: role='utility'
    elif key in ['165','075','012']: role='training'
    elif key in ['005','013','100','112','136']: role='public_hall'
    roof=list(constrained_delaunay_triangles(poly).geoms)
    assert unary_union(roof).symmetric_difference(poly).area<1e-7
    frame=poly.difference(poly.buffer(-.28,join_style='mitre'))
    ft=list(constrained_delaunay_triangles(frame).geoms)
    assert unary_union(ft).symmetric_difference(frame).area<1e-7
    assets.append({'id':r['id'],'key':key,'name':label,'district':group,'role':role,'modelPath':r['sourceModelPath'],
        'geometry':r['geometryLocal'],'centerEastNorth':list(poly.centroid.coords[0]),'heightMeters':r['sourceBodyHeightMeters'],
        'heightStatus':'SOURCE_ROUGH_PLACEHOLDER_NOT_MEASURED','floorCount':None,
        'componentCount':len(poly.geoms) if poly.geom_type=='MultiPolygon' else 1,
        'courtyardHoleCount':sum(len(g.interiors) for g in poly.geoms) if poly.geom_type=='MultiPolygon' else len(poly.interiors),
        'roofTrianglesEastNorth':[list(t.exterior.coords)[:-1] for t in roof],
        'parapetGeometry':mapping(frame),'parapetTrianglesEastNorth':[list(t.exterior.coords)[:-1] for t in ft]})
q=data[6]; modelled=previous|{a['id'] for a in assets}; assert len(modelled)==124
coverage=[]
for r in q['records']:
    if r['id'] in modelled: status='INDEPENDENT_DETAIL_WORK_AVAILABLE_NOT_AS_BUILT'
    elif r['stage'] in ['PLAN_QC_OWNER_OR_ROOF_SCOPE_UNCERTAIN','INDEPENDENT_PART_OWNERSHIP_UNVERIFIED']: status='EVIDENCE_BLOCKED_RETAIN_SOURCE'
    elif r['stage']=='PLAN_QC_RETAIN_ROOF_FRAGMENT': status='SMALL_REFERENCE_UNCHANGED'
    elif r['stage']=='PLAN_QC_PLANTED_OR_PAVED': status='NON_BUILDING_NOT_EXTRUDED'
    elif r['stage']=='PLAN_QC_REFINED_LIBRARY_COMPONENT': status='COVERED_BY_EXISTING_LIBRARY'
    elif r['stage']=='PLAN_QC_HISTORICAL_REPLACED_STAND': status='REPLACED_BY_EXISTING_STADIUM'
    elif r['stage']=='REFINED_LANDMARK_SOURCE_REFERENCE': status='EXISTING_REFINED_LANDMARK'
    else: raise RuntimeError(f'Unaccounted record {r["sourceLabel"]}')
    coverage.append({'id':r['id'],'sourceLabel':r['sourceLabel'],'name':r.get('planLabel'),
        'status':status,'sourceStage':r['stage'],'modelPath':r.get('sourceModelPath')})
assert len(coverage)==len({r['id'] for r in coverage})==166
D.mkdir(parents=True,exist_ok=True)
params={'version':'v001','status':'INDEPENDENT_TYPE_STUDY_NOT_AS_BUILT','assets':assets,
    'sourceFileHashes':{f:hashlib.sha256((P/f).read_bytes()).hexdigest().upper() for f in inputs},
    'previousDetailIds':sorted(previous),'allReviewedDetailIds':sorted(modelled),
    'facadePolicy':'Illustrative types only. No asserted storeys, entrances, taller workshop, invented sports roof or cross-ID connector.',
    'axisConvention':'BLENDER_X_EAST_Z_NORTH_MINUS_Y_UP'}
(D/'parameters.json').write_text(json.dumps(params,ensure_ascii=False,indent=2),encoding='utf-8')
(D/'campus_coverage.json').write_text(json.dumps({'records':coverage,'total':166,
    'counts':{s:sum(r['status']==s for r in coverage) for s in sorted({r['status'] for r in coverage})},
    'status':'PLAN_AND_TYPE_STUDY_PHASE_ACCOUNTED_FOR_NOT_FULL_AS_BUILT_COMPLETION'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'newAssets':len(assets),'newComponents':sum(a['componentCount'] for a in assets),
    'regionCounts':{g:sum(a['district']==g for a in assets) for g in 'ABCD'},'allDetailIds':124,'coverageRecords':166},ensure_ascii=False))
