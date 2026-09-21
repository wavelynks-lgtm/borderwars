export const PATTERNS=['solid','stripes','dots','checks','chevrons','crosshatch'] as const;
export type Pattern=typeof PATTERNS[number];
export const PREMIUM_PATTERNS:readonly Pattern[]=['checks','chevrons','crosshatch'];
export const FLAG_CODES=('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
export interface Cosmetics {flag:string;pattern:Pattern;color:string;secondary:string;badge:'none'|'supporter'}
export const DEFAULT_COSMETICS:Cosmetics={flag:'',pattern:'solid',color:'#ff4d6d',secondary:'#fff1c9',badge:'none'};
export function flagGlyph(code:string):string {if(code==='star')return '★';if(code==='crown')return '♛';if(code==='globe')return '🌐';return /^[A-Z]{2}$/.test(code)?[...code].map(c=>String.fromCodePoint(127397+c.charCodeAt(0))).join(''):'';}
export function sanitizeCosmetics(value:unknown,premium=false):Cosmetics{
 const v=(value&&typeof value==='object'?value:{}) as Partial<Cosmetics>;
 const hex=(s:unknown,fallback:string)=>typeof s==='string'&&/^#[0-9a-f]{6}$/i.test(s)?s:fallback;
 const flag=typeof v.flag==='string'&&[...FLAG_CODES,'star','crown','globe',''].includes(v.flag)?v.flag:'';
 const pattern=PATTERNS.includes(v.pattern!)&&(!PREMIUM_PATTERNS.includes(v.pattern!)||premium)?v.pattern!:'solid';
 return {flag,pattern,color:hex(v.color,DEFAULT_COSMETICS.color),secondary:hex(v.secondary,DEFAULT_COSMETICS.secondary),badge:premium&&v.badge==='supporter'?'supporter':'none'};
}
export function localCosmetics():Cosmetics{try{return sanitizeCosmetics(JSON.parse(localStorage.getItem('borderwars.cosmetics')??'{}'));}catch{return {...DEFAULT_COSMETICS};}}
export function patternCSS(c:Cosmetics):string {
 const a=c.color,b=c.secondary;
 switch(c.pattern){
 case 'stripes':return `repeating-linear-gradient(45deg,${a} 0 8px,${b} 8px 11px)`;
 case 'dots':return `radial-gradient(${b} 20%,transparent 22%) 0 0/14px 14px,${a}`;
 case 'checks':return `conic-gradient(${a} 25%,${b} 0 50%,${a} 0 75%,${b} 0) 0 0/24px 24px`;
 case 'chevrons':return `repeating-conic-gradient(from 45deg,${a} 0 25%,${b} 0 50%) 0 0/24px 16px`;
 case 'crosshatch':return `repeating-linear-gradient(45deg,transparent 0 8px,${b} 8px 10px),repeating-linear-gradient(-45deg,${a} 0 8px,${b} 8px 10px)`;
 default:return a;
 }
}
