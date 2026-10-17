import { point,polygon } from '@turf/turf';
import type { Feature,Geometry,MultiPolygon,Polygon } from 'geojson';
import type { Map, MapMouseEvent } from 'maplibre-gl';
import type { FeatureRepository } from '../repositories/FeatureRepository';
import { AnalysisCatalog } from './AnalysisCatalog';
import { coordinatePick,featuresInside,makeBuffer,measureArea,measureDistance,nearestFeature,
  pointInside,polygonIntersection,queryBBox,validPoint } from './AnalysisGeometry';
import { featureGeometry } from './FeatureGeometryAdapter';
import { formatArea,formatDistance } from './AnalysisFormatter';
import { AnalysisLayerRenderer } from './render/AnalysisLayerRenderer';
import { INITIAL_ANALYSIS_STATE,type AnalysisState,type AnalysisTool,type LngLat,type NearestCategory } from './AnalysisTypes';

type Listener=(state:AnalysisState)=>void;
export class AnalysisManager {
  private map?:Map;
  private renderer=new AnalysisLayerRenderer();
  private listeners=new Set<Listener>();
  private state:AnalysisState={...INITIAL_ANALYSIS_STATE,points:[],resultFeatures:[]};
  private previousDoubleClick=true;
  readonly catalog:AnalysisCatalog;
  constructor(private repository:FeatureRepository,private selectedId:()=>string|null){this.catalog=new AnalysisCatalog(repository);}
  getState(){return this.state;}
  onChange(listener:Listener){this.listeners.add(listener);listener(this.state);return()=>this.listeners.delete(listener);}
  private update(patch:Partial<AnalysisState>){this.state={...this.state,...patch};this.renderer.update(this.state);this.listeners.forEach(fn=>fn(this.state));}
  private resetGeometry(){return {points:[] as LngLat[],inputGeometry:null,resultGeometry:null,resultFeatures:[],measurement:null,error:''};}
  isInteracting(){return this.state.activeTool!==null;}
  async load(){await this.catalog.load();}
  attach(map:Map){this.detach();this.map=map;this.renderer.attach(map);this.renderer.update(this.state);
    map.on('click',this.onClick);map.on('dblclick',this.onDoubleClick);}
  detach(){if(!this.map)return;this.map.off('click',this.onClick);this.map.off('dblclick',this.onDoubleClick);
    if(this.previousDoubleClick)this.map.doubleClickZoom.enable();this.renderer.detach();this.map=undefined;}
  activateTool(tool:AnalysisTool){
    if(this.map&&this.state.activeTool===null){this.previousDoubleClick=this.map.doubleClickZoom.isEnabled();this.map.doubleClickZoom.disable();}
    this.update({...this.resetGeometry(),activeTool:tool,status:'drawing',hint:this.hint(tool),
      targetId:tool==='intersection'?'green:auto':tool==='pip'?'boundary:campus':this.state.targetId});
  }
  private hint(tool:AnalysisTool){return ({coordinate:'点击地图读取坐标',distance:'依次点击各点，双击或按完成结束',area:'至少点击三个顶点，双击或按完成结束',
    buffer:'点击地图选定缓冲中心，或缓冲已选要素',nearest:'点击地图查找最近要素',bbox:'点击范围的两个对角',pip:'选目标面，再点击地图判定',intersection:'绘制多边形并选择目标面，或直接计算两个目标面'})[tool];}
  cancel(){if(this.map&&this.previousDoubleClick)this.map.doubleClickZoom.enable();this.update({...this.resetGeometry(),activeTool:null,status:'idle',hint:'已取消分析工具'});}
  clear(){this.update({...this.resetGeometry(),status:this.state.activeTool?'drawing':'idle',hint:this.state.activeTool?this.hint(this.state.activeTool):'已清除分析结果'});}
  undo(){const points=this.state.points.slice(0,-1);this.update({...this.resetGeometry(),points,status:this.state.activeTool?'drawing':'idle'});
    if(points.length>=2&&this.state.activeTool==='distance')this.liveDistance(points);}
  private fail(error:unknown){this.update({status:'error',error:error instanceof Error?error.message:String(error),measurement:null,resultGeometry:null,resultFeatures:[]});}
  setRadius(radius:number){
    try{
      if(!Number.isFinite(radius)||radius<=0||radius>5000)throw Error('缓冲半径须在 0–5000 米之间');
      const source=this.state.activeTool==='buffer'?this.state.inputGeometry:null;
      this.update({bufferRadius:radius});
      if(source)this.runBuffer(source);
    }catch(error){this.fail(error);}
  }
  setCategory(category:NearestCategory){this.update({nearestCategory:category});
    try{if(this.state.activeTool==='nearest'&&this.state.points[0])this.runNearest(this.state.points[0]);}catch(error){this.fail(error);}}
  setTarget(id:string){this.update({targetId:id});
    try{
      if(this.state.activeTool==='pip'&&this.state.points[0])this.runPip(this.state.points[0]);
      else if(this.state.activeTool==='intersection'&&this.state.inputGeometry){
        this.runIntersection(this.state.inputGeometry as Feature<Polygon|MultiPolygon>,performance.now());
      }
    }catch(error){this.fail(error);}
  }
  setSource(id:string){this.update({sourceId:id});}
  addPoint(location:LngLat){
    if(!this.state.activeTool)return;
    try{
      if(!validPoint(location))throw Error('经纬度无效');
      const tool=this.state.activeTool;
      // Single-point tools replace their input. A completed drawing starts a new
      // session on the next click rather than silently reusing the old result.
      const previous=['coordinate','buffer','nearest','pip'].includes(tool)||this.state.status==='ready'?[]:this.state.points;
      const last=previous.at(-1);
      if(last&&Math.hypot(last[0]-location[0],last[1]-location[1])<1e-8&&['distance','area','intersection'].includes(this.state.activeTool))return;
      const points=[...previous,location];
      this.update({...this.resetGeometry(),points,status:'drawing'});
      if(tool==='coordinate')this.runCoordinate(location);
      else if(tool==='distance'){if(points.length>=2)this.liveDistance(points);}
      else if(tool==='area'){
        if(points.length>=3){const result=measureArea(points);this.update({measurement:{kind:'area',primary:formatArea(result.turfSquareMeters),details:{'UTM 平面面积':formatArea(result.utmSquareMeters),'差值':`${result.differenceSquareMeters.toFixed(3)} m²`,'相对差':`${result.relativeDifferencePercent.toFixed(4)}%`},elapsedMs:0,raw:result}});}
      }
      else if(tool==='buffer')this.bufferPoint(location);
      else if(tool==='nearest')this.runNearest(location);
      else if(tool==='bbox'&&points.length===2)this.complete();
      else if(tool==='pip')this.runPip(location);
    }catch(error){this.fail(error);}
  }
  private runCoordinate(location:LngLat){const result=coordinatePick(location);
    this.update({status:'ready',resultGeometry:point(location),measurement:{kind:'coordinate',primary:`${location[0].toFixed(6)}, ${location[1].toFixed(6)}`,
      details:{'WGS84':`${location[0].toFixed(6)}, ${location[1].toFixed(6)}`,'UTM 50N':`E ${result.utm[0].toFixed(3)}, N ${result.utm[1].toFixed(3)}`,
        'Campus Local':`X ${result.local[0].toFixed(3)}, North ${result.local[1].toFixed(3)}`},elapsedMs:0}});}
  private liveDistance(points:LngLat[]){const r=measureDistance(points);this.update({measurement:{kind:'distance',primary:formatDistance(r.turfMeters),
    details:{'UTM 平面距离':formatDistance(r.utmMeters),'差值':`${r.differenceMeters.toFixed(3)} m`,'输入点':points.length},elapsedMs:0,raw:r}});}
  complete(){
    try{const tool=this.state.activeTool,points=this.state.points,start=performance.now();if(!tool)return;
      if(tool==='distance'){const r=measureDistance(points);this.update({inputGeometry:r.geometry,status:'ready',measurement:{kind:'distance',primary:formatDistance(r.turfMeters),
        details:{'UTM 平面距离':formatDistance(r.utmMeters),'差值':`${r.differenceMeters.toFixed(3)} m`,'输入点':points.length},elapsedMs:performance.now()-start,raw:r}});}
      else if(tool==='area'){const r=measureArea(points);this.update({inputGeometry:r.geometry,status:'ready',measurement:{kind:'area',primary:formatArea(r.turfSquareMeters),
        details:{'UTM 平面面积':formatArea(r.utmSquareMeters),'差值':`${r.differenceSquareMeters.toFixed(3)} m²`,'相对差':`${r.relativeDifferencePercent.toFixed(4)}%`},elapsedMs:performance.now()-start,raw:r}});}
      else if(tool==='bbox'){if(points.length!==2)throw Error('请选择两个对角点');const r=queryBBox(points[0],points[1],this.repository.getAll());
        this.update({inputGeometry:r.geometry,resultGeometry:r.geometry,resultFeatures:r.features,status:'ready',measurement:{kind:'bbox',primary:`找到 ${r.features.length} 个要素`,
          details:{'判定方式':'要素代表点位于框内'},elapsedMs:performance.now()-start}});}
      else if(tool==='intersection'){
        if(points.length<3)throw Error('相交分析至少需要三个顶点');const source=polygon([[...points,points[0]]]);
        this.runIntersection(source,start);
      }
    }catch(error){this.fail(error);}
  }
  private runIntersection(source:Feature<Polygon|MultiPolygon>,start:number){
    let target=this.catalog.get(this.state.targetId);
    let r;
    if(this.state.targetId==='green:auto'){
      const candidates=this.catalog.getGreen().map(item=>({item,result:polygonIntersection(source,item.feature)}))
        .filter(entry=>entry.result.intersects).sort((a,b)=>b.result.turfSquareMeters-a.result.turfSquareMeters);
      target=candidates[0]?.item;r=candidates[0]?.result;
    }else if(target)r=polygonIntersection(source,target.feature);
    if(!r)r={intersects:false,geometry:null,turfSquareMeters:0,utmSquareMeters:0};
    if(!target&&this.state.targetId!=='green:auto')throw Error('请选择有效的目标面');
    this.update({inputGeometry:source,resultGeometry:r.geometry,status:'ready',measurement:{kind:'intersection',primary:r.intersects?`相交 · ${formatArea(r.turfSquareMeters)}`:'不相交',
      details:{'目标':target?.name??'校内绿地','目标 ID':target?.id??'green:auto','UTM 交集面积':formatArea(r.utmSquareMeters)},elapsedMs:performance.now()-start,
      raw:{turfSquareMeters:r.turfSquareMeters,utmSquareMeters:r.utmSquareMeters}}});
  }
  intersectTargets(sourceId:string,targetId:string){try{const source=this.catalog.get(sourceId),target=this.catalog.get(targetId);
    if(!source||!target)throw Error('请选择两个有效的面要素');
    this.update({activeTool:'intersection',sourceId,targetId,points:[]});this.runIntersection(source.feature,performance.now());
  }catch(error){this.fail(error);}}
  private bufferPoint(location:LngLat){this.runBuffer(point(location));}
  bufferSelected(){try{const id=this.selectedId(),feature=id?this.repository.getById(id):undefined;
    if(!feature)throw Error('请先通过搜索或地图选择要素');this.activateTool('buffer');this.runBuffer(featureGeometry(feature));
  }catch(error){this.fail(error);}}
  private runBuffer(source:Feature<Geometry>){const start=performance.now();const radius=this.state.bufferRadius;
    const result=makeBuffer(source,radius),nearby=featuresInside(result,this.repository.getAll());
    this.update({inputGeometry:source,resultGeometry:result,resultFeatures:nearby,status:'ready',measurement:{kind:'buffer',primary:`${radius} m 缓冲区 · ${nearby.length} 个要素`,
      details:{'半径':formatDistance(radius),'附近要素':'面要素按代表点判定，非严格几何相交'},elapsedMs:performance.now()-start}});}
  private runNearest(location:LngLat){const start=performance.now(),r=nearestFeature(location,this.repository.getAll(),this.state.nearestCategory);
    this.update({inputGeometry:point(location),resultGeometry:r.line,resultFeatures:[r.feature],status:'ready',measurement:{kind:'nearest',
      primary:`${r.feature.name} · ${formatDistance(r.distanceMeters)}`,details:{'类别':r.feature.type,'距离策略':'按要素代表点计算'},elapsedMs:performance.now()-start,
      raw:{distanceMeters:r.distanceMeters}}});}
  private runPip(location:LngLat){const target=this.catalog.get(this.state.targetId);if(!target)throw Error('请选择目标面');
    const inside=pointInside(location,target.feature);this.update({inputGeometry:target.feature,resultGeometry:point(location),status:'ready',measurement:{kind:'pip',
      primary:inside?'位于目标面内':'位于目标面外',details:{'目标':target.name,'目标 ID':target.id,'Inside':inside},elapsedMs:0}});}
  getResult(){return this.state.measurement;}
  showComparisonGeometry(geometry:Feature<Geometry>|null){this.update({resultGeometry:geometry});}
  copyText(){const m=this.state.measurement;if(!m)return '';return [m.primary,...Object.entries(m.details).map(([k,v])=>`${k}: ${v}`)].join('\n');}
  private onClick=(event:MapMouseEvent)=>{if(this.isInteracting())this.addPoint([event.lngLat.lng,event.lngLat.lat]);};
  private onDoubleClick=(event:MapMouseEvent)=>{if(!this.isInteracting())return;event.preventDefault();
    if(['distance','area','intersection'].includes(this.state.activeTool!)){
      const p:[number,number]=[event.lngLat.lng,event.lngLat.lat],last=this.state.points.at(-1);
      if(!last||Math.hypot(last[0]-p[0],last[1]-p[1])>1e-7)this.addPoint(p);
      this.complete();
    }
  };
}
