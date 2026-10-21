/** Experimental calibrated pixel reader. No game input and no inference from match history. */
export interface VisionBitmap {width:number;height:number;data:Uint8Array}
export interface VisionReference {index:number;pixels:number[]}
export interface VisionCalibration {schema:1;width:2560;height:1440;windowId:string;lobbyKey:string;expiresAt:number;mask:number[];references:VisionReference[]}
export interface VisionRows {rows:Array<{index:number;y:number}>;candidates:number[]}
const STRIP={x:2410,y:220,width:150,height:900};
export const visionStrip=STRIP;
function faceError(frame:VisionBitmap,top:number,reference:VisionReference){
  let best=Infinity;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    let error=0;
    for(let y=0;y<32;y+=4)for(let x=0;x<32;x+=4){
      const offset=((Math.round(top)-31-STRIP.y+dy+y)*frame.width+2490-STRIP.x+dx+x)*4,ref=(y*32+x)*3;
      for(let c=0;c<3;c++){const delta=frame.data[offset+c]-reference.pixels[ref+c];error+=delta*delta;}
    }
    best=Math.min(best,error/(64*3*255*255));
  }
  return best;
}
export function detectOpponentVision(frame:VisionBitmap,calibration:VisionCalibration):VisionRows|null{
  const enemies=calibration.references.length;
  if(frame.width!==STRIP.width||frame.height!==STRIP.height||frame.data.length!==frame.width*frame.height*4||enemies<1||enemies>7||calibration.mask.length!==529)return null;
  if(new Set(calibration.references.map(r=>r.index)).size!==enemies||calibration.references.some(r=>r.pixels.length!==3072))return null;
  // A complete visible portrait roster is required: an obscured candidate is never silently excluded.
  let layout:Array<{index:number;y:number}>|null=null;
  for(let local=0;local<=enemies;local++){
    const rows:Array<{index:number;y:number}>=[];
    for(let row=0;row<=enemies;row++){
      if(row===local)continue;
      const top=279+row*(320/3)+(row>local?14:0);
      const scores=calibration.references.map(ref=>({index:ref.index,error:faceError(frame,top,ref)})).sort((a,b)=>a.error-b.error);
      if(!Number.isFinite(scores[0].error)||scores[0].error>.012||(scores[1]?.error??Infinity)-scores[0].error<.02)break;
      rows.push({index:scores[0].index,y:top});
    }
    if(rows.length!==enemies||new Set(rows.map(r=>r.index)).size!==enemies)continue;
    if(layout)return null; // Multiple plausible layouts are ambiguous.
    layout=rows;
  }
  if(!layout)return null;
  const white=new Uint8Array(frame.width*frame.height);
  for(let i=0;i<white.length;i++){const p=i*4,a=frame.data[p],b=frame.data[p+1],c=frame.data[p+2];white[i]=Math.min(a,b,c)>155&&Math.max(a,b,c)-Math.min(a,b,c)<55?1:0;}
  const templateCount=calibration.mask.reduce((n,v)=>n+v,0);if(templateCount<40)return null;
  const candidates:number[]=[];
  for(const row of layout){
    let best=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      let count=0,intersection=0;
      for(let y=0;y<23;y++)for(let x=0;x<23;x++){
        const pixel=white[(Math.round(row.y)-STRIP.y+dy+y)*frame.width+2443-STRIP.x+dx+x];
        count+=pixel;intersection+=pixel*calibration.mask[y*23+x];
      }
      best=Math.max(best,2*intersection/(count+templateCount));
    }
    if(best>.84)candidates.push(row.index);
  }
  return {rows:layout,candidates:candidates.sort((a,b)=>a-b)};
}

export class VisionConsensus {
  private signature='';private observedAt=0;private confirmedAt=0;
  update(key:string,round:string,indices:number[]|null,now:number){
    const signature=indices?.length?JSON.stringify([key,round,[...indices].sort((a,b)=>a-b)]):'';
    if(!signature){this.signature='';this.observedAt=0;this.confirmedAt=0;return false;}
    if(signature!==this.signature||now<this.observedAt||now-this.observedAt>5000){this.signature=signature;this.observedAt=now;this.confirmedAt=0;return false;}
    if(now-this.observedAt>=500)this.confirmedAt=now;
    return this.confirmedAt>0;
  }
}
