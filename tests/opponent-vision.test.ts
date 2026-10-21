import {describe,it,expect} from 'vitest';
import {detectOpponentVision,VisionConsensus,type VisionCalibration,type VisionBitmap} from '../src/recognition/opponent-vision';
function fixture(){
  let seed=7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
  const calibration:VisionCalibration={schema:1,width:2560,height:1440,windowId:'1',lobbyKey:'lobby',expiresAt:999999,mask:Array.from({length:529},(_,i)=>Number(i%23===Math.floor(i/23)||i%23===22-Math.floor(i/23))),references:[0,1,2,4,5,6,7].map(index=>({index,pixels:Array.from({length:3072},random)}))};
  const frame:VisionBitmap={width:150,height:900,data:new Uint8Array(150*900*4)};
  const top=(row:number)=>Math.round(279+row*(320/3)+(row>3?14:0));
  for(const ref of calibration.references){const row=ref.index;
    for(let y=0;y<32;y++)for(let x=0;x<32;x++)for(let c=0;c<3;c++)frame.data[((top(row)-31-220+y)*150+80+x)*4+c]=ref.pixels[(y*32+x)*3+c];
  }
  for(const row of [1,5])for(let y=0;y<23;y++)for(let x=0;x<23;x++)for(let c=0;c<3;c++)frame.data[((top(row)-220+y)*150+33+x)*4+c]=calibration.mask[y*23+x]*255;
  return {frame,calibration};
}
describe('calibrated opponent marker vision',()=>{
  it('matches avatar identities and marker pixels without sorting roster health',()=>{
    const {frame,calibration}=fixture();const result=detectOpponentVision(frame,calibration);
    expect(result?.candidates).toEqual([1,5]);expect(result?.rows).toHaveLength(7);
    // Portrait identities move with their pixels; native index ordering is irrelevant.
    [calibration.references[0].index,calibration.references[1].index]=[calibration.references[1].index,calibration.references[0].index];
    expect(detectOpponentVision(frame,calibration)?.candidates).toEqual([0,5]);
  });
  it('rejects hidden or duplicate portraits and incompatible image dimensions',()=>{
    const {frame,calibration}=fixture();frame.data.fill(0,((279-31-220)*150+80)*4,((279+1-220)*150+112)*4);
    expect(detectOpponentVision(frame,calibration)).toBeNull();
    const clean=fixture();clean.calibration.references[0].pixels=[...clean.calibration.references[1].pixels];
    expect(detectOpponentVision(clean.frame,clean.calibration)).toBeNull();
    expect(detectOpponentVision({...frame,width:149},calibration)).toBeNull();
  });
  it('requires separate agreeing observations and resets on round, lobby, missing evidence, or long gaps',()=>{
    const c=new VisionConsensus();expect(c.update('a','4-1',[1,2],1000)).toBe(false);
    expect(c.update('a','4-1',[2,1],1100)).toBe(false);expect(c.update('a','4-1',[1,2],2500)).toBe(true);
    expect(c.update('a','4-2',[1,2],3000)).toBe(false);expect(c.update('b','4-2',[1,2],4500)).toBe(false);
    expect(c.update('b','4-2',[1,2],6000)).toBe(true);expect(c.update('b','4-2',null,6100)).toBe(false);
    expect(c.update('b','4-2',[1,2],6500)).toBe(false);expect(c.update('b','4-2',[1,2],13000)).toBe(false);
  });
});
