"""Audit evidence bindings, protected files, and private-reference policy."""
import hashlib
import json
from pathlib import Path
from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
PACK = PROJECT / 'reference/buildings/detail_research_v001'
sources = json.loads((PACK/'sources.json').read_text(encoding='utf-8'))
work = json.loads((PACK/'detail_work_queue.json').read_text(encoding='utf-8'))
params = json.loads((PACK/'gym_detail_parameters.json').read_text(encoding='utf-8'))
queue = json.loads((PROJECT/'reference/buildings/campus_whole_school_queue_v004.json').read_text(encoding='utf-8'))
report = json.loads((PROJECT/'blender/gym_detail_v002_report.json').read_text(encoding='utf-8'))
readback = json.loads((PROJECT/'blender/gym_detail_v002_validation.json').read_text(encoding='utf-8'))
ids = {record['id'] for record in queue['records']}
source_ids = {source['id'] for source in sources['sources']}
protected = {name:hashlib.sha256((PROJECT/name).read_bytes()).hexdigest().upper() for name in report['protectedBefore']}
photos = []
for source in sources['sources']:
    for photo in source.get('checkedPhotos',[]):
        image_path = PROJECT/photo['localPrivateCache']
        with Image.open(image_path) as image:
            image.verify()
        with Image.open(image_path) as image:
            photos.append({'file':image_path.relative_to(PROJECT).as_posix(),'size':list(image.size),'sha256':hashlib.sha256(image_path.read_bytes()).hexdigest().upper()})
previews = []
for relative in report['previews']:
    with Image.open(PROJECT/relative) as image:
        image.verify()
    with Image.open(PROJECT/relative) as image:
        previews.append({'file':relative,'size':list(image.size)})
pending_labels = {record['sourceLabel'].split()[-1] for record in queue['records'] if record['id'] in queue['pendingIds']}
checks = {
    'sourceRegistryIdsUnique':len(source_ids)==len(sources['sources']),
    'sourceReferencesResolvable':all(set(item['evidence'])<=source_ids for item in work['workItems']),
    'candidateBuildingBindingsExist':all(item.get('sourceId') in ids for item in work['workItems'] if item.get('sourceId')),
    'gymStableIdMatches':params['featureId']==report['featureId'],
    'formalAndGisAndPreviousWorkUnchanged':protected==report['protectedBefore'],
    'newGymReadback13Checks':readback['version']=='v002' and readback['status']=='PASS' and readback['passed']==13,
    'fourOriginalPhotosDecodable':len(photos)==4,
    'fourOwnPreviewsDecodable':len(previews)==4,
    'unresolvedSourceLabelsRetained':pending_labels==set(work['externalEvidenceGapSourceLabels']),
    'oldResidentialHeightsNotAssignedFromNewConstruction':work['workItems'][-1]['status']=='EXISTING_HEIGHTS_UNVERIFIED_DO_NOT_APPLY_NEW_PROJECT_FLOORS',
    'privateCacheIgnoredByRootPolicy':'.firecrawl/' in (PROJECT/'.gitignore').read_text(encoding='utf-8').splitlines(),
    'noRawReferenceCopiesInPublicAssets':all(not path.is_relative_to(PROJECT/'web/public') for path in [PROJECT/p['file'] for p in photos]),
    'noWebOrCloudPublication':not report['publicWebsiteUpdated'] and not report['cloudUpdated'],
    'footprintDiscrepancyExplicitlyReported':report['areaDifferencePercent']>18 and report['footprintPolicy']=='REGISTERED_PLAN_UNCHANGED_NO_FIT_TO_PUBLISHED_AREA',
}
result = {'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,'protectedLiveHashes':protected,'originalPhotos':photos,'ownPreviews':previews,'caveat':'Evidence-pack and model technical audit only; not full campus as-built or browser acceptance.'}
output = PACK/'validation.json'
output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':result['status'],'passed':result['passed'],'total':result['total'],'checks':checks},ensure_ascii=False))
if not all(checks.values()):
    raise SystemExit(1)
