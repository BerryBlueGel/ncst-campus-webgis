"""Evidence-bounded D3/B4 v005, then A4/D1/D9 v006 display refinement.
Registered roof != closed ground footprint.
Append-only GLB buffers, source roots/transforms/GIS and prior releases retained.
"""
import copy,gzip,json,math,sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon,Point,mapping
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely import constrained_delaunay_triangles
from integrate_library_v001_2 import read_glb,write_glb,sha256,descendants
from audit_campus_ground_quality import matrices,mesh_triangles
from audit_dorm_shapes import active_roof

P=Path(__file__).resolve().parents[1]
VERSION='v006' if '--next-v006' in sys.argv else 'v005'
D=P/('reference/buildings/academic_refinement_'+VERSION);D.mkdir(parents=True,exist_ok=True)
OUT=P/('output/campus_shape_review_'+VERSION+'.glb')
assert not OUT.exists(),'Do not overwrite an accepted candidate'
protected=['output/campus_refined_v005.glb','web/public/models/campus_refined_v005.glb',
 'output/campus_shape_review_v004.glb','output/geojson/buildings.geojson','web/public/data/buildings.geojson']
if VERSION=='v006':protected.append('output/campus_shape_review_v005.glb')
before={p:sha256(P/p) for p in protected}
old,blob=read_glb(P/('output/campus_shape_review_v005.glb' if VERSION=='v006' else protected[2]));doc=copy.deepcopy(old);binary=bytearray(blob);worlds,_=matrices(old)
scale=.35858544812789306
def trace(points):
    return Polygon([(635954.8830563505+x*scale-635986.7561034276,
                     4341918.878195945-y*scale-4339716.120350528) for x,y in points])
def root(fid):
    matches=[i for i,n in enumerate(old['nodes']) if 'mesh' not in n and n.get('extras',{}).get('feature_id')==fid]
    assert len(matches)==1,(fid,matches)
    return matches[0]
def append(a,kind,component,target):
    a=np.ascontiguousarray(a);binary.extend(b'\0'*((-len(binary))%4));offset=len(binary);binary.extend(a.tobytes())
    view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':a.nbytes,'target':target})
    acc={'bufferView':view,'componentType':component,'count':len(a),'type':kind}
    if kind=='VEC3':acc.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
    i=len(doc['accessors']);doc['accessors'].append(acc);return i
materials={}
for role,color in {'wall':[.79,.80,.76,1],'glass':[.20,.35,.40,1],'base':[.57,.43,.28,1],'roof':[.52,.55,.55,1]}.items():
    materials[role]=len(doc['materials']);doc['materials'].append({'name':'ACADEMIC_'+VERSION.upper()+'_'+role,
     'pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':0,'roughnessFactor':.9}})
