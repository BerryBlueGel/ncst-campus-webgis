"""Independent whole-campus review assembly; never replaces the formal campus asset."""
import copy,json
from pathlib import Path
from integrate_library_v001_2 import read_glb,write_glb,sha256,count_triangles,count_primitive_modes,descendants,remove_nodes_and_private_meshes,remap_material_texture_indices,reachable_nodes
P=Path(__file__).resolve().parents[1]
def append_addon(base, addon, base_binary, addon_binary):
    if len(base.get("buffers", [])) != 1 or len(addon.get("buffers", [])) != 1:
        raise RuntimeError("当前合并器仅支持每个 GLB 一个内嵌 buffer")

    offsets = {
        "accessors": len(base.get("accessors", [])),
        "bufferViews": len(base.get("bufferViews", [])),
        "materials": len(base.get("materials", [])),
        "meshes": len(base.get("meshes", [])),
        "nodes": len(base.get("nodes", [])),
        "textures": len(base.get("textures", [])),
        "images": len(base.get("images", [])),
        "samplers": len(base.get("samplers", [])),
        "cameras": len(base.get("cameras", [])),
        "skins": len(base.get("skins", [])),
    }
    binary_offset = (len(base_binary) + 3) & ~3
    combined_binary = base_binary + b"\x00" * (binary_offset - len(base_binary)) + addon_binary

    for view in copy.deepcopy(addon.get("bufferViews", [])):
        view["buffer"] = 0
        view["byteOffset"] = view.get("byteOffset", 0) + binary_offset
        base.setdefault("bufferViews", []).append(view)
    for accessor in copy.deepcopy(addon.get("accessors", [])):
        if "bufferView" in accessor:
            accessor["bufferView"] += offsets["bufferViews"]
        sparse = accessor.get("sparse")
        if sparse:
            sparse["indices"]["bufferView"] += offsets["bufferViews"]
            sparse["values"]["bufferView"] += offsets["bufferViews"]
        base.setdefault("accessors", []).append(accessor)
    for sampler in copy.deepcopy(addon.get("samplers", [])):
        base.setdefault("samplers", []).append(sampler)
    for image in copy.deepcopy(addon.get("images", [])):
        if "bufferView" in image:
            image["bufferView"] += offsets["bufferViews"]
        base.setdefault("images", []).append(image)
    for texture in copy.deepcopy(addon.get("textures", [])):
        if "sampler" in texture:
            texture["sampler"] += offsets["samplers"]
        if "source" in texture:
            texture["source"] += offsets["images"]
        base.setdefault("textures", []).append(texture)
    for material in copy.deepcopy(addon.get("materials", [])):
        remap_material_texture_indices(material, offsets["textures"])
        base.setdefault("materials", []).append(material)
    for mesh in copy.deepcopy(addon.get("meshes", [])):
        for primitive in mesh.get("primitives", []):
            if "indices" in primitive:
                primitive["indices"] += offsets["accessors"]
            primitive["attributes"] = {
                semantic: accessor + offsets["accessors"]
                for semantic, accessor in primitive.get("attributes", {}).items()
            }
            if "material" in primitive:
                primitive["material"] += offsets["materials"]
            for target in primitive.get("targets", []):
                for semantic in list(target):
                    target[semantic] += offsets["accessors"]
        base.setdefault("meshes", []).append(mesh)
    for camera in copy.deepcopy(addon.get("cameras", [])):
        base.setdefault("cameras", []).append(camera)
    for skin in copy.deepcopy(addon.get("skins", [])):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] += offsets["accessors"]
        if "skeleton" in skin:
            skin["skeleton"] += offsets["nodes"]
        skin["joints"] = [joint + offsets["nodes"] for joint in skin.get("joints", [])]
        base.setdefault("skins", []).append(skin)
    for node in copy.deepcopy(addon.get("nodes", [])):
        if "mesh" in node:
            node["mesh"] += offsets["meshes"]
        if "camera" in node:
            node["camera"] += offsets["cameras"]
        if "skin" in node:
            node["skin"] += offsets["skins"]
        if "children" in node:
            node["children"] = [child + offsets["nodes"] for child in node["children"]]
        base.setdefault("nodes", []).append(node)
    for animation in copy.deepcopy(addon.get("animations", [])):
        for sampler in animation.get("samplers", []):
            sampler["input"] += offsets["accessors"]
            sampler["output"] += offsets["accessors"]
        for channel in animation.get("channels", []):
            target = channel.get("target", {})
            if "node" in target:
                target["node"] += offsets["nodes"]
        base.setdefault("animations", []).append(animation)

    addon_scene_index = addon.get("scene", 0)
    addon_roots = [
        node + offsets["nodes"]
        for node in addon["scenes"][addon_scene_index].get("nodes", [])
    ]
    scene_index = base.get("scene", 0)
    base["scenes"][scene_index].setdefault("nodes", []).extend(addon_roots)

    base.setdefault("buffers", [{"byteLength": 0}])
    base["buffers"][0]["byteLength"] = len(combined_binary)
    base["extensionsUsed"] = sorted(
        set(base.get("extensionsUsed", [])) | set(addon.get("extensionsUsed", []))
    )
    if not base["extensionsUsed"]:
        base.pop("extensionsUsed", None)
    base["extensionsRequired"] = sorted(
        set(base.get("extensionsRequired", [])) | set(addon.get("extensionsRequired", []))
    )
    if not base["extensionsRequired"]:
        base.pop("extensionsRequired", None)

    return combined_binary, offsets, addon_roots

