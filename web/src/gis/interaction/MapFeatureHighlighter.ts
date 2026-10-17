import type { Map as GLMap, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureRepository } from '../repositories/FeatureRepository';
import type { GisBinding } from '../../types/CampusFeature';
import { SOURCE_FRAGMENT_LAYER } from '../layers/SourceFragmentDisplay';
import {reviewedDisplayId as planDisplayId} from '../layers/CampusCompoundDisplay';

export class MapFeatureHighlighter {
  private selected:string|null=null;private hovered:string|null=null;
  private selectedBindings:GisBinding[]=[];private hoverBindings:GisBinding[]=[];
  constructor(private map:GLMap,private repository:FeatureRepository,private planPreview:()=>boolean=()=>false){}
  install(){
    const state=(defaultValue:unknown,hoverValue:unknown,selectedValue:unknown)=>
      ['case',['boolean',['feature-state','selected'],false],selectedValue,
        ['boolean',['feature-state','hover'],false],hoverValue,defaultValue] as ExpressionSpecification;
    if(this.map.getLayer('buildings-fill')){
      this.map.setPaintProperty('buildings-fill','fill-color',state(['match',['get','kind'],'schematic-connection','#b0cbd8','#b9c3b9'],'#a5d9f5','#49b4ed'));
      this.map.setPaintProperty('buildings-fill','fill-outline-color',state('#869087','#478bb4','#075985'));
    }
    if(this.map.getLayer(SOURCE_FRAGMENT_LAYER))
      this.map.setPaintProperty(SOURCE_FRAGMENT_LAYER,'line-color',state('#b7791f','#a16207','#b45309'));
    if(this.map.getLayer('sports-fill')){
      const original=['match',['get','kind'],'football_pitch','#719578','#a86e60'];
      this.map.setPaintProperty('sports-fill','fill-color',state(original,'#a5d9f5','#49b4ed'));
    }
    for(const [layer,radius] of [['landmarks-circle',4],['poi-circle',7]] as const){
      if(!this.map.getLayer(layer))continue;
      this.map.setPaintProperty(layer,'circle-radius',state(radius,radius+3,radius+5));
      this.map.setPaintProperty(layer,'circle-stroke-color',state('#f7f5eb','#478bb4','#075985'));
      this.map.setPaintProperty(layer,'circle-stroke-width',state(1.5,2.5,3));
    }
  }
  private bindings(id:string|null){return (id?this.repository.getById(id)?.gisBindings??[]:[]).map(binding=>
    this.planPreview()&&binding.source==='campus-buildings'?{...binding,id:planDisplayId(String(binding.id))}:binding);}
  private set(bindings:GisBinding[],key:'selected'|'hover',value:boolean){
    for(const binding of bindings){
      if(!this.map.getSource(binding.source))continue;
      this.map.setFeatureState({source:binding.source,id:binding.id},{[key]:value});
    }
  }
  update(selected:string|null,hovered:string|null,force=false){
    if(force||selected!==this.selected){this.set(this.selectedBindings,'selected',false);this.selected=selected;this.selectedBindings=this.bindings(selected);this.set(this.selectedBindings,'selected',true);}
    if(force||hovered!==this.hovered){this.set(this.hoverBindings,'hover',false);this.hovered=hovered;this.hoverBindings=this.bindings(hovered);this.set(this.hoverBindings,'hover',true);}
  }
  clear(){this.update(null,null);}
}
