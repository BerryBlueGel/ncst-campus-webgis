"""Collect actual browser evidence and final ground/asset checks for this delivery."""
import json
import os
import tempfile
from pathlib import Path
from audit_campus_ground_quality import audit
from integrate_library_v001_2 import sha256
P=Path(__file__).resolve().parents[1];dest=P/'reference/buildings/storeys_v003'
build=json.loads((dest/'build_validation.json').read_text(encoding='utf-8'))
blend=json.loads((dest/'blender_readback.json').read_text(encoding='utf-8'))
qa_path=Path(os.environ.get('CAMPUS_BROWSER_ACCEPTANCE', Path(tempfile.gettempdir())/'campus-storeys-20261009/browser_acceptance.json'))
qa=json.loads(qa_path.read_text(encoding='utf-8'))
assert build['status']==blend['status']==qa['status']=='PASS'
assert all(sha256(P/s)==h for s,h in build['preservedInputs'].items())
ground=audit(P/build['model'])
assert all(ground['counts'][k]==0 for k in ['foundationGapOver10cm','terrainAbovePlinthOver10cm','projectedOverlapsOverPoint1Sqm','incompleteGroundCoverage'])
assert sum(a['floorCount'] in [4,5] for a in ground['buildings'])==92
(dest/'ground_audit.json').write_text(json.dumps(ground,ensure_ascii=False,indent=2),encoding='utf-8')
(dest/'BROWSER_ACCEPTANCE.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf-8')
result={'status':'PASS','modelSha256':sha256(P/build['model']),'blenderSha256':sha256(P/'blender/campus_detail_working_v003.blend'),
 'groundCounts':ground['counts'],'browserStatus':qa['status'],'protectedInputsRechecked':True,
 'metreHeightAccuracy':'Estimated, not surveyed','typeFloorCounts':'User-confirmed typical type defaults',
 'formalUpdated':False,'cloudUpdated':False}
(dest/'FINAL_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
