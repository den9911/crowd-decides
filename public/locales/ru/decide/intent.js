const requestIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxUtc=8_640_000_000_000_000;

// Form input is explicitly UTC. Do not resolve a browser-local wall time across DST.
export function parseUtcMinute(value){
  if(value==='')return null;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return NaN;
  const ms=Date.parse(value+'Z');
  return Number.isSafeInteger(ms)&&ms>0&&new Date(ms).toISOString().slice(0,16)===value?ms:NaN;
}

/** Validate a saved creation intent before any request can be retried. */
export function decodePending(raw){
  if(raw===null)return null;
  if(!raw||raw.length>5500)throw new Error('Invalid pending poll');
  const value=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid pending poll');
  const {version,requestId,title,options}=value;
  const legacy=!Object.hasOwn(value,'version')&&!Object.hasOwn(value,'expiresAt');
  const expiresAt=legacy?null:value.expiresAt;
  const modern=version===2||version===3;
  const hidden=modern?value.hideResultsUntilClose:false;
  const mode=modern?value.mode:'single';
  const slots=version===3?value.slots:null;
  const validDeadline=expiresAt===null||(Number.isSafeInteger(expiresAt)&&expiresAt>0&&expiresAt<=maxUtc);
  const validSlots=mode==='meeting'?
    version===3&&expiresAt!==null&&Array.isArray(slots)&&slots.length>=2&&slots.length<=6&&
      slots.every((ms,i)=>Number.isSafeInteger(ms)&&ms>0&&ms<=maxUtc&&(i===0||slots[i-1]<ms))&&
      Array.isArray(options)&&options.length===0:
    (version!==3||slots===null)&&Array.isArray(options)&&options.length>=2&&options.length<=6&&
      options.every(option=>typeof option==='string'&&option.length>=1&&option.length<=80);
  if((!legacy&&![1,2,3].includes(version))||!validDeadline||
      (!modern&&(Object.hasOwn(value,'hideResultsUntilClose')||Object.hasOwn(value,'mode')))||
      (version!==3&&Object.hasOwn(value,'slots'))||
      (modern&&(typeof hidden!=='boolean'||!['single','multiple',...(version===3?['meeting']:[])].includes(mode)))||
      !validSlots||typeof requestId!=='string'||!requestIdPattern.test(requestId)||
      typeof title!=='string'||title.length<1||title.length>160){
    throw new Error('Invalid pending poll');
  }
  return {version:3,requestId,title,options,slots,expiresAt,hideResultsUntilClose:hidden,mode};
}

/** Leave old single-select fields unchanged so creation receipts keep their hash. */
export function pollCreationPayload({requestId,title,options,slots,expiresAt,hideResultsUntilClose=false,mode='single'}){
  return {requestId,title,...(mode==='meeting'?{slots}:{options}),expiresAt,
    ...(hideResultsUntilClose?{hideResultsUntilClose:true}:{}),
    ...(mode!=='single'?{mode}:{})};
}
