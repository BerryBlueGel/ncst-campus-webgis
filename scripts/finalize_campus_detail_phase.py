"""Final non-production phase acceptance and complete 166-record coverage ledger."""
import json,hashlib
from pathlib import Path
from PIL import Image
P=Path(__file__).resolve().parents[1]
D=P/'reference/buildings/other_areas_detail_v001'
def load(path):return json.loads((P/path).read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256((P/path).read_bytes()).hexdigest().upper()
target=D/'PHASE_ACCEPTANCE.json'; queue=P/'reference/buildings/campus_whole_school_queue_v005.json'
assert not target.exists() and not queue.exists()
reports={f:load(f) for f in ['blender/other_areas_detail_v001_validation.json','blender/other_areas_detail_v001_geometry_audit.json',
 'output/campus_detail_preview_v001_validation.json','blender/campus_detail_v001_readback.json','output/campus_detail_v001_web_validation.json']}
new=load('blender/other_areas_detail_v001_report.json'); coverage=load('reference/buildings/other_areas_detail_v001/campus_coverage.json')
checks={f:r['status']=='PASS' for f,r in reports.items()}
checks['allProtectedFilesStillUnchanged']=all(sha(f)==h for f,h in new['protectedBefore'].items())
checks['166UniqueAccountedRecords']=len(coverage['records'])==len({r['id'] for r in coverage['records']})==166
checks['124IndependentDetailRecords']=coverage['counts']['INDEPENDENT_DETAIL_WORK_AVAILABLE_NOT_AS_BUILT']==124
checks['12EvidenceBlockedNotFaked']=coverage['counts']['EVIDENCE_BLOCKED_RETAIN_SOURCE']==12
checks['52NewAssets56Components']=len(new['assets'])==52 and sum(a['componentCount'] for a in new['assets'])==56
checks['unknownFloorCountsRetained']=all(a['floorCount'] is None for a in new['assets'])
images=[]
for folder in ['other_areas_detail_v001','campus_detail_v001']:
    for f in sorted((P/'blender/previews'/folder).glob('*.png')):
        with Image.open(f) as im:im.load();images.append({'path':f.relative_to(P).as_posix(),'size':list(im.size)})
checks['24ReadablePreviewImages']=len(images)==24
old=load('reference/buildings/campus_whole_school_queue_v004.json'); byid={r['id']:r for r in coverage['records']}
for r in old['records']:
    r['detailWorkStatus']=byid[r['id']]['status']
    r['productionModelChanged']=False
old['detailPhase']={'version':'v005','coverage':coverage['counts'],'status':'ALL_REVIEWED_BODY_TYPE_STUDIES_AVAILABLE_WITH_DECLARED_EVIDENCE_GAPS',
 'candidateModel':'output/campus_detail_preview_v001.glb','formalModelChanged':False,'cloudUpdated':False}
queue.write_text(json.dumps(old,ensure_ascii=False,indent=2),encoding='utf-8')
summary={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
 'coverage':coverage['counts'],'newRegionCounts':{g:sum(a['district']==g for a in new['assets']) for g in 'ABCD'},
 'newGroundMaxFivePointRangeMeters':max(max(h['elevationMeters'] for h in a['groundProbes'].values())-min(h['elevationMeters'] for h in a['groundProbes'].values()) for a in new['assets']),
 'previews':images,'queue':str(queue),'formalHash':sha('output/campus_refined_v005.glb'),
 'modelHash':sha('output/campus_detail_preview_v001.glb'),'workingBlendHash':sha('blender/campus_detail_working_v001.blend'),
 'productionReady':False,'asBuiltComplete':False,'cloudUpdated':False,
 'remaining':['12 ownership/roof evidence gaps retained without fabricated details.',
 '121 of 124 detail bodies retain source rough-height placeholders; exact heights/storeys/facades unverified.',
 'Gym publication height and admin/technology photo-ratio heights preserve their original uncertainty labels.',
 'Whole-campus browser draw-call count is high: production promotion needs instance/batching and benchmark work.',
 'Existing v005 auditorium decorative surface remains visually dense; no new landmark geometry edit in this phase.',
 'Five Ground samples per new asset do not establish full-footprint terrain contact.']}
target.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:summary[k] for k in ['status','passed','total','coverage','newRegionCounts','newGroundMaxFivePointRangeMeters']},ensure_ascii=False))
if not all(checks.values()):raise RuntimeError('Phase acceptance failed')