changed=set();rows=[]
def geometry(host,fid,poly,bottom,top,role_name,windows=False):
    """Generate a closed prism with optional vertical grouped windows, holes retained."""
    inv=np.linalg.inv(worlds[host]);origin=(inv@np.array([poly.centroid.x,poly.centroid.y,bottom,1]))[:3]
    storeys=doc['nodes'][host].get('extras',{}).get('floor_count')
    window_rows=storeys if storeys in [4,5] else 1
    buffers={r:([],[],[]) for r in materials}
    def face(role,points):
        vs=(np.c_[np.asarray(points),np.ones(len(points))]@inv.T)[:,:3]-origin
        normal=np.cross(vs[1]-vs[0],vs[2]-vs[0]);size=np.linalg.norm(normal)
        if size<1e-9:return
        normal/=size;v,n,t=buffers[role];offset=len(v);v.extend(vs.tolist());n.extend([normal.tolist()]*len(vs));t.extend([[offset,offset+k,offset+k+1] for k in range(1,len(vs)-1)])
    for component in list(poly.geoms) if hasattr(poly,'geoms') else [poly]:
        component=orient(component,sign=1)
        for tri in constrained_delaunay_triangles(component).geoms:
            pts=list(orient(tri,sign=1).exterior.coords)[:-1]
            face('roof',[(x,y,top) for x,y in pts]);face('base',[(x,y,bottom) for x,y in reversed(pts)])
        for ring in [component.exterior,*component.interiors]:
            ps=list(ring.coords)[:-1]
            for a,b in zip(ps,ps[1:]+ps[:1]):
                a,b=np.array(a),np.array(b);delta=b-a;length=np.linalg.norm(delta);norm=np.array([delta[1],-delta[0]])/length
                def point(u,z,inset=0):
                    xy=a+delta*u-norm*inset;return [*xy,z]
                def panel(u,v,lo,hi,role,inset=0):
                    face(role,[point(u,lo,inset),point(v,lo,inset),point(v,hi,inset),point(u,hi,inset)])
                if not windows or length<3:
                    panel(0,1,bottom,top,'wall');continue
                plinth=bottom+(top-bottom)*.18;ceiling=top-.55;step=(ceiling-plinth)/window_rows
                panel(0,1,bottom,plinth,'base');panel(0,1,ceiling,top,'wall')
                # Tall, narrow paired window groups, not continuous dark ribbons.
                bays=max(1,round(length/3.2))
                for row in range(window_rows):
                    lo=plinth+row*step;hi=lo+step;wl=lo+.18*step;wh=lo+.88*step
                    for bay in range(bays):
                        u,v=bay/bays,(bay+1)/bays;l=u+(v-u)*.18;r=v-(v-u)*.18;m=(l+r)/2;bar=(v-u)*.035
                        panel(u,v,lo,wl,'wall');panel(u,v,wh,hi,'wall');panel(u,l,wl,wh,'wall');panel(r,v,wl,wh,'wall')
                        panel(l,m-bar,wl,wh,'glass',.045);panel(m+bar,r,wl,wh,'glass',.045);panel(m-bar,m+bar,wl,wh,'wall')
    for role,(vs,ns,ts) in buffers.items():
        if not ts:continue
        mi=len(doc['meshes']);doc['meshes'].append({'name':role_name+'_'+role,'primitives':[{'attributes':{
         'POSITION':append(np.array(vs,dtype='<f4'),'VEC3',5126,34962),'NORMAL':append(np.array(ns,dtype='<f4'),'VEC3',5126,34962)},
         'indices':append(np.array(ts,dtype='<u4').reshape(-1),'SCALAR',5125,34963),'material':materials[role],'mode':4}]})
        ni=len(doc['nodes']);doc['nodes'].append({'name':role_name+'_'+role,'mesh':mi,'translation':origin.tolist(),
         'extras':{'feature_id':fid,'mesh_role':'roof' if role=='roof' else role,'academic_refinement_'+VERSION:True}})
        doc['nodes'][host].setdefault('children',[]).append(ni)
def replace_body(fid,poly):
    i=root(fid);zs=[]
    for j,_ in descendants(old,i):
        if 'mesh' in old['nodes'][j] and not old['nodes'][j].get('extras',{}).get('shape_review_reference_only'):
            for t in mesh_triangles(old,blob,old['nodes'][j],worlds[j]):zs.extend(t[:,2])
    bottom,top=min(zs),max(zs)
    ref=len(doc['nodes']);doc['nodes'].append({'name':'ACADEMIC_SOURCE_REFERENCE_'+str(i),'children':doc['nodes'][i].get('children',[])[:],
      'extras':{'shape_review_reference_only':True}})
    doc['nodes'][i]['children']=[ref];changed.add(i)
    geometry(i,fid,poly,bottom,top,'ACADEMIC_BODY_'+str(i),True)
    doc['nodes'][i].setdefault('extras',{}).update(**{'academic_refinement_'+VERSION:True},
      shape_status='PHOTO_TOPOLOGY_PLAN_REGISTERED_DIMENSIONS_ESTIMATED')
    if VERSION=='v006':doc['nodes'][i]['extras']['facade_window_layout']='STOREY_GROUPED_VERTICAL_WINDOWS' if doc['nodes'][i]['extras'].get('floor_count') in [4,5] else 'SINGLE_TALL_PANEL_UNKNOWN_STOREYS'
    return i,bottom,top
