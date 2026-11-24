import { $, $$, api, escape, action, share, storage } from '/locales/en/shared/ui.js';
import {decodePending,parseUtcMinute,pollCreationPayload,meetingInput} from './intent.js';
import {readDraft,saveDraft,clearDraft} from './draft.js';
const pendingKey='minute:pending-poll';
const boundedApi=(path,input)=>api(path,input,{}, {signal:AbortSignal.timeout(10000)});
function localDeadline(value){
  return new Intl.DateTimeFormat(document.documentElement.lang,{
    year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',
    timeZoneName:'shortOffset'
  }).format(value);
}
function feedback(message){
 let note=$('#poll-feedback');if(!note){note=document.createElement('p');note.id='poll-feedback';note.className='note';note.setAttribute('role','status');$('#app').prepend(note);}note.textContent=message;
 const retry=$('#create-poll button[type=submit]');if(retry&&retry.dataset.lock!=='true'){retry.textContent='e';$('#create-poll').setAttribute('aria-describedby','poll-feedback');}
}
export async function mount(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id){await showPoll(id);return;}
  const templateId=new URLSearchParams(location.search).get('copy');
  let template=null;
  if(templateId){
    try{template=await boundedApi(`/api/poll/template?id=${encodeURIComponent(templateId)}`);}
    catch(error){
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(templateId);feedback('h');return;}catch{}
      }
      $('#app').innerHTML='<section class="narrow panel stack"><p role="status">h</p><button id="retry-template">e</button><a class="text-button" href="/decide/">r</a></section>';
      action($('#retry-template'),()=>mount());return;
    }
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>h</h2>${template?'<p class="note">h</p>':''}<label>u<input name="title" maxlength="160" required placeholder="h"></label><label id="poll-options-group">p<textarea name="options" maxlength="485" rows="6" required placeholder="o"></textarea></label><p id="poll-options-help" class="small muted"> </p><label id="meeting-slots-group" hidden>e<textarea name="slots" rows="5" placeholder="2026-12-15T18:30&#10;2026-12-16T18:30" aria-describedby="meeting-slots-help meeting-slots-preview"></textarea></label><p id="meeting-slots-help" class="small muted" hidden>n</p><p id="meeting-slots-preview" class="small" role="status" hidden></p><label for="poll-deadline">e</label><input id="poll-deadline" name="deadline" type="datetime-local" aria-describedby="poll-deadline-help poll-deadline-preview"><p id="poll-deadline-help" class="small muted">e</p><p id="poll-deadline-preview" class="small" role="status"></p><fieldset class="stack" aria-describedby="poll-mode-help"><legend>o</legend><label><input type="radio" name="mode" value="single" checked> n</label><label><input type="radio" name="mode" value="multiple"> u</label><label><input type="radio" name="mode" value="meeting"> c</label><p id="poll-mode-help" class="small muted">o</p></fieldset><label><input type="checkbox" name="hideResultsUntilClose"> i</label><p class="small muted">h</p><div class="row"><button type="submit">r</button><button id="save-poll-draft" class="secondary" type="button">a</button><button id="restore-poll-draft" class="secondary" type="button">e</button><button id="delete-poll-draft" class="secondary" type="button">e</button></div><p id="poll-draft-status" class="small muted" role="status" aria-live="polite">r</p></form><div class="stack"><div class="panel stack"><h2>n</h2><p class="muted">r</p><p class="small muted">n</p></div>${recent.length?`<div class="panel stack"><h3>o</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">h</p></div>`:''}</div></div>`;
  const form=$('#create-poll'),deadline=form.elements.deadline,preview=$('#poll-deadline-preview');
  const hiddenControl=form.elements.hideResultsUntilClose;
  const modeControls=Array.from(form.querySelectorAll('input[name="mode"]'));
  const slotsControl=form.elements.slots,slotsGroup=$('#meeting-slots-group'),slotsHelp=$('#meeting-slots-help'),slotsPreview=$('#meeting-slots-preview');
  const optionsGroup=$('#poll-options-group'),optionsHelp=$('#poll-options-help');
  const draftSave=$('#save-poll-draft'),draftRestore=$('#restore-poll-draft'),draftDelete=$('#delete-poll-draft'),draftStatus=$('#poll-draft-status');
  let savedDraft=null,draftUnreadable=false;
  try{savedDraft=readDraft(localStorage);}
  catch{draftUnreadable=true;}
  function meetingInputs(){
    const meeting=form.querySelector('input[name="mode"]:checked').value==='meeting';
    slotsGroup.hidden=slotsHelp.hidden=slotsPreview.hidden=!meeting;
    optionsGroup.hidden=optionsHelp.hidden=meeting;
    slotsGroup.style.display=meeting?'':'none';optionsGroup.style.display=meeting?'none':'';
    slotsControl.required=meeting;form.elements.options.required=!meeting;
    slotsControl.disabled=!meeting;form.elements.options.disabled=meeting;
    const expiresAt=deadline.validity.badInput?NaN:parseUtcMinute(deadline.value);
    if(meeting){
      const result=meetingInput(slotsControl.value,expiresAt);
      const instants=result.slots.map(ms=>new Date(ms).toISOString().slice(0,16)+'Z → '+localDeadline(ms));
      const descriptions={
        count:'n',
        format:'n',
        duplicate:'e',
        bounds:'l',
        deadline:'e'
      };
      slotsPreview.textContent=[...instants,descriptions[result.reason]].filter(Boolean).join(' · ');
    }
  }
  function draftFields(){
    return {title:form.elements.title.value,options:form.elements.options.value,slots:slotsControl.value,
      deadline:deadline.value,hideResultsUntilClose:hiddenControl.checked,
      mode:form.querySelector('input[name="mode"]:checked').value};
  }
  function draftControls(message=''){
    draftSave.disabled=!!pending||pendingInvalid||draftUnreadable;
    draftRestore.disabled=!!pending||pendingInvalid||!savedDraft;
    draftDelete.disabled=!!pending||pendingInvalid||(!savedDraft&&!draftUnreadable);
    draftStatus.textContent=message||(
      pending||pendingInvalid?'u':
      draftUnreadable?'h':
      savedDraft?' ':
      'r');
  }
  function applyDraft(draft){
    form.elements.title.value=draft.title;
    form.elements.options.value=draft.options;
    slotsControl.value=draft.slots;deadline.value=draft.deadline;
    hiddenControl.checked=draft.hideResultsUntilClose;
    form.querySelector(`input[name="mode"][value="${draft.mode}"]`).checked=true;
    deadline.setCustomValidity('');
    meetingInputs();
    showDeadlinePreview(deadline.value?parseUtcMinute(deadline.value):null);
  }
  modeControls.forEach(control=>control.addEventListener('change',meetingInputs));
  slotsControl.addEventListener('input',meetingInputs);
  let pending=null,pendingInvalid=false;
  const lockFields=locked=>{
    form.elements.title.readOnly=locked;
    form.elements.options.readOnly=locked;
    deadline.readOnly=locked;
    slotsControl.readOnly=locked;
    draftSave.disabled=locked;draftRestore.disabled=locked;draftDelete.disabled=locked;
    hiddenControl.disabled=locked;
    modeControls.forEach(control=>{control.disabled=locked;});
  };
  function showDeadlinePreview(value){
    preview.textContent=Number.isFinite(value)?'o'+localDeadline(value):
      value===null?'o':'n';
  }
  deadline.addEventListener('input',()=>{
    deadline.setCustomValidity('');
    showDeadlinePreview(deadline.validity.badInput?NaN:parseUtcMinute(deadline.value));
    meetingInputs();
  });
  try{pending=decodePending(sessionStorage.getItem(pendingKey));}
  catch{pendingInvalid=true;}
  if(pendingInvalid){
    lockFields(true);
    const submit=$('button[type=submit]',form);submit.disabled=true;submit.dataset.lock='true';
    feedback('h');
  }else if(pending){
    form.elements.title.value=pending.title;
    form.elements.options.value=pending.options.join('\n');
    slotsControl.value=(pending.slots??[]).map(ms=>new Date(ms).toISOString().slice(0,16)).join('\n');
    hiddenControl.checked=pending.hideResultsUntilClose;
    form.querySelector(`input[name="mode"][value="${pending.mode}"]`).checked=true;
    meetingInputs();
    if(pending.expiresAt!==null)deadline.value=new Date(pending.expiresAt).toISOString().replace(/Z$/,'');
    lockFields(true);
    showDeadlinePreview(pending.expiresAt);
    feedback(template?' ':'r');
  }else{
    if(template){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}
    showDeadlinePreview(null);
  }
  meetingInputs();
  draftControls();
  action(draftSave,()=>{
    if(pending||pendingInvalid||draftUnreadable)return;
    savedDraft=saveDraft(localStorage,draftFields());
    draftControls('r');
  });
  action(draftRestore,()=>{
    if(pending||pendingInvalid)return;
    const draft=readDraft(localStorage);
    if(!draft){savedDraft=null;draftControls();return;}
    savedDraft=draft;
    applyDraft(draft);
    form.elements.title.focus();
    draftControls('r');
  });
  action(draftDelete,()=>{
    if(pending||pendingInvalid)return;
    clearDraft(localStorage);
    savedDraft=null;draftUnreadable=false;
    draftControls('o');
  });
  action(form,async()=>{
    if(pendingInvalid)return;
    if(!pending){
      const expiresAt=deadline.validity.badInput?NaN:parseUtcMinute(deadline.value);
      if(Number.isNaN(expiresAt)){
        deadline.setCustomValidity('n');
        showDeadlinePreview(NaN);deadline.reportValidity();deadline.focus();return;
      }
      const title=form.elements.title.value.trim(),mode=form.querySelector('input[name="mode"]:checked').value;
      const meeting=mode==='meeting';
      const options=meeting?[]:form.elements.options.value.split('\n').map(x=>x.trim()).filter(Boolean);
      const meetingResult=meeting?meetingInput(slotsControl.value,expiresAt):null;
      const slots=meeting?meetingResult.slots:null;
      if(!title||(!meeting&&(options.length<2||options.length>6||options.some(option=>option.length>80)))){
        throw new Error('n');
      }
      if(meeting&&meetingResult.reason){
        meetingInputs();
        (meetingResult.reason==='deadline'?deadline:slotsControl).focus();
        throw new Error('n');
      }
      pending={version:3,requestId:crypto.randomUUID(),title,options,slots,expiresAt,
        hideResultsUntilClose:hiddenControl.checked,mode};
      try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
      catch{pending=null;throw new Error('h');}
    }
    lockFields(true);
    let result;
    try{result=await boundedApi('/api/polls',pollCreationPayload(pending));}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;lockFields(false);draftControls();$('#poll-feedback')?.remove();form.removeAttribute('aria-describedby');$('button[type=submit]',form).textContent='r';throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('h');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'r':'r');return;
    }
    try{sessionStorage.removeItem(pendingKey);}catch{}storage.set('my-polls',[{id:result.id,title:pending.title},...recent.filter(p=>p.id!==result.id)].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id,trigger){
  const poll=await boundedApi(`/api/poll?id=${encodeURIComponent(id)}`);
  const resultsVisible=poll.resultsVisible!==false&&Array.isArray(poll.counts);
  const meeting=poll.mode==='meeting';
  const options=meeting?poll.slots.map(ms=>localDeadline(ms)+' · UTC '+new Date(ms).toISOString().slice(0,16)+'Z'):poll.options;
  const counts=resultsVisible?options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0):null;
  const multiple=poll.mode==='multiple';
  const total=resultsVisible?(multiple?poll.ballotCount:counts.reduce((a,b)=>a+b,0)):null;
  const selected=multiple?(Array.isArray(poll.choice)?poll.choice:[]):poll.choice===null?[]:[Number(poll.choice)];
  const canVote=poll.choice===null&&!poll.closed;
  const choices=!canVote?'':multiple?
    `<form id="multi-vote" class="stack"><fieldset class="stack"><legend>e</legend>${options.map((option,i)=>`<label><input type="checkbox" name="choices" value="${i}"> ${escape(option)}</label>`).join('')}</fieldset><p class="small muted">n</p><button type="submit">u</button></form>`:
    `<div>${options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div>`;
  const results=canVote
    ?resultsVisible?`<p class="small muted">${total} o</p>`:''
    :resultsVisible?`<div>${options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${selected.includes(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">o ${total}. ${poll.choice!==null?'o':'h'}${multiple?'A':''}</p>`:'';
  const hidden=resultsVisible?'':`<div class="note" id="poll-results-hidden"><p>e</p>${poll.choice!==null?`<p>o ${selected.map(i=>escape(options[i])).join(', ')}</p>`:''}</div>`;
  const deadline=Number.isSafeInteger(poll.expiresAt)&&poll.expiresAt>0&&poll.expiresAt<=8_640_000_000_000_000
    ?`<p class="small muted">e<time id="poll-deadline-value" datetime="${new Date(poll.expiresAt).toISOString()}">${escape(localDeadline(poll.expiresAt))}</time></p>`:'';
  const restoreFocus=trigger&&(document.activeElement===trigger||document.activeElement===document.body);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'O':' '}</p><h2 class="poll-title" tabindex="-1">${escape(poll.title)}</h2>${deadline}${choices}${results}${hidden}<aside id="ownership-notice" class="note" aria-label="r">${poll.isOwner?'o':'o'}<details><summary>o</summary><p>o</p></details></aside><div class="row"><button id="share">e</button><button id="refresh" class="secondary">e</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">l</button>':''}${poll.isOwner&&!meeting?`<a class="text-button" href="?copy=${encodeURIComponent(id)}">r</a>`:''}<a class="text-button" href="/decide/">r</a></div></div>`;
  if(restoreFocus)$('.poll-title').focus({preventScroll:true});
  $$('.poll-option').forEach(button=>action(button,async()=>{
    // One pending choice: do not offer a competing vote while its result is unknown.
    $$('.poll-option').forEach(option=>{option.disabled=true;option.dataset.lock='true';});
    try{await boundedApi('/api/poll/vote',meeting?{id,slot:Number(button.dataset.index)}:{id,choice:Number(button.dataset.index)});await showPoll(id,button);}
    catch(error){
      try{
        await showPoll(id,button);
        feedback(error.code==='POLL_CLOSED'?'h':error.code==='POLL_ALREADY_VOTED'?'o':'h');
      }
      catch{feedback(error.code==='POLL_CLOSED'?'h':'o');}
    }
  }));
  const multiForm=$('#multi-vote');
  if(multiForm)action(multiForm,async()=>{
    const checked=Array.from(multiForm.querySelectorAll('input[name="choices"]:checked')).map(input=>Number(input.value));
    if(!checked.length){feedback('e');multiForm.querySelector('input')?.focus();return;}
    multiForm.querySelectorAll('input,button').forEach(input=>{input.disabled=true;});
    try{await boundedApi('/api/poll/vote',{id,choices:checked});await showPoll(id,multiForm);}
    catch(error){
      try{await showPoll(id,multiForm);feedback('h');}
      catch{feedback(error.code==='POLL_CLOSED'?'h':'o');}
    }
  },'submit');
  action($('#share'),()=>share(location.href,'r',poll.title));const refresh=$('#refresh');action(refresh,()=>showPoll(id,refresh));
  const close=$('#close');
  if(close)action(close,async()=>{
    try{await boundedApi('/api/poll/close',{id});await showPoll(id,close);}
    catch(error){
      // A missing response is not proof of failure. Reconcile with GET; never replay POST automatically.
      $('#close')?.remove();
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(id,close);}catch{}
        feedback('h');return;
      }
      try{await showPoll(id,close);feedback('h');}
      catch{feedback('l');}

    }
  });
}

