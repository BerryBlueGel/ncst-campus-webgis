/** Coalesce optional-module downloads, but re-check current intent before use.
 * Disposing is terminal; late imports must never recreate a removed map layer.
 */
export class DeferredActivation<T> {
  private pending?:Promise<void>;
  private disposed=false;
  constructor(private load:()=>Promise<T>,private wanted:()=>boolean,
    private activate:(value:T)=>void,private failed:(error:unknown)=>void){}
  request(){
    if(this.disposed||this.pending)return;
    this.pending=Promise.resolve().then(this.load).then(value=>{
      if(!this.disposed&&this.wanted())this.activate(value);
    }).catch(error=>{if(!this.disposed&&this.wanted())this.failed(error);})
      .finally(()=>{this.pending=undefined;});
  }
  dispose(){this.disposed=true;}
}
