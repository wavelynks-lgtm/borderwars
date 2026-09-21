import {h} from './dom';

export class MissilePlanner {
  private label=h('span',{},'');
  private mark=h('button',{onClick:()=>this.onMark()},'Mark multiple targets');
  private launch=h('button',{onClick:()=>this.onLaunch()},'Launch salvo');
  private undo=h('button',{onClick:()=>this.onUndo()},'Undo target');
  private cancel=h('button',{onClick:()=>this.onCancel()},'Cancel');
  readonly el:HTMLElement;
  constructor(container:HTMLElement,private onMark:()=>void,private onLaunch:()=>void,private onUndo:()=>void,private onCancel:()=>void){
    this.el=h('div',{class:'missile-planner',hidden:true},this.label,this.mark,this.undo,this.launch,this.cancel);container.appendChild(this.el);
  }
  update(armed:boolean,planning:boolean,count:number,queued:boolean):void {
    this.el.hidden=!armed&&!queued;
    this.label.textContent=queued?`${count} missiles queued · waiting for ready silos`:planning?`${count} targets marked · click land to add`:'Choose a target, or plan a salvo';
    this.mark.hidden=planning||queued;this.undo.hidden=!planning||queued;this.launch.hidden=!planning||queued;
    (this.launch as HTMLButtonElement).disabled=count===0;
    (this.undo as HTMLButtonElement).disabled=count===0;
    this.cancel.textContent=queued?'Cancel remaining & refund':'Cancel';
  }
}
