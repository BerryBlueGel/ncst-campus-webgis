import {
  Box3, Color, DirectionalLight, HemisphereLight, Material, Mesh, PerspectiveCamera,
  Raycaster, Scene, Vector2, Vector3, WebGLRenderer, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ACTIVE_MODEL_HASH, ACTIVE_MODEL_URL } from '../CampusThreeConfig';
import { createCampusModelIndex, ModelNodeIndex } from '../ModelNodeIndex';
import { ThreeFeatureHighlighter } from '../ThreeFeatureHighlighter';
import { disposeModel } from '../ThreeResourceManager';
import type { FeatureRepository } from '../../repositories/FeatureRepository';
import { cameraNear, chooseRendererConfig, groundOffsetSign } from './ImmersiveRendererConfig';
import { overviewView } from './ImmersiveCameraPresets';
import { resolveFeatureView } from './ImmersiveFeatureNavigator';
import { NavigationGesture } from '../../interaction/NavigationGesture';
import { DemandRenderLoop } from './DemandRenderLoop';
import { constrainCampusPan } from './ImmersivePanConstraint';
import { hideDiagnosticContours,hideShapeReviewReferences } from '../CampusModelPresentation';
import { visibleInHierarchy, visibleModelBounds } from '../TeachingPlanModel';
import { createCampusBuildingWorkPreview } from '../CampusBuildingWorkPreview';
import {createCampusRenderBatches} from '../CampusRenderBatches';

export interface ImmersiveState {
  status:'idle'|'loading'|'ready'|'error';
  error?:string;loadMs:number;readyMs:number;fps:number;drawCalls:number;triangles:number;
  reversedDepthBuffer:boolean;clipControl:boolean;pixelRatio:number;nodeCount:number;
}
type View={target:Vector3;position:Vector3};
type Flight={start:number;duration:number;fromTarget:Vector3;fromPosition:Vector3;toTarget:Vector3;toPosition:Vector3};
type Callbacks={state:(state:ImmersiveState)=>void;pick:(id:string|null,node?:string)=>void;hover:(id:string|null,node?:string)=>void};

/** Standalone GLB coordinates are X=east, Y=north, Z=up. Never rotate the model. */
export class ImmersiveCampusViewer {
  readonly state:ImmersiveState={status:'idle',loadMs:0,readyMs:0,fps:0,drawCalls:0,triangles:0,
    reversedDepthBuffer:false,clipControl:false,pixelRatio:1,nodeCount:0};
  private scene=new Scene();
  private camera=new PerspectiveCamera(50,1,0.5,5000);
  private renderer?:WebGLRenderer;private controls?:OrbitControls;private model?:Object3D;
  private index=new ModelNodeIndex();private highlighter?:ThreeFeatureHighlighter;
  private raycaster=new Raycaster();private abort=new AbortController();private observer?:ResizeObserver;
  private loop?:DemandRenderLoop;private disposed=false;private selected:string|null=null;private hovered:string|null=null;
  private pendingFocus:string|null=null;private flight?:Flight;private gesture=new NavigationGesture();
  private controlsSettling=false;
  private frameCount=0;private sampleTime=0;private started=0;
  private campusBounds?:Box3;private lastHoverCheck=0;
  private replacedGround=new Set<Material>();
  private planEnabled=true;private teachingPreview?:ReturnType<typeof createCampusBuildingWorkPreview>;
  private renderBatches?:ReturnType<typeof createCampusRenderBatches>;
  setTeachingPlanPreview(enabled:boolean){this.planEnabled=enabled;this.teachingPreview?.setEnabled(enabled);this.startLoop();}
  constructor(private container:HTMLElement,private repository:FeatureRepository,private callbacks:Callbacks){}

