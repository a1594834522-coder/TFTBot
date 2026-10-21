/** Recovered original trick CSS aspect-ratio presets (percentage of game window). */
export function shopOverlayLayout(width:number,height:number) {
  const ratio=Number((width/height).toFixed(2));
  const presets:Record<string,[number,number]>={'1.78':[28.9,52],'1.77':[28.9,52],'1.60':[22.1,57.8],'1.6':[22.1,57.8],'1.33':[16.8,69],'1.67':[23.2,55.5],'1.56':[22,58.5],'1.25':[14.6,73.5],'1.72':[24.3,53.4],'2.37':[31,39.1],'2.54':[32.6,36.2],'2.39':[31,39.1]};
  const [left,span]=presets[String(ratio)]??(ratio>1.78&&ratio<2?[26.6,48.5]:ratio>1.33&&ratio<1.5?[18,66.5]:ratio>=2.5&&ratio<=2.6?[32.1,37.1]:[25,52]);
  return {left:`${left}%`,width:`${span}%`,bottom:'1.3%',height:'13.2%'};
}
