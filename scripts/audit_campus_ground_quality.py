"""Exact piecewise-linear ground/registered footprint audit. Does not edit models."""
import argparse, json, math, sys
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from integrate_library_v001_2 import read_glb, sha256, descendants

ROOT = Path(__file__).resolve().parents[1]
FORMAL_HASH = '7BD41728D1F2B1F5C631D853ABCB824841FC4F8E539B91CD08A0218C24FD3B65'
PREVIEW_HASH = '54590DBEECA01A0D5E71D01E21EAA9E2DB0485C21C456CAEF5C9492EDD7062A5'

def accessor(doc, binary, index):
    a = doc['accessors'][index]; v = doc['bufferViews'][a['bufferView']]
    assert not a.get('sparse'), 'Sparse accessors require a separate decoder'
    types = {5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
    widths = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
    dtype = np.dtype(types[a['componentType']]); width = widths[a['type']]
    return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize)).copy()

def matrices(doc):
    result = {}; parents = {}
    def visit(i, parent):
        n = doc['nodes'][i]
        if 'matrix' in n:
            local = np.array(n['matrix']).reshape(4,4,order='F')
        else:
            x,y,z,w = n.get('rotation',[0,0,0,1])
            local = np.eye(4)
            local[:3,:3] = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]) @ np.diag(n.get('scale',[1,1,1]))
            local[:3,3] = n.get('translation',[0,0,0])
        result[i] = parent @ local
        for child in n.get('children',[]): parents[child]=i; visit(child,result[i])
    for i in doc['scenes'][doc.get('scene',0)]['nodes']: visit(i,np.eye(4))
    return result,parents

def primitive_points(doc,binary,primitive,world):
    points = accessor(doc,binary,primitive['attributes']['POSITION'])
    return np.c_[points,np.ones(len(points))] @ world.T

def mesh_triangles(doc,binary,node,world):
    for p in doc['meshes'][node['mesh']]['primitives']:
        if p.get('mode',4)!=4: continue
        points = primitive_points(doc,binary,p,world)[:,:3]
        indices = accessor(doc,binary,p['indices']).reshape(-1) if 'indices' in p else np.arange(len(points))
        yield from points[indices.reshape(-1,3)]

def geometry_vertices(g):
    if g.is_empty: return []
    if hasattr(g,'geoms'): return [v for child in g.geoms for v in geometry_vertices(child)]
    if g.geom_type=='Polygon': return list(g.exterior.coords)+[p for r in g.interiors for p in r.coords]
    return list(g.coords)