  private emit(){this.callbacks.state({...this.state});}
  async mount(selected:string|null){
    this.selected=selected;this.pendingFocus=selected;this.started=performance.now();
    this.state.status='loading';this.emit();
    try {
      const canvas=document.createElement('canvas');canvas.className='immersive-canvas';canvas.tabIndex=0;
      this.container.appendChild(canvas);
      const context=canvas.getContext('webgl2',{antialias:true,alpha:false});
      if(!context)throw Error('此浏览器无法创建 WebGL2 渲染上下文');
      const clipControl=!!context.getExtension('EXT_clip_control');
      const config=chooseRendererConfig(clipControl,window.devicePixelRatio);
      this.renderer=new WebGLRenderer({canvas,context,antialias:config.antialias,
        reversedDepthBuffer:config.reversedDepthBuffer,logarithmicDepthBuffer:false});
      this.renderer.setPixelRatio(config.pixelRatio);this.renderer.shadowMap.enabled=false;
      this.loop=new DemandRenderLoop(this.render);
      if(document.hidden)this.loop.pause();
      this.state.clipControl=clipControl;
      this.state.reversedDepthBuffer=this.renderer.capabilities.reversedDepthBuffer;
      this.state.pixelRatio=config.pixelRatio;
      this.scene.background=new Color('#d9eefb');
      this.scene.add(new HemisphereLight(0xffffff,0x798a7e,1.45));
      const sun=new DirectionalLight(0xffffff,1.15);sun.position.set(-500,-800,1800);this.scene.add(sun);
      this.camera.up.set(0,0,1);
      this.controls=new OrbitControls(this.camera,canvas);
      this.controls.enableDamping=true;this.controls.dampingFactor=0.08;
      this.controls.enablePan=true;this.controls.screenSpacePanning=true;
      this.controls.minDistance=3;this.controls.maxDistance=4500;
      this.controls.maxPolarAngle=Math.PI/2-0.025;
      this.controls.listenToKeyEvents(canvas);
      this.controls.addEventListener('start',this.cancelFlight);
      this.controls.addEventListener('change',this.startLoop);
      canvas.addEventListener('pointerdown',this.pointerDown);
      canvas.addEventListener('pointerup',this.pointerUp);
      canvas.addEventListener('pointercancel',this.pointerCancel);
      canvas.addEventListener('pointermove',this.pointerMove);
      canvas.addEventListener('pointerleave',this.pointerLeave);
      canvas.addEventListener('webglcontextlost',this.contextLost);
      canvas.addEventListener('webglcontextrestored',this.contextRestored);
      this.observer=new ResizeObserver(this.resize);this.observer.observe(this.container);
      window.addEventListener('resize',this.resize);
      document.addEventListener('visibilitychange',this.visibilityChanged);
      this.resize();
      await this.loadModel();
    } catch(error) {if(!this.disposed){this.state.status='error';this.state.error=error instanceof Error?error.message:String(error);this.emit();}}
  }
  private async loadModel(){
    const started=performance.now();
    const response=await fetch(ACTIVE_MODEL_URL,{signal:this.abort.signal});
    if(!response.ok)throw Error(`校园模型加载失败（HTTP ${response.status}）`);
    const buffer=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
    if(hash!==ACTIVE_MODEL_HASH)throw Error('校园模型校验不符，请恢复当前配置对应文件');
    const {scene}=await new GLTFLoader().parseAsync(buffer,'/models/');
    if(this.disposed){disposeModel(scene);return;}
    hideDiagnosticContours(scene);
    hideShapeReviewReferences(scene);
    this.teachingPreview=createCampusBuildingWorkPreview(scene,this.repository.getAll());this.teachingPreview.setEnabled(this.planEnabled);
    this.model=scene;this.scene.add(scene);
    this.campusBounds=visibleModelBounds([scene]);
    this.index=createCampusModelIndex(scene,this.repository.getAll());
    this.renderBatches=createCampusRenderBatches(scene);
    this.highlighter=new ThreeFeatureHighlighter(this.index);
    this.highlighter.set(this.selected,null);
    const sign=groundOffsetSign(this.state.reversedDepthBuffer);
    scene.traverse(object=>{
      const mesh=object as Mesh;
      if(!mesh.isMesh||!mesh.material)return;
      let ground=false;for(let node:Object3D|null=object;node;node=node.parent)if(/Ground/i.test(node.name))ground=true;
      if(!ground)return;
      // The source terrain can sit a little above flat sports/road overlays.
      // Draw it as a backdrop, without letting it occlude those mapped surfaces.
      mesh.renderOrder=-100;
      const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      originals.forEach(material=>this.replacedGround.add(material));
      const patched=originals.map(material=>{const copy=material.clone();copy.polygonOffset=true;copy.depthWrite=false;
        copy.polygonOffsetFactor=sign;copy.polygonOffsetUnits=sign;return copy;});
      mesh.material=Array.isArray(mesh.material)?patched:patched[0];
    });
    this.state.nodeCount=0;scene.traverse(()=>this.state.nodeCount++);
    this.state.loadMs=performance.now()-started;
    this.state.readyMs=performance.now()-this.started;
    this.state.status='ready';this.emit();
    if(this.pendingFocus)this.focusFeature(this.pendingFocus,false);else this.focusOverview(false);
    this.pendingFocus=null;this.startLoop();
  }
  private resize=()=>{
    if(!this.renderer)return;
    const width=Math.max(1,this.container.clientWidth),height=Math.max(1,this.container.clientHeight);
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height,false);
    this.startLoop();
  };
  private cancelFlight=()=>{this.flight=undefined;this.startLoop();};
  private visibilityChanged=()=>{if(document.hidden)this.loop?.pause();else this.loop?.resume();};
  private startLoop=()=>{if(!this.disposed&&!document.hidden&&this.state.status==='ready')this.loop?.request();};
  private render=(now:number)=>{
    if(this.disposed||document.hidden||this.state.status!=='ready'||!this.renderer||!this.controls)return false;
    if(!this.frameCount){this.sampleTime=now;}
    if(this.flight){
      const progress=Math.min(1,(now-this.flight.start)/this.flight.duration),eased=1-Math.pow(1-progress,3);
      this.camera.position.copy(this.flight.fromPosition).lerp(this.flight.toPosition,eased);
      this.controls.target.copy(this.flight.fromTarget).lerp(this.flight.toTarget,eased);
      if(progress>=1)this.flight=undefined;
    }
    const changed=this.controls.update();this.controlsSettling=changed;
    if(this.campusBounds)constrainCampusPan(this.camera.position,this.controls.target,this.campusBounds);
    const distance=this.camera.position.distanceTo(this.controls.target),near=cameraNear(distance);
    if(this.camera.near!==near){this.camera.near=near;this.camera.updateProjectionMatrix();}
    this.renderer.render(this.scene,this.camera);
    const animating=!!this.flight||changed;
    this.frameCount++;
    if(now-this.sampleTime>=1000||!animating){this.state.fps=animating?Math.round(this.frameCount*1000/(now-this.sampleTime)):0;
      this.state.drawCalls=this.renderer.info.render.calls;this.state.triangles=this.renderer.info.render.triangles;
      this.frameCount=0;this.sampleTime=now;this.emit();}
    return animating;
  };
  private fly(view:View,smooth:boolean){
    if(!this.controls)return;
    if(!smooth){this.flight=undefined;this.controls.target.copy(view.target);this.camera.position.copy(view.position);this.controls.update();this.startLoop();return;}
    this.flight={start:performance.now(),duration:1050,fromTarget:this.controls.target.clone(),
      fromPosition:this.camera.position.clone(),toTarget:view.target,toPosition:view.position};
    this.startLoop();
  }
  focusOverview(smooth=true){if(!this.model){this.pendingFocus=null;return;}
    this.fly(overviewView(this.campusBounds!),smooth);
  }
  focusFeature(id:string,smooth=true){
    if(!this.model){this.pendingFocus=id;return false;}
    const view=resolveFeatureView(this.repository.getById(id),this.index);
    if(!view){this.focusOverview(smooth);return false;}
    this.fly(view,smooth);return true;
  }
  setSelection(id:string|null){this.selected=id;this.highlighter?.set(id,this.hovered);this.startLoop();}
  private pickAt(clientX:number,clientY:number){
    if(!this.renderer||!this.model||!this.index.pickableObjects.length)return null;
    const rect=this.renderer.domElement.getBoundingClientRect();
    const pointer=new Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(pointer,this.camera);
    this.raycaster.params.Line.threshold=0.2;
    for(const hit of this.raycaster.intersectObjects(this.index.visiblePickMeshes(),false)){
      if(!visibleInHierarchy(hit.object))continue;
      const id=this.index.resolveFeatureId(hit.object);if(id)return {id,node:hit.object.name};
    }
    return null;
  }
  private pointerDown=(event:PointerEvent)=>{this.gesture.begin(event);};
  private pointerUp=(event:PointerEvent)=>{
    const click=this.gesture.end(event);
    if(!click)return;
    const result=this.pickAt(event.clientX,event.clientY);
    this.callbacks.pick(result?.id??null,result?.node);
  };
  private pointerCancel=()=>{this.gesture.cancel();};
  private pointerMove=(event:PointerEvent)=>{
    this.gesture.move(event);
    if(event.pointerType==='touch'||event.buttons||this.gesture.active||this.flight||this.controlsSettling)return;
    const now=performance.now();if(now-this.lastHoverCheck<50)return;this.lastHoverCheck=now;
    const result=this.pickAt(event.clientX,event.clientY),id=result?.id??null;
    if(id!==this.hovered){this.hovered=id;this.highlighter?.set(this.selected,id);this.callbacks.hover(id,result?.node);this.startLoop();}
    if(this.renderer)this.renderer.domElement.style.cursor=id?'pointer':'grab';
  };
  private pointerLeave=()=>{if(this.hovered){this.hovered=null;this.highlighter?.set(this.selected,null);this.callbacks.hover(null);this.startLoop();}};
  private contextLost=(event:Event)=>{event.preventDefault();this.stopLoop();this.state.status='error';
    this.state.error='3D 渲染上下文已丢失，请返回地图后重新进入';this.emit();};
  private contextRestored=()=>{this.state.status='error';this.state.error='3D 上下文已恢复，请返回地图后重新进入';this.emit();};
  private stopLoop(){this.loop?.pause();}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.loop?.dispose();this.gesture.cancel();this.abort.abort();
    document.removeEventListener('visibilitychange',this.visibilityChanged);
    window.removeEventListener('resize',this.resize);this.observer?.disconnect();
    this.controls?.removeEventListener('start',this.cancelFlight);this.controls?.removeEventListener('change',this.startLoop);this.controls?.dispose();
    const canvas=this.renderer?.domElement;
    canvas?.removeEventListener('pointerdown',this.pointerDown);canvas?.removeEventListener('pointerup',this.pointerUp);
    canvas?.removeEventListener('pointercancel',this.pointerCancel);
    canvas?.removeEventListener('pointermove',this.pointerMove);canvas?.removeEventListener('pointerleave',this.pointerLeave);
    canvas?.removeEventListener('webglcontextlost',this.contextLost);canvas?.removeEventListener('webglcontextrestored',this.contextRestored);
    this.highlighter?.dispose();
    this.renderBatches?.dispose();
    if(this.model){
      const active=new Set<Material>();this.model.traverse(object=>{const mesh=object as Mesh;
        if(mesh.isMesh&&mesh.material)(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>active.add(m));});
      disposeModel(this.model);
      for(const material of this.replacedGround)if(!active.has(material))material.dispose();
    }
    this.replacedGround.clear();this.index.clear();this.scene.clear();
    this.renderer?.dispose();this.renderer?.forceContextLoss();canvas?.remove();
    this.renderer=undefined;this.model=undefined;this.controls=undefined;
    this.campusBounds=undefined;
  }
}
