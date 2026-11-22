const requestIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxUtc=8_640_000_000_000_000;

// Form input is explicitly UTC. Do not resolve a browser-local wall time across DST.
export function parseUtcMinute(value){
  if(value==='')return null;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return NaN;
  const ms=Date.parse(value+'Z');
  return Number.isSafeInteger(ms)&&ms>0&&new Date(ms).toISOString().slice(0,16)===value?ms:NaN;
}

export function decodePending(raw){
  if(raw===null)return null;
  // Six 80-character options plus the title fit even with JSON escapes.
  if(!raw||raw.length>5000)throw new Error('Invalid pending poll');
  const value=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid pending poll');
  const {version,requestId,title,options}=value;
  const legacy=!Object.hasOwn(value,'version')&&!Object.hasOwn(value,'expiresAt');
  const expiresAt=legacy?null:value.expiresAt;
  const validDeadline=expiresAt===null||(Number.isSafeInteger(expiresAt)&&expiresAt>0&&expiresAt<=maxUtc);
  if((!legacy&&version!==1)||!validDeadline||Object.hasOwn(value,'hideResultsUntilClose')||
      typeof requestId!=='string'||!requestIdPattern.test(requestId)||
      typeof title!=='string'||title.length<1||title.length>160||
      !Array.isArray(options)||options.length<2||options.length>6||
      options.some(option=>typeof option!=='string'||option.length<1||option.length>80)){
    throw new Error('Invalid pending poll');
  }
  return {version:1,requestId,title,options,expiresAt};
}

export function pollCreationPayload({requestId,title,options,expiresAt}){
  return {requestId,title,options,expiresAt};
}