def audit(model):
    doc,binary=read_glb(model); worlds,parents=matrices(doc)
    params={}
    for group in ['residential','teaching','other_areas']:
        data=json.loads((ROOT/f'reference/buildings/{group}_detail_v001/parameters.json').read_text(encoding='utf-8'))
        for a in data['assets']: params[a['id']]={**a,'group':group}
    ground_polys=[];ground_planes=[]
    for i,w in worlds.items():
        node=doc['nodes'][i]
        if 'mesh' not in node or 'TPX_Ground' not in node.get('name',''): continue
        for tri in mesh_triangles(doc,binary,node,w):
            xy=tri[:,:2]; poly=Polygon(xy)
            if poly.area<1e-8: continue
            # Height is linear on each source terrain triangle. Clipped vertices give exact extrema.
            plane=np.linalg.solve(np.c_[xy,np.ones(3)],tri[:,2])
            ground_polys.append(poly);ground_planes.append(plane)
    tree=STRtree(ground_polys); rows=[];footprints=[];root_indices=[]
    for i,w in worlds.items():
        node=doc['nodes'][i]; extras=node.get('extras',{}); fid=extras.get('feature_id')
        if not fid or 'mesh' in node: continue
        members=[j for j,_ in descendants(doc,i) if 'mesh' in doc['nodes'][j]]
        a=params.get(fid)
        if a: footprint=shape(a['geometry']); provenance='REGISTERED_PLAN'
        else:
            roof=[Polygon(tri[:,:2]) for j in members
                if doc['nodes'][j].get('extras',{}).get('mesh_role')=='roof'
                or 'roof' in doc['nodes'][j].get('name','').lower()
                for tri in mesh_triangles(doc,binary,doc['nodes'][j],worlds[j])
                if Polygon(tri[:,:2]).area>1e-8]
            footprint=unary_union(roof);provenance='WORKING_MODEL_ROOF_PROJECTION_NOT_AUTHORITY'
        assert footprint.is_valid and not footprint.is_empty,(fid,'invalid footprint')
        lows=[];highs=[];clips=[]
        for ti in tree.query(footprint,predicate='intersects'):
            clipped=ground_polys[ti].intersection(footprint)
            if clipped.area<1e-9: continue
            z=np.c_[np.array(geometry_vertices(clipped)),np.ones(len(geometry_vertices(clipped)))] @ ground_planes[ti]
            lows.append(float(z.min()));highs.append(float(z.max()));clips.append(clipped)
        covered=unary_union(clips).area if clips else 0
        base_nodes=[j for j in members if doc['nodes'][j].get('extras',{}).get('mesh_role')=='base']
        points=[primitive_points(doc,binary,p,worlds[j])[:,:3] for j in base_nodes
            for p in doc['meshes'][doc['nodes'][j]['mesh']]['primitives']]
        base=np.concatenate(points) if points else None
        bottom=float(base[:,2].min()) if base is not None else None
        top=float(base[:,2].max()) if base is not None else None
        low=min(lows) if lows else None;high=max(highs) if highs else None
        row={'id':fid,'name':extras.get('building_name',node['name']),'rootNode':i,
            'group':a['group'] if a else 'special','sourceKey':a.get('key',a.get('block')) if a else None,
            'footprintSource':provenance,'footprintAreaSqm':footprint.area,
            'groundCoveredFraction':min(1,covered/footprint.area),'groundTrianglesClipped':len(clips),
            'groundMinMeters':low,'groundMaxMeters':high,'groundRangeMeters':high-low if lows else None,
            'foundationBottomMeters':bottom,'foundationTopMeters':top,'baseNodes':base_nodes,
            'maximumPossibleBottomGapMeters':max(0,bottom-low) if bottom is not None and lows else None,
            'maximumTerrainAbovePlinthMeters':max(0,high-top) if top is not None and lows else None,
            'correctableTypeStudy':bool(a and base is not None and covered/footprint.area>.99999),
            'heightStatus':extras.get('height_status'),
            'floorCount':extras.get('floor_count',a.get('floorCount') if a else None),
            'floorCountStatus':extras.get('floor_count_status','UNKNOWN')}
        rows.append(row);footprints.append(footprint);root_indices.append(i)
    overlaps=[]
    for i,f in enumerate(footprints):
        for j in range(i+1,len(footprints)):
            if not f.intersects(footprints[j]):continue
            area=f.intersection(footprints[j]).area
            if area>.1:overlaps.append({'a':rows[i]['id'],'aName':rows[i]['name'],'b':rows[j]['id'],
                'bName':rows[j]['name'],'areaSqm':area,'status':'PROJECTED_OVERLAP_REVIEW_NOT_AUTOMATIC_MERGE'})
    return {'status':'AUDITED_NOT_AS_BUILT','model':str(model.relative_to(ROOT)),
        'sha256':sha256(model),'axis':'GLB_WORLD_X_EAST_Y_NORTH_Z_UP',
        'method':'Exact clipping of registered polygons (including holes) against piecewise-linear terrain triangles; linear extrema at clipped vertices. Special buildings use roof projection.',
        'counts':{'features':len(rows),'registeredFootprints':len(params),'terrainTriangles':len(ground_polys),
            'foundationGapOver10cm':sum((r['maximumPossibleBottomGapMeters'] or 0)>.1 for r in rows),
            'terrainAbovePlinthOver10cm':sum((r['maximumTerrainAbovePlinthMeters'] or 0)>.1 for r in rows),
            'projectedOverlapsOverPoint1Sqm':len(overlaps),
            'incompleteGroundCoverage':sum(r['groundCoveredFraction']<.99999 for r in rows)},
        'buildings':rows,'overlaps':overlaps,
        'limits':['Overlap check compares the 124 detailed working footprints, not all retained source references.',
            'Ground/model agreement is not survey accuracy. Foundation extrema are conservative where bases are not uniform.',
            'Special buildings are audited but not automatically edited. Unknown heights remain unknown.']}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--model',default='output/campus_detail_preview_v001.glb')
    parser.add_argument('--report',default='reference/buildings/quality_v002/ground_audit_before.json');args=parser.parse_args()
    dest=ROOT/args.report;assert not dest.exists(),f'Preserve existing report {dest}'
    assert sha256(ROOT/'output/campus_refined_v005.glb')==FORMAL_HASH
    assert sha256(ROOT/'output/campus_detail_preview_v001.glb')==PREVIEW_HASH
    report=audit(ROOT/args.model);dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report['counts'],ensure_ascii=False));print('report:',dest)

if __name__=='__main__':main()
