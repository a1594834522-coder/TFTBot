import {detectOpponentVision,type VisionCalibration} from '../recognition/opponent-vision';
let calibration:VisionCalibration|null=null;
process.parentPort?.on('message',event=>{const message=event.data;if(message?.type==='init')calibration=message.calibration;
  else if(message?.type==='frame'){
    let result=null;try{if(calibration&&Array.isArray(message.activeIndices))result=detectOpponentVision(message.frame,{...calibration,references:calibration.references.filter(r=>message.activeIndices.includes(r.index))});}catch{}
    process.parentPort?.postMessage({id:message.id,round:message.round,at:message.at,result});
  }
});