def portal(host,fid,poly,bottom,top,label):
    # Quad order: cross end, long side, cross end, long side.
    corners=np.array(list(poly.exterior.coords)[:-1]);a,b,c,d=corners
    def at(t,u):return (a*(1-u)+b*u)*(1-t)+(d*(1-u)+c*u)*t
    for t in [.06,.5,.94]:
        for u in ([.14,.86] if VERSION=='v006' else [.06,.94]):
            x,y=at(t,u);post=Polygon([(x-.45,y-.45),(x+.45,y-.45),(x+.45,y+.45),(x-.45,y+.45)])
            geometry(host,fid,post,bottom,top-.6,label+'_Pillar')
    geometry(host,fid,poly,top-.6,top,label+'_OverheadRoof')
    # Perimeter beams preserve full opening, no opaque box or floor at ground.
    for lo in [bottom+(top-bottom)*.5]:
        for u0,u1 in [(0,.04),(.96,1)]:
            strip=Polygon([at(0,u0),at(0,u1),at(1,u1),at(1,u0)])
            geometry(host,fid,strip,lo,lo+.35,label+'_FrameBeam')
    center=poly.centroid
    return {'footprint':mapping(poly),'centerLocal':[center.x,center.y],'clearanceEstimateMeters':top-bottom-.6,
     'postWidthEstimateMeters':.9,'bottomWorldZ':bottom,'topWorldZ':top}

if VERSION=='v005':
    d3='buildings:41e976045d6ae2f14056';south='buildings:61a517f42a95ddd995f8';diag='buildings:6ec99a0af367bfd980f4'
    west_poly=active_roof(old,blob,worlds,root(d3));south_poly=active_roof(old,blob,worlds,root(south));diag_poly=active_roof(old,blob,worlds,root(diag))
    west_link=trace([[3610,2270],[3635,2270],[3635,2310],[3610,2310]])
    d3_portal=trace([[3728,2328],[3751,2351],[3810,2292],[3787,2269]])
    assert west_link.intersection(west_poly).area>1 and west_link.intersection(south_poly).area>1
    assert d3_portal.intersection(south_poly).area>1 and d3_portal.intersection(diag_poly).area>1
    i,bot,top=replace_body(d3,unary_union([west_poly,south_poly,west_link]));j=root(south)
    doc['nodes'][j].setdefault('extras',{})['shape_review_reference_only']=True;changed.add(j)
    replace_body(diag,diag_poly)
    port=portal(i,d3,d3_portal,bot,top,'D3_OPEN_PORTAL')
    members=[d3,south,diag]
    for fid in members:doc['nodes'][root(fid)].setdefault('extras',{}).update(shape_review_display_id=d3,shape_review_group_members=members)
    roof_poly=unary_union([west_poly,south_poly,diag_poly,west_link,d3_portal]);assert roof_poly.geom_type=='Polygon'
    rows.append({'root':d3,'members':members[1:],'name':'D区3号楼','geometryLocal':mapping(roof_poly),'portal':port,
     'evidence':'User D-area aerial + 720yun bird view; registered plan locates connecting roof. Portal dimensions and west link height estimated.'})

    # B4+B6+B8-south share a historical GIS ID; keep B8 as a separate roof.
    b4='buildings:a50682221e1fa05f267b';b_poly=active_roof(old,blob,worlds,root(b4))
    b_portal=trace([[1747,5627],[1770,5650],[1831,5589],[1808,5566]])
    parts=list(b_poly.geoms);touch=[p for p in parts if p.intersection(b_portal).area>1]
    assert len(touch)==2,'Only B4 and diagonal B6 may connect; B8 must remain separate'
    bi,bb,bt=replace_body(b4,b_poly);bp=portal(bi,b4,b_portal,bb,bt,'B4_PLAN_PORTAL')
    b_roof=unary_union([b_poly,b_portal]);assert len(b_roof.geoms)==len(parts)-1
    rows.append({'root':b4,'members':[],'name':'B区4号楼、B区6号楼及B区8号楼南楼','geometryLocal':mapping(b_roof),'portal':bp,
     'evidence':'Registered plan hatched connecting section. Open-frame typology inferred from D3, NOT independently confirmed for B4; B8 south kept separate.'})
    # D2 photographed facade: same original roof and height, no invented link.
    d2='buildings:c4413d5a7dda1c0312d4';replace_body(d2,active_roof(old,blob,worlds,root(d2)))