def paths(doc):
    result={}
    def walk(index,parent):
        path=parent+[doc['nodes'][index].get('name','__unnamed__')]
        yield index,path
        for child in doc['nodes'][index].get('children',[]): yield from walk(child,path)
    for root in doc['scenes'][doc.get('scene',0)]['nodes']:
        for index,path in walk(root,[]):
            key='/'.join(path)
            if key in result:
                # Repeated tree names are legal; their unchanged traversal order provides stable signatures.
                number=2
                while key+'#'+str(number) in result: number+=1
                key=key+'#'+str(number)
            result[key]=index
    return result
def signatures(doc):
    result={}
    for path,index in paths(doc).items():
        node=copy.deepcopy(doc['nodes'][index]); node.pop('children',None)
        if 'mesh' in node: node['mesh']=doc['meshes'][node['mesh']]
        result[path]=json.dumps(node,ensure_ascii=False,sort_keys=True)
    return result
def main():
    target=P/'output/campus_detail_preview_v001.glb'
    reportpath=P/'output/campus_detail_preview_v001_validation.json'
    if target.exists() or reportpath.exists(): raise RuntimeError('Existing independent assembly')
    q=json.loads((P/'reference/buildings/other_areas_detail_v001/campus_coverage.json').read_text(encoding='utf-8'))
    baseline=P/'output/campus_refined_v005.glb'; expected='7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
    assert sha256(baseline)==expected
    base,binary=read_glb(baseline); original_binary=binary; original_materials=copy.deepcopy(base['materials'])
    old_signatures=signatures(base); location=paths(base); removed_paths=[]; remove=set()
    removable={'INDEPENDENT_DETAIL_WORK_AVAILABLE_NOT_AS_BUILT','NON_BUILDING_NOT_EXTRUDED','COVERED_BY_EXISTING_LIBRARY'}
    for r in q['records']:
        if r['status'] not in removable: continue
        path=r['modelPath']
        if path not in location: raise RuntimeError('Missing approved raw path '+str(path))
        if any(p.startswith(path+'#') for p in location): raise RuntimeError('Ambiguous replacement target '+path)
        index=location[path]
        for child,parts in descendants(base,index): remove.add(child); removed_paths.append('/'.join(parts))
    assert sum(r['status'] in removable for r in q['records'])==145
    removed_fullpaths={p for p,i in location.items() if i in remove}
    removal=remove_nodes_and_private_meshes(base,remove)
    # The formal v005 contains one old orphan source node. Remove it only from this new copy.
    orphan_indices=set(range(len(base['nodes'])))-reachable_nodes(base)
    orphan_names=[base['nodes'][i].get('name') for i in orphan_indices]
    if orphan_names!=['TPX_Buildings_14']: raise RuntimeError('Unexpected baseline orphans '+str(orphan_names))
    orphan_removal=remove_nodes_and_private_meshes(base,orphan_indices)
    retained_before={p:v for p,v in old_signatures.items() if p not in removed_fullpaths}
    retained_after=signatures(base)
    if retained_after!=retained_before:
        changed=[p for p,v in retained_before.items() if retained_after.get(p)!=v]
        print('Retained signature mismatch',changed[:10])
        for p in changed[:2]: print(p,retained_before[p],retained_after.get(p))
        raise RuntimeError('Retained signatures changed')
    addons=['teaching_detail_preview_v001.glb','residential_detail_preview_v001.glb',
      'other_areas_detail_preview_v001.glb','gym_detail_preview_v002.glb','admin_technology_preview_v002.glb']
    hashes={}; addon_counts=[]; ids=[]
    for filename in addons:
        file=P/'output'/filename; hashes[filename]=sha256(file); addon,ab=read_glb(file)
        roots=[n for n in addon['nodes'] if 'mesh' not in n and n.get('extras',{}).get('feature_id')]
        ids.extend(n['extras']['feature_id'] for n in roots)
        addon_counts.append({'file':filename,'rootIds':len(roots),'meshes':len(addon['meshes']),'triangles':count_triangles(addon)})
        binary,offsets,newroots=append_addon(base,addon,binary,ab)
    wanted={r['id'] for r in q['records'] if r['status']=='INDEPENDENT_DETAIL_WORK_AVAILABLE_NOT_AS_BUILT'}
    assert len(ids)==len(set(ids))==124 and set(ids)==wanted
    base['asset']['generator']='Campus independent source-preserving type-study assembly'
    base.setdefault('extras',{})['independentReview']={'status':'NOT_AS_BUILT_NOT_PRODUCTION','detailIds':124,
       'blockedSourceIds':12,'formalSourceSha256':expected,'doNotPublishAsSurveyed':True}
    write_glb(target,base,binary)
    actual,actualbin=read_glb(target); actualsig=signatures(actual); live=reachable_nodes(actual)
    checks={'readableGlb':True,'sourceBinaryPrefixUnchanged':actualbin[:len(original_binary)]==original_binary,
      'oldMaterialsUnchanged':actual['materials'][:len(original_materials)]==original_materials,
      'retainedNodesAndMeshDefinitionsUnchanged':all(actualsig.get(p)==v for p,v in retained_before.items()),
      'removed145ApprovedSourceRoots':len(removed_fullpaths)==removal['removedNodes'],
      '124UniqueExpectedDetailIds':len(ids)==len(set(ids))==124 and set(ids)==wanted,
      'allNodesReachable':len(live)==len(actual['nodes']),
      'formalBaselineUnchanged':sha256(baseline)==expected,
      'addonHashesUnchanged':all(sha256(P/'output'/f)==h for f,h in hashes.items()),
      'oldLineModesPreserved':{k:v for k,v in count_primitive_modes(actual).items() if k!='4'}=={k:v for k,v in count_primitive_modes(read_glb(baseline)[0]).items() if k!='4'}}
    for r in q['records']:
        if r['status'] in ['EVIDENCE_BLOCKED_RETAIN_SOURCE','SMALL_REFERENCE_UNCHANGED']:
            checks[r['sourceLabel']+'_retained']=r['modelPath'] in actualsig and actualsig[r['modelPath']]==old_signatures[r['modelPath']]
    report={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
      'output':str(target),'sha256':sha256(target),'bytes':target.stat().st_size,'nodes':len(actual['nodes']),
      'meshes':len(actual['meshes']),'triangles':count_triangles(actual),'materials':len(actual['materials']),
      'primitiveModes':count_primitive_modes(actual),'removal':removal,'orphanRemoval':orphan_removal,'removedSourcePaths':sorted(removed_fullpaths),
      'addons':addon_counts,'protectedAddonHashes':hashes,'coverage':q['counts'],
      'formalCampusUpdated':False,'cloudUpdated':False,
      'limits':['Independent exterior type study, not as-built reconstruction.','12 evidence gaps and 5 tiny reference roofs retained.',
       'Source 6m placeholders retained for 121 IDs; gym has publication height; admin/technology remain provisional.']}
    reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['status','passed','total','bytes','meshes','triangles','materials']},ensure_ascii=False))
    if not all(checks.values()): raise RuntimeError('Assembly acceptance failed')
if __name__=='__main__': main()
