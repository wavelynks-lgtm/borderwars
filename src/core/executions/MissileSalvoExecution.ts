import type { Game, Execution } from '../Game';
import type { Player } from '../Player';
import { build } from '../actions';
import { MessageType, UnitType, type TileRef } from '../types';

/** Paid launch orders wait for completed silos to reload; unsent shots can be refunded. */
export class MissileSalvoExecution implements Execution {
  readonly activeDuringSpawnPhase=false;
  private game!:Game;
  private active=true;
  readonly orders:{tile:TileRef;price:number}[];
  constructor(readonly owner:Player,readonly type:UnitType,orders:{tile:TileRef;price:number}[]){this.orders=orders.slice();}
  init(game:Game):void {this.game=game;}
  isActive():boolean{return this.active;}
  cancel():void {for(const order of this.orders)this.owner.gold+=order.price;this.orders.length=0;this.active=false;}
  tick():void {
    if(!this.active)return;
    if(!this.owner.alive){this.cancel();return;}
    const g=this.game;
    while(this.orders.length){
      const order=this.orders[0];
      const silos=this.owner.unitsOf(UnitType.MissileSilo).filter(s=>!s.constructing&&g.siloCanReach(s,order.tile));
      if(!g.map.isLand(order.tile)||!silos.length||g.config.isUnitDisabled(this.type)){
        this.owner.gold+=order.price;this.orders.shift();
        g.displayMessage("Queued missile refunded: target or silo unavailable",MessageType.Warn,this.owner.smallID);continue;
      }
      if(silos.every(s=>s.cooldownUntil>g.ticks))break;
      const result=build(g,this.owner,this.type,order.tile,true);
      if(!result.ok)break;
      this.orders.shift();
    }
    if(!this.orders.length)this.active=false;
  }
}