else:
    previous=json.loads((P/'reference/buildings/academic_refinement_v005/manifest.json').read_text(encoding='utf-8'))
    rows=copy.deepcopy(previous['groups'])
    a4='buildings:2d7a6c32c34801f6495e'
    ids=[a4,'buildings:850755baf9695c35d6f0','buildings:6641d080d2168893daa4','buildings:73c56e34242855f03fa1']
    polys=[active_roof(old,blob,worlds,root(fid)) for fid in ids]
    host,bot,top=replace_body(a4,polys[0])
    for fid,poly in zip(ids[1:],polys[1:]):replace_body(fid,poly)
    traces=[
      ('A4_NORTH_LINK',[[3648,5444],[3648,5483],[3678,5483],[3678,5444]],0,1),
      ('A4_DIAGONAL_LINK',[[3734,5441],[3734,5486],[3780,5484],[3780,5439]],1,2),
      ('A4_WEST_LINK',[[3548,5554],[3563,5554],[3563,5590],[3548,5590]],0,3),
    ]
    links=[];portals=[]
    for label,pixels,left,right in traces:
        poly=trace(pixels)
        assert poly.intersection(polys[left]).area>1 and poly.intersection(polys[right]).area>1,(label,'Unsupported connection ends')
        links.append(poly);portals.append({'key':label,**portal(host,a4,poly,bot,top,label)})
    a4_roof=unary_union([*polys,*links]);assert a4_roof.geom_type=='Polygon'
    for fid in ids:
        doc['nodes'][root(fid)].setdefault('extras',{}).update(shape_review_display_id=a4,shape_review_group_members=ids)
    rows.append({'root':a4,'members':ids[1:],'name':'A区4号楼','geometryLocal':mapping(a4_roof),'portals':portals,
      'publicNote':'A4连接位置参考配准总图，柱梁架空形式和高度为推定，未获逐处实景确认；院落保留，原始GIS分块与分析不变。',
      'evidence':'Registered plan continuous/hatching junctions. Photo-derived academic facade type; individual A4 portal height and back faces still unconfirmed.'})
    facade_rows=[]
    for fid,name in [('buildings:5b1938051515754004ab','D区1号楼'),('buildings:5078c3f4fbe6712427a1','D区9号楼')]:
        poly=active_roof(old,blob,worlds,root(fid));replace_body(fid,poly)
        facade_rows.append({'id':fid,'name':name,'geometryLocal':mapping(poly),'status':'PHOTO_TYPE_FACADE_ONLY_ROOF_AND_HEIGHT_PRESERVED',
          'sourceStoreys':doc['nodes'][root(fid)]['extras'].get('floor_count'),'sourceHeightStatus':doc['nodes'][root(fid)]['extras'].get('height_status')})
doc['buffers'][0]['byteLength']=len(binary);doc['scenes'][doc.get('scene',0)].setdefault('extras',{}).update(shape_review_version=VERSION,academic_refinement_scope='A4 plan junctions; D1,D9 facade type estimates' if VERSION=='v006' else 'D3,B4 connectors; D2,D3,B4 facade estimates')
write_glb(OUT,doc,bytes(binary));new,nb=read_glb(OUT);nw,_=matrices(new)
checks={'protectedInputsUnchanged':before=={p:sha256(P/p) for p in protected},'originalBinaryPrefixExact':nb[:len(blob)]==blob,
 'unrelatedNodesExact':all(n==new['nodes'][i] for i,n in enumerate(old['nodes']) if i not in changed),
 'originalTransformsExact':all(np.array_equal(w,nw[i]) for i,w in worlds.items()),'projectedRepairRoofConnected':(a4_roof if VERSION=='v006' else roof_poly).geom_type=='Polygon'}
assert all(checks.values()),checks
OUT.with_suffix('.glb.gz').write_bytes(gzip.compress(OUT.read_bytes(),mtime=0))
manifest={'version':VERSION,'url':'/models/campus_shape_review_'+VERSION+'.glb','sha256':sha256(OUT),'groups':rows,
 'status':'PLAN_JUNCTIONS_WITH_PHOTO_TYPE_FACADES_ESTIMATED_DIMENSIONS' if VERSION=='v006' else 'PHOTO_TOPOLOGY_WITH_PLAN_AND_ESTIMATED_DIMENSIONS','limitations':['D3 open entrance topology confirmed in supplied aerial. Exact heights not surveyed.',
 'B4 open-frame style inferred; map connection confirmed, individual exterior photo still required.',
 '2D polygons are overhead roof projections, not closed ground footprints. Original GIS remains used for analysis.',
 'No claim that all campus buildings are now as-built.']}
if VERSION=='v006':
    manifest['facadeOnly']=facade_rows
    manifest['limitations'].append('A4 connection positions are map-supported; open-frame style and individual heights remain inferred.')
(D/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(D/'validation.json').write_text(json.dumps({'status':'PASS','checks':checks,'protectedInputs':before,'sha256':manifest['sha256'],'bytes':OUT.stat().st_size,'changedRoots':sorted(changed)},indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','hash':manifest['sha256'],'changedRoots':len(changed)}))
