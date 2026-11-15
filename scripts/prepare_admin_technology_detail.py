"""Prepare reversible photo-informed massing without changing registered GIS."""
import hashlib
import json
from pathlib import Path

from shapely.geometry import shape, box, mapping
from shapely.ops import unary_union

PROJECT = Path(__file__).resolve().parents[1]
OUT = PROJECT / 'reference/buildings/admin_technology_detail_v001'
PARAMS = OUT / 'parameters.json'
if PARAMS.exists():
    raise RuntimeError('Existing parameter version is protected')
OUT.mkdir(parents=True, exist_ok=True)
records = json.loads((PROJECT / 'reference/buildings/remaining_batch_v001.json').read_text(encoding='utf-8'))['records']
definitions = [
    {'key':'ADM','featureId':'buildings:7aea0ccf7f7a1d04760f','label':'南门东行政楼106',
     'bindingStatus':'LOCAL_USER_PLAN_LABEL_MATCH_NOT_OFFICIAL_COORDINATE',
     'front':'SOUTH','heightStatus':'PROVISIONAL_PHOTO_RATIO_NOT_MEASURED',
     'tallHeight':28.0,'lowHeight':12.0,'windowRows':6,
     'photo':'.firecrawl/admin-primary.jpg',
     'photoUrl':'https://25179804.s21i.faiusr.com/2/1/ABUIABACGAAgw_fZ-AUolJDT-QMwuAg4rgc.jpg',
     'hypothesis':'North and south bars are treated as tall courtyard wings; connector heights and south photo-facing direction are unverified.'},
    {'key':'TEC','featureId':'buildings:505bf97d7c47d70cd7b5','label':'科技园候选001（保留职工之家连续源主体）',
     'bindingStatus':'CANDIDATE_PHOTO_PLAN_MATCH_NOT_OFFICIAL_BINDING',
     'front':'NORTH','heightStatus':'PROVISIONAL_PHOTO_RATIO_NOT_MEASURED',
     'tallHeight':26.0,'lowHeight':10.0,'windowRows':5,
     'photo':'.firecrawl/tech-primary.jpg',
     'photoUrl':'https://25179804.s21i.faiusr.com/2/1/ABUIABACGAAgw_fZ-AUo4ovR6gEwuAg4wAU.jpg',
     'hypothesis':'Northeast tower and north viewing face are provisional. The plan labels technology building east of staff house, but no calibrated photo azimuth is available.'},
]

def components(g):
    return [g] if g.geom_type=='Polygon' else list(g.geoms)

assets = []
for d in definitions:
    r = next(r for r in records if r['id']==d['featureId'])
    polygon = shape(r['geometryLocal'])
    minx,minn,maxx,maxn = polygon.bounds
    # Cuts are editable hypotheses, not footprints taken from an elevation.
    if d['key']=='ADM':
        tall = polygon.intersection(unary_union([box(minx-1,minn-1,maxx+1,213.68436465226114),box(minx-1,246.6742258798331,maxx+1,maxn+1)]))
    else:
        tall = polygon.intersection(box(881.8026747527765,243.08837139885873,maxx+1,maxn+1))
    low = polygon.difference(tall)
    regions = []
    for role,g,h in [('tall',tall,d['tallHeight']),('podium_connector',low,d['lowHeight'])]:
        for i,part in enumerate(components(g)):
            if part.area < 0.0001:
                continue
            regions.append({'name':f'{role}_{i+1}','role':role,'heightMeters':h,'geometry':mapping(part)})
    union = unary_union([shape(p['geometry']) for p in regions])
    assert polygon.is_valid and all(shape(p['geometry']).is_valid for p in regions)
    assert union.symmetric_difference(polygon).area < 1e-6
    assert abs(sum(shape(p['geometry']).area for p in regions)-polygon.area)<1e-6
    assets.append({**d,'sourcePath':r['sourceModelPath'],'sourceLabel':r['sourceLabel'],
                   'planLabel':r['planLabel'],'sourceHeightMeters':r['sourceBodyHeightMeters'],
                   'sourceBaseElevationMeters':r['sourceBaseElevationMeters'],
                   'centerEastNorth':list(polygon.centroid.coords[0]),'footprint':mapping(polygon),
                   'boundsEastNorth':list(polygon.bounds),'regions':regions,
                   'registeredPlanAreaSqm':polygon.area,'splitSymmetricDifferenceSqm':union.symmetric_difference(polygon).area,
                   'regionAreaOverlapSqm':sum(shape(p['geometry']).area for p in regions)-union.area,
                   'sourcePhotoSha256':hashlib.sha256((PROJECT/d['photo']).read_bytes()).hexdigest().upper()})
parameters = {'version':'v001','campus':'华北理工大学曹妃甸校区','status':'INDEPENDENT_PHOTO_INFORMED_PROTOTYPE_NOT_SURVEYED',
              'primaryArticle':'https://www.astjc.org.cn/h-nd-139.html',
              'heightEvidence':'No reliable building-specific measured height was obtained. These heights are adjustable visualization hypotheses; rows are façade modules, not verified floor counts.',
              'footprintPolicy':'EXACT_REGISTERED_PLAN_PRESERVED_NO_PER_BUILDING_FIT_NO_SOURCE_ID_MERGE',
              'rights':'PRIVATE_SOURCE_CACHE_ONLY_NO_RAW_PHOTO_PUBLICATION','assets':assets}
PARAMS.write_text(json.dumps(parameters,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'parameters':str(PARAMS),'assets':[(a['key'],len(a['regions']),a['registeredPlanAreaSqm']) for a in assets]},ensure_ascii=False))
