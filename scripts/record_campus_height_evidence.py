"""Maintain building-bound evidence without promoting indexed snippets to measured heights."""
import json
from pathlib import Path
P=Path(__file__).resolve().parents[1];OUT=P/'reference/buildings/quality_v002/height_evidence.json'
assert not OUT.exists(),'Keep previous evidence deliveries'
primary='https://www.ncst.edu.cn/col/1511411853762/2026/07/22/1784716146013.html'
queries=['search-building-floors','search-campus-storeys','search-ncst-six-storeys','search-ncst-dorm-official',
    'search-ncst-dorm-height','search-ncst-canteen-storeys','search-four-canteens','search-canteen-contract',
    'search-teaching-floors','search-juyuan-floor']
searches=[];snippets=[]
for key in queries:
    path=P/f'.firecrawl/{key}-20261009.json'
    if not path.exists():
        searches.append({'cache':str(path.relative_to(P)),'status':'EMPTY_OR_NOT_SAVED'});continue
    d=json.loads(path.read_text(encoding='utf-8'));items=d.get('data',{}).get('web',[])
    searches.append({'cache':str(path.relative_to(P)),'searchId':d.get('id'),'results':len(items)})
    snippets.extend({'cache':str(path.relative_to(P)),**{k:item.get(k) for k in ['url','title','description']}}
        for item in items if item.get('url')==primary)
rows=[]
for group in ['residential','teaching','other_areas']:
    d=json.loads((P/f'reference/buildings/{group}_detail_v001/parameters.json').read_text(encoding='utf-8'))
    for a in d['assets']:
        name=a['name'];hint={'兰园食堂':3,'梅园食堂':3,'竹园食堂':2}.get(name)
        rows.append({'id':a['id'],'name':name,'sourceModelPath':a['modelPath'],'group':group,
            'role':a.get('role',a.get('use','teaching')),'workingHeightMeters':a['heightMeters'],
            'heightStatus':a['heightStatus'],'measuredHeightMeters':None,'confirmedTotalStoreys':None,
            'indexedFloorExistenceHint':hint,'floorHintStatus':'PRIMARY_SEARCH_SNIPPET_PENDING_PAGE_READBACK' if hint else 'NO_BOUND_PRIMARY_EVIDENCE',
            'sourceUrl':primary if hint else None,
            'bindingStatus':'LOCAL_PLAN_NAME_MATCH_NOT_OFFICIAL_GEOMETRY_ID' if hint else 'UNBOUND',
            'modelScaleChanged':False})
result={'date':'2026-10-09','status':'EVIDENCE_REVIEW_COMPLETE_REAL_HEIGHT_VERIFICATION_STILL_OPEN',
    'registeredWorkingBuildings':len(rows),'measuredHeightsAdded':0,'confirmedTotalStoreyCountsAdded':0,
    'modelHeightChanges':0,'buildingsWithIndexedFloorHints':sum(r['indexedFloorExistenceHint'] is not None for r in rows),
    'primaryPageReadback':{'url':primary,'status':'BLOCKED','reason':'Firecrawl ERR_TUNNEL_CONNECTION_FAILED; web reader inaccessible; direct HTTPS SSL connection failed'},
    'primaryIndexedSnippets':snippets,'searches':searches,'buildings':rows,
    'rejectedEvidence':[
        {'category':'NEW_CONSTRUCTION_NOT_EXISTING_STOCK','url':'https://ggzyfw.beijing.gov.cn/xtgghbzbgg/20260409/5490704.html',
         'reason':'New dormitory design tender cannot establish dimensions of the existing 53 source dormitory bodies.'},
        {'category':'WRONG_CAMPUS','reason':'Qianan campus dormitory renovation is not Caofeidian.'},
        {'category':'WRONG_INSTITUTION','reason':'Qinggong College and similarly named Qiuzhen buildings at other universities are excluded.'},
        {'category':'AGGREGATED_TENDER_SNIPPETS','reason':'Nearby numerical heights on aggregated pages are not bound to these buildings.'}],
    'nextEvidenceNeeded':['Existing-building elevation/section drawings or an authoritative measured height table.',
        'Building-name-bound dated exterior photos showing complete roof and ground to count visible levels (still not measured height).',
        'Read back the canteen contract table; existence of a third floor does not prove exactly three floors or a building height.'],
    'scopeLimits':['121 registered type-study buildings only; special gym/admin/technology evidence stays in their existing reports.',
        'All GLB height/floor metadata unchanged; indexed hints are reference leads, not authority data.']}
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:result[k] for k in ['registeredWorkingBuildings','measuredHeightsAdded','confirmedTotalStoreyCountsAdded','buildingsWithIndexedFloorHints']},ensure_ascii=False))
