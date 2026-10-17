import type { FeatureRepository } from '../repositories/FeatureRepository';

export class SelectionManager {
  private selected:string|null=null;
  private hovered:string|null=null;
  private listener:(selected:string|null,hovered:string|null)=>void=()=>{};
  constructor(private repository:FeatureRepository){}
  onChange(listener:(selected:string|null,hovered:string|null)=>void){this.listener=listener;this.emit();}
  private emit(){this.listener(this.selected,this.hovered);}
  select(id:string|null){
    const next=id&&this.repository.getById(id)?id:null;
    if(next!==this.selected){this.selected=next;this.emit();}
  }
  hover(id:string|null){
    const next=id&&this.repository.getById(id)?id:null;
    if(next!==this.hovered){this.hovered=next;this.emit();}
  }
  clear(){if(this.selected||this.hovered){this.selected=null;this.hovered=null;this.emit();}}
  getSelected(){return this.selected;}
  getHovered(){return this.hovered;}
}
