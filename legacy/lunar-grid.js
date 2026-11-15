// Nominal 120 km geographic sectors on a spherical reference Moon.
// Bands span ~120 km north-south; sector count varies by latitude to keep
// east-west width close to 120 km at the band midpoint.
// Deliberately NOT a flat 120km square Mercator grid.
export const LUNAR_REFERENCE_RADIUS_KM = 1737.4;
export const TARGET_CELL_KM = 120;
const RAD = Math.PI / 180;
export const BAND_COUNT = Math.round(Math.PI * LUNAR_REFERENCE_RADIUS_KM / TARGET_CELL_KM);
export const BAND_HEIGHT_DEG = 180 / BAND_COUNT;
export const BAND_HEIGHT_KM = Math.PI * LUNAR_REFERENCE_RADIUS_KM / BAND_COUNT;
export function bandInfo(index){
  if(!Number.isInteger(index)||index<0||index>=BAND_COUNT) throw new RangeError('Invalid latitude band');
  const south=-90+index*BAND_HEIGHT_DEG, north=-90+(index+1)*BAND_HEIGHT_DEG;
  const middle=(south+north)/2;
  const circumference=2*Math.PI*LUNAR_REFERENCE_RADIUS_KM*Math.cos(middle*RAD);
  const sectors=Math.max(1,Math.round(circumference/TARGET_CELL_KM));
  return {index,south,north,middle,sectors,longitudeStepDeg:360/sectors,widthAtCenterKm:circumference/sectors,heightKm:BAND_HEIGHT_KM};
}
export function regionAt(latitude,longitude){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude>90) throw new RangeError('Invalid lunar latitude/longitude');
  const band=Math.max(0,Math.min(BAND_COUNT-1,Math.floor((latitude+90)/BAND_HEIGHT_DEG)));
  const b=bandInfo(band);
  const east=((longitude%360)+360)%360;
  const column=Math.min(b.sectors-1,Math.floor(east/b.longitudeStepDeg));
  const west=column*b.longitudeStepDeg;
  const right=(column+1)*b.longitudeStepDeg;
  const areaKm2=LUNAR_REFERENCE_RADIUS_KM**2*(right-west)*RAD*(Math.sin(b.north*RAD)-Math.sin(b.south*RAD));
  return {id:`TB-${String(band+1).padStart(2,'0')}-${String(column+1).padStart(3,'0')}`,band,column,south:b.south,north:b.north,west,east:right,centerLat:b.middle,centerLon:(west+right)/2,widthKm:b.widthAtCenterKm,heightKm:b.heightKm,areaKm2,sectors:b.sectors};
}
export function gridDefinition(){
  return Array.from({length:BAND_COUNT},(_,i)=>bandInfo(i));
}
export const GRID_CELL_COUNT = gridDefinition().reduce((sum,band)=>sum+band.sectors,0);
