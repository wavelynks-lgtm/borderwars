import { h } from './dom';

/** Compositor-animated pixel globe stays moving while CPU/GPU setup is busy. */
export class WorldLoading {
  readonly el: HTMLElement;
  private status=h('div',{class:'world-loading-status',role:'status','aria-live':'polite'},'Preparing the world…');
  private bar=h('div',{class:'world-loading-fill'});
  private progress=h('div',{class:'world-loading-track',role:'progressbar','aria-label':'World preparation','aria-valuemin':'0','aria-valuemax':'100'});
  private value=0;
  constructor(container:HTMLElement){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=40;canvas.className='world-loading-planet';canvas.setAttribute('aria-hidden','true');
    const ctx=canvas.getContext('2d')!;
    for(let y=0;y<40;y++)for(let x=0;x<40;x++){
      const dx=(x-19.5)/19,dy=(y-19.5)/19;if(dx*dx+dy*dy>1)continue;
      const land=Math.sin(x*.33+Math.sin(y*.28)*2)+Math.cos(y*.38+x*.12)>0.35;
      ctx.fillStyle=land?(dx<0?'#a8e66c':'#5cad62'):(dx<0?'#409ed8':'#205a91');ctx.fillRect(x,y,1,1);
    }
    this.progress.appendChild(this.bar);
    this.el=h('div',{class:'world-loading','aria-busy':'true'},
      h('div',{class:'world-loading-card'},h('div',{class:'world-loading-orbit'},canvas,h('i',{class:'world-loading-satellite','aria-hidden':'true'})),
      h('div',{class:'world-loading-title'},'BUILDING YOUR WORLD'),this.status,this.progress,
      h('div',{class:'world-loading-hint'},'Preparing every commander before the countdown begins')));
    container.appendChild(this.el);this.set('Preparing the world…',2);
  }
  set(message:string,percent:number):void {
    this.value=Math.max(this.value,Math.min(100,percent));this.status.textContent=message;
    this.bar.style.transform=`scaleX(${this.value/100})`;this.progress.setAttribute('aria-valuenow',String(Math.round(this.value)));
  }
  fail(error:unknown):void {
    this.el.setAttribute('aria-busy','false');this.status.textContent=`Could not prepare the world: ${error instanceof Error?error.message:String(error)}`;
    this.el.querySelector('.world-loading-card')!.appendChild(h('button',{onClick:()=>location.reload()},'Try again'));
  }
  finish():void {this.el.remove();}
}

export const loadingFrame = ():Promise<void> => new Promise(resolve=>requestAnimationFrame(()=>resolve()));
