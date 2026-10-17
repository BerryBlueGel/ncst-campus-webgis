import { Camera, Scene, HemisphereLight, DirectionalLight, WebGLRenderer, Matrix4, Vector3, Raycaster, type Object3D, type Material } from 'three';
import type { Map as GLMap, CustomLayerInterface, CustomRenderMethodInput } from 'maplibre-gl';
import { CAMPUS_3D_ID,CAMPUS_3D_MIN_ZOOM,initialThreeState,type CampusThreeState } from './CampusThreeConfig';
import { modelMatrix } from './CampusModelTransform';
import { ModelNodeIndex } from './ModelNodeIndex';
import { ThreeFeatureHighlighter } from './ThreeFeatureHighlighter';
import { disposeModel } from './ThreeResourceManager';
import { visibleInHierarchy } from './TeachingPlanModel';
import { type createCampusBuildingWorkPreview } from './CampusBuildingWorkPreview';
import type { FeatureRepository } from '../repositories/FeatureRepository';
import {type createCampusRenderBatches} from './CampusRenderBatches';
export class CampusThreeLayer implements CustomLayerInterface {
  readonly id=CAMPUS_3D_ID; readonly type='custom'; readonly renderingMode='3d';
  state=initialThreeState(); index=new ModelNodeIndex();
  private map?:GLMap;private renderer?:WebGLRenderer;private scene=new Scene();private camera=new Camera();
  private model?:Object3D;private ground=new Set<Material>();private abort=new AbortController();private destroyed=false;
  private highlighter?:ThreeFeatureHighlighter;private raycaster=new Raycaster();
  private selected:string|null=null;private hovered:string|null=null;
  private planEnabled=true;private teachingPreview?:ReturnType<typeof createCampusBuildingWorkPreview>;
  private groundEnabled=true;
  private renderBatches?:ReturnType<typeof createCampusRenderBatches>;
  private start=0;private sample=0;private frames=0;private lastFrame=0;
  constructor(private changed:(s:CampusThreeState)=>void,private features?:FeatureRepository){}
  private emit(){this.changed({...this.state,environment:{...this.state.environment}});}
  onAdd(map:GLMap,gl:WebGL2RenderingContext){
    this.map=map;
    try {
      this.renderer=new WebGLRenderer({canvas:map.getCanvas(),context:gl,antialias:true,logarithmicDepthBuffer:false,reversedDepthBuffer:false});
      this.renderer.autoClear=false;this.renderer.shadowMap.enabled=false;
      const sky=new HemisphereLight(0xffffff,0x7b8670,1.2);sky.position.set(0,0,1);this.scene.add(sky);
      const sun=new DirectionalLight(0xffffff,1.1);sun.position.set(-500,-800,1500);this.scene.add(sun);
      const info=gl.getExtension('WEBGL_debug_renderer_info');
      this.state.environment={webgl:gl.getParameter(gl.VERSION),renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),clipControl:!!gl.getExtension('EXT_clip_control'),depthBits:gl.getParameter(gl.DEPTH_BITS),antialias:gl.getContextAttributes()?.antialias,normalSharedDepth:true,canvasCount:1,userAgent:navigator.userAgent};
      this.renderer.resetState();this.emit();
      if(this.state.visible)void this.load();
    }catch(e){this.fail(e);}
  }
  private fail(e:unknown){this.state.status='error';this.state.error=e instanceof Error?e.message:String(e);this.emit();}
  private async load(){
    if(this.state.status==='loading'||this.state.status==='ready'||this.destroyed)return;
    this.state.status='loading';this.state.error=undefined;this.start=performance.now();this.emit();
    try{
      const {loadCampus}=await import('./CampusModelLoader');
      // The user can leave the map while this optional chunk is downloading.
      if(this.destroyed)return;
      const result=await loadCampus(this.abort.signal,this.features?.getAll());
      if(this.destroyed){disposeModel(result.scene);return;}
      this.model=result.scene;this.scene.add(result.scene);this.index=result.index;this.ground=result.ground;
      this.setGroundOffset(this.groundEnabled);
      this.teachingPreview=result.teachingPreview;this.teachingPreview.setEnabled(this.planEnabled);
      this.renderBatches=result.renderBatches;this.state.environment.renderBatches=result.renderBatches.stats;
      this.state.environment.loadStages=result.stages;
      this.highlighter=new ThreeFeatureHighlighter(this.index);this.highlighter.set(this.selected,this.hovered);
      Object.assign(this.state,{status:'ready',loadMs:result.loadMs,nodes:result.nodes,groundMaterials:result.ground.size,alignment:result.alignment});
      this.emit();this.map?.triggerRepaint();
    }catch(e){if(!this.destroyed)this.fail(e);}
  }
  setVisible(visible:boolean){this.state.visible=visible;if(visible&&this.renderer)void this.load();this.emit();this.map?.triggerRepaint();}
  setTeachingPlanPreview(enabled:boolean){this.planEnabled=enabled;this.teachingPreview?.setEnabled(enabled);this.map?.triggerRepaint();}
  setGroundOffset(enabled:boolean){this.groundEnabled=enabled;this.ground.forEach(m=>{if(m.polygonOffset!==enabled){m.polygonOffset=enabled;m.needsUpdate=true;}});this.map?.triggerRepaint();}
  setHighlight(selected:string|null,hovered:string|null){
    if(this.selected===selected&&this.hovered===hovered)return;
    this.selected=selected;this.hovered=hovered;this.highlighter?.set(selected,hovered);this.map?.triggerRepaint();
  }
  pick(point:{x:number;y:number}):{id:string;node:string}|null{
    if(!this.map||!this.model||!this.state.visible||this.state.zoomSuppressed||this.state.status!=='ready')return null;
    const canvas=this.map.getCanvas(),width=canvas.clientWidth,height=canvas.clientHeight;
    if(!width||!height)return null;
    const x=point.x/width*2-1,y=1-point.y/height*2;
    // This camera is configured by render() from the MapLibre custom-layer matrices.
    // Unproject NDC through that same shared projection and model transform.
    const inverse=new Matrix4().multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse).invert();
    const near=new Vector3(x,y,-1).applyMatrix4(inverse),far=new Vector3(x,y,1).applyMatrix4(inverse);
    this.raycaster.set(near,far.sub(near).normalize());this.raycaster.near=0;this.raycaster.far=1e7;
    this.raycaster.params.Line.threshold=0.15;
    for(const hit of this.raycaster.intersectObjects(this.index.visiblePickMeshes(),false)){
      if(!visibleInHierarchy(hit.object))continue;
      const id=this.index.resolveFeatureId(hit.object);if(id)return {id,node:hit.object.name};
    }
    return null;
  }
  render(_gl:WebGL2RenderingContext,args:CustomRenderMethodInput){
    const zoom=this.map!.getZoom();const suppressed=this.state.zoomSuppressed?zoom<CAMPUS_3D_MIN_ZOOM+0.2:zoom<CAMPUS_3D_MIN_ZOOM-0.2;
    if(suppressed!==this.state.zoomSuppressed){this.state.zoomSuppressed=suppressed;this.emit();}
    if(!this.state.visible||suppressed||this.state.status!=='ready'||!this.renderer)return;
    try{
      this.camera.projectionMatrix.fromArray(args.projectionMatrix);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      this.camera.matrixAutoUpdate=false;this.camera.matrixWorldAutoUpdate=false;
      this.camera.matrixWorldInverse.copy(this.camera.projectionMatrixInverse)
        .multiply(new Matrix4().fromArray(args.defaultProjectionData.mainMatrix)).multiply(modelMatrix);
      this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
      this.renderer.resetState();this.renderer.render(this.scene,this.camera);
      const now=performance.now();
      if(this.state.firstRenderMs===null){this.state.firstRenderMs=now-this.start;this.sample=now;this.emit();}
      if(now-this.lastFrame>250){this.frames=0;this.sample=now;}
      this.lastFrame=now;this.frames++;
      if(now-this.sample>400){this.state.fps=Math.round((this.frames-1)*1000/(now-this.sample));this.frames=0;this.sample=now;this.emit();}
      // Continuous sampling only while map animates; no perpetual idle GPU repaint.
    }catch(e){this.fail(e);}finally{this.renderer.resetState();}
  }
  onRemove(){this.destroyed=true;this.abort.abort();this.highlighter?.dispose();this.renderBatches?.dispose();if(this.model)disposeModel(this.model);this.scene.clear();this.index.clear();this.ground.clear();this.renderer?.dispose();this.renderer=undefined;this.map=undefined;}
}
