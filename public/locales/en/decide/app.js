import { $, $$, api, escape, action, share, storage } from '/locales/en/shared/ui.js';
import {decodePending,parseUtcMinute,pollCreationPayload,meetingInput} from './intent.js';
import {readDraft,saveDraft,clearDraft,draftKey} from './draft.js';
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
 const retry=$('#create-poll button[type=submit]');if(retry&&retry.dataset.lock!=='true'){retry.textContent='Retry the same request';$('#create-poll').setAttribute('aria-describedby','poll-feedback');}
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
        try{await showPoll(templateId);feedback('This session cannot manage the poll. Open it in the creator’s original browser.');$('.poll-title')?.focus({preventScroll:true});return;}catch{}
      }
      $('#app').innerHTML='<section class="narrow panel stack"><p role="status">The template could not be loaded. No new poll was created. Check the link and original session, then retry loading.</p><button id="retry-template">Retry loading the template</button><a class="text-button" href="/decide/">Create your own</a></section>';
      action($('#retry-template'),()=>mount());return;
    }
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>What are we deciding?</h2>${template?'<p class="note">This is a new draft. Votes and closing settings are not copied.</p>':''}<label>Question<input name="title" maxlength="160" required placeholder="What should we name our cat?"></label><label id="poll-options-group">Options — one per line<textarea name="options" maxlength="485" rows="6" required placeholder="Donut&#10;Pixel&#10;Sir Loaf"></textarea></label><p id="poll-options-help" class="small muted">2 to 6 options, up to 80 characters each.</p><label id="meeting-slots-group" hidden>Meeting times (UTC, one per line)<textarea name="slots" rows="5" placeholder="2026-12-15T18:30&#10;2026-12-16T18:30" aria-describedby="meeting-slots-help meeting-slots-preview"></textarea></label><p id="meeting-slots-help" class="small muted" hidden>Enter 2 to 6 distinct UTC times within 365 days. A voting deadline before the first meeting is required.</p><p id="meeting-slots-preview" class="small" role="status" hidden></p><label for="poll-deadline">Deadline (UTC, optional)</label><input id="poll-deadline" name="deadline" type="datetime-local" aria-describedby="poll-deadline-help poll-deadline-preview"><p id="poll-deadline-help" class="small muted">Leave blank for no deadline. Enter a UTC date and time up to 365 days ahead.</p><p id="poll-deadline-preview" class="small" role="status"></p><fieldset class="stack" aria-describedby="poll-mode-help"><legend>Voting type</legend><label><input type="radio" name="mode" value="single" checked> One option</label><label><input type="radio" name="mode" value="multiple"> Multiple options</label><label><input type="radio" name="mode" value="meeting"> Schedule a meeting</label><p id="poll-mode-help" class="small muted">For multiple-choice polls, participants select one or more answers. The type cannot change after publication.</p></fieldset><label><input type="checkbox" name="hideResultsUntilClose"> Hide results until closing</label><p class="small muted">While voting is open, neither the creator nor voters can see aggregate results. After closing, everyone with the link can see them.</p><p id="before-publish-help" class="small muted">Options can be edited before publication. After publication they are fixed so existing votes keep their meaning. The creator can make a separate poll for different options.</p><div class="row" id="poll-draft-actions"><button type="submit">Create poll ↗</button><button id="save-poll-draft" class="secondary" type="button">Save draft</button><button id="restore-poll-draft" class="secondary" type="button">Restore draft</button><button id="delete-poll-draft" class="secondary" type="button">Delete draft</button></div><p id="poll-draft-status" class="small muted" role="status" aria-live="polite">Drafts are stored only in this browser. They are never published automatically.</p></form><div class="stack"><div class="panel stack"><h2>One question. One link.</h2><p class="muted">Create a poll and send it to your chat. Friends can vote without signing up, and everyone sees the result.</p><p class="small muted">Anyone with the link can access the poll. Do not add confidential information.</p></div>${recent.length?`<div class="panel stack"><h3>Your recent polls</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">This list stays in your browser. A recent link does not prove ownership.</p></div>`:''}</div></div>`;
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
        count:'Enter 2 to 6 UTC time slots.',
        format:'Enter valid UTC dates.',
        duplicate:'Meeting slots must be distinct.',
        bounds:'All meeting times must be in the future and within 365 days.',
        deadline:'Set a voting deadline before the earliest meeting time.'
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
    for(const [control,disabled] of [
      [draftSave,!!pending||pendingInvalid||draftUnreadable],
      [draftRestore,!!pending||pendingInvalid||!savedDraft],
      [draftDelete,!!pending||pendingInvalid||(!savedDraft&&!draftUnreadable)]
    ]){
      control.disabled=disabled;
      // action() otherwise re-enables its trigger even after it becomes unavailable.
      control.dataset.lock=disabled?'true':'false';
    }
    draftStatus.textContent=message||(
      pending||pendingInvalid?'Publication is unconfirmed. A draft cannot replace the original request.':
      draftUnreadable?'The saved draft is damaged or inaccessible. Delete it separately; the publication request is unaffected.':
      savedDraft?'A local draft exists. Restore it manually; no request is sent to the server.':
      'Drafts are stored only in this browser. They are never published automatically.');
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
    preview.textContent=Number.isFinite(value)?'Your local time: '+localDeadline(value):
      value===null?'No deadline.':'Enter a valid UTC date and time.';
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
    feedback('The saved request is unavailable. Review recent polls in the original browser before creating another.');
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
    feedback(template?'A creation is still unconfirmed. Retrying the original request; the loaded template is not applied.':'Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');
  }else{
    if(template){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}
    showDeadlinePreview(null);
  }
  meetingInputs();
  draftControls();
  if(template&&!pending&&!pendingInvalid)form.elements.title.focus({preventScroll:true});
  action(draftSave,()=>{
    if(pending||pendingInvalid||draftUnreadable)return;
    savedDraft=saveDraft(localStorage,draftFields());
    draftControls('Draft saved in this browser. Nothing was published.');
  });
  action(draftRestore,()=>{
    if(pending||pendingInvalid)return;
    let draft;
    try{draft=readDraft(localStorage);}
    catch(error){draftUnreadable=true;savedDraft=null;draftControls();throw error;}
    if(!draft){savedDraft=null;draftControls();return;}
    savedDraft=draft;
    applyDraft(draft);
    form.elements.title.focus();
    draftControls('Draft restored. Check the fields before publishing.');
  });
  action(draftDelete,()=>{
    if(pending||pendingInvalid)return;
    clearDraft(localStorage);
    savedDraft=null;draftUnreadable=false;
    draftControls('Local draft deleted. The form and publication request were not changed.');
    draftSave.focus({preventScroll:true});
  });
  action(form,async()=>{
    if(pendingInvalid)return;
    if(!pending){
      const expiresAt=deadline.validity.badInput?NaN:parseUtcMinute(deadline.value);
      if(Number.isNaN(expiresAt)){
        deadline.setCustomValidity('Enter a valid UTC date and time.');
        showDeadlinePreview(NaN);deadline.reportValidity();deadline.focus();return;
      }
      const title=form.elements.title.value.trim(),mode=form.querySelector('input[name="mode"]:checked').value;
      const meeting=mode==='meeting';
      const options=meeting?[]:form.elements.options.value.split('\n').map(x=>x.trim()).filter(Boolean);
      const meetingResult=meeting?meetingInput(slotsControl.value,expiresAt):null;
      const slots=meeting?meetingResult.slots:null;
      if(!title||(!meeting&&(options.length<2||options.length>6||options.some(option=>option.length>80)))){
        throw new Error('Enter a question and 2 to 6 options, up to 80 characters each.');
      }
      if(meeting&&meetingResult.reason){
        meetingInputs();
        (meetingResult.reason==='deadline'?deadline:slotsControl).focus();
        throw new Error('Enter 2–6 distinct future UTC slots and set the voting deadline before the first meeting.');
      }
      pending={version:3,requestId:crypto.randomUUID(),title,options,slots,expiresAt,
        hideResultsUntilClose:hiddenControl.checked,mode};
      try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
      catch{pending=null;throw new Error('The browser could not save the request. Allow session storage before submitting.');}
    }
    lockFields(true);
    let result;
    try{result=await boundedApi('/api/polls',pollCreationPayload(pending));}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;lockFields(false);draftControls();$('#poll-feedback')?.remove();form.removeAttribute('aria-describedby');$('button[type=submit]',form).textContent='Create poll ↗';throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('This identifier was used for a different poll. Retry the original request.');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'Creation belongs to the original browser session. Open that profile; no new copy was created.':'Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');return;
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
    `<form id="multi-vote" class="stack"><fieldset class="stack"><legend>Select one or more options</legend>${options.map((option,i)=>`<label><input type="checkbox" name="choices" value="${i}"> ${escape(option)}</label>`).join('')}</fieldset><p class="small muted">One browser session, one ballot. Selected options are saved together.</p><button type="submit">Submit answer</button></form>`:
    `<div>${options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div>`;
  const results=canVote
    ?resultsVisible?`<p class="small muted">${total} votes. Vote to see the results.</p>`:''
    :resultsVisible?`<div>${options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${selected.includes(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Total votes: ${total}. ${poll.choice!==null?'Your vote is counted.':'This poll is closed.'}${multiple?' A participant can select multiple options.':''}</p>`:'';
  const hidden=resultsVisible?'':`<div class="note" id="poll-results-hidden"><p>Results will be shown when the poll closes.</p>${poll.choice!==null?`<p>Your vote is counted. ${selected.map(i=>escape(options[i])).join(', ')}</p>`:''}</div>`;
  const deadline=Number.isSafeInteger(poll.expiresAt)&&poll.expiresAt>0&&poll.expiresAt<=8_640_000_000_000_000
    ?`<p class="small muted">Deadline: <time id="poll-deadline-value" datetime="${new Date(poll.expiresAt).toISOString()}">${escape(localDeadline(poll.expiresAt))}</time></p>`:'';
  const restoreFocus=trigger&&(document.activeElement===trigger||document.activeElement===document.body);
  const canCopy=poll.isOwner&&!meeting;
  const immutabilityNotice=poll.closed?
    'This poll is closed. Published options and votes remain unchanged.':
    'Published options are locked: changing their text would change the meaning of existing votes.';
  const creationNotice=canCopy?
    'Create a similar poll opens a separate editable poll. Votes, closing date and ownership are not copied.':
    poll.isOwner?
      'To schedule another meeting, create a new poll. Meeting times and votes are not transferred automatically.':
      'Only the creator can copy options. You can create your own new poll.';
  let hasSavedDraft=false;
  if(poll.isOwner){try{hasSavedDraft=localStorage.getItem(draftKey)!==null;}catch{}}
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'POLL CLOSED':'A DECISION IS IN THE MAKING'}</p><h2 class="poll-title" tabindex="-1">${escape(poll.title)}</h2>${deadline}${choices}${results}${hidden}<section id="published-edit-policy" class="stack" aria-labelledby="published-edit-heading"><h3 id="published-edit-heading">Why can\u0027t published options be edited?</h3><p id="published-edit-help" class="small muted">${immutabilityNotice}</p><p id="published-copy-help" class="small muted">${creationNotice}</p></section><aside id="ownership-notice" class="note" aria-label="Creator access">${poll.isOwner?'You manage this poll through this browser session. Keep its site data.':'You can view this poll; only the creator can manage it.'}<details><summary>How do I keep creator access?</summary><p>To manage the poll, open it in the creator’s original browser and profile. Clearing cookies or ending private browsing loses that session. The link and recent polls list cannot restore permission. Automatic recovery is unavailable. You can vote in an open poll or create your own.</p></details></aside><div class="row"><button id="share">Send to friends ↗</button><button id="refresh" class="secondary">Refresh</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Close poll</button>':''}${canCopy?`<a id="copy-poll" class="text-button" href="?copy=${encodeURIComponent(id)}" aria-describedby="published-edit-help published-copy-help">Create a similar poll</a>`:''}<a class="text-button" href="/decide/">Create your own</a></div>${hasSavedDraft?'<div id="published-draft-actions" class="stack"><p class="small muted">A saved draft remains in this browser. Publishing does not delete it automatically.</p><button id="clear-published-draft" class="secondary" type="button">Delete saved draft</button><p id="published-draft-status" class="small" role="status" tabindex="-1"></p></div>':''}</div>`;
  if(restoreFocus)$('.poll-title').focus({preventScroll:true});
  const publishedDraftClear=$('#clear-published-draft');
  if(publishedDraftClear)action(publishedDraftClear,()=>{
    clearDraft(localStorage);
    const status=$('#published-draft-status');
    status.textContent='The local draft was deleted. The published poll and votes were not changed.';
    status.focus({preventScroll:true});
    publishedDraftClear.remove();
  });
  $$('.poll-option').forEach(button=>action(button,async()=>{
    // One pending choice: do not offer a competing vote while its result is unknown.
    $$('.poll-option').forEach(option=>{option.disabled=true;option.dataset.lock='true';});
    try{await boundedApi('/api/poll/vote',meeting?{id,slot:Number(button.dataset.index)}:{id,choice:Number(button.dataset.index)});await showPoll(id,button);}
    catch(error){
      try{
        await showPoll(id,button);
        feedback(error.code==='POLL_CLOSED'?'The poll is already closed. Its status has been refreshed from the server.':error.code==='POLL_ALREADY_VOTED'?'Your vote was already counted. The saved answer is shown.':'The server vote state was refreshed. Check your answer and the result.');
      }
      catch{feedback(error.code==='POLL_CLOSED'?'The server confirmed closure. Use Refresh to load the result.':'Your vote is unconfirmed. Use Refresh to check its state. The request is not sent again automatically.');}
    }
  }));
  const multiForm=$('#multi-vote');
  if(multiForm)action(multiForm,async()=>{
    const checked=Array.from(multiForm.querySelectorAll('input[name="choices"]:checked')).map(input=>Number(input.value));
    if(!checked.length){feedback('Select at least one option.');multiForm.querySelector('input')?.focus();return;}
    multiForm.querySelectorAll('input,button').forEach(input=>{input.disabled=true;});
    try{await boundedApi('/api/poll/vote',{id,choices:checked});await showPoll(id,multiForm);}
    catch(error){
      try{await showPoll(id,multiForm);feedback('The server vote state was refreshed. Check your answer and the result.');}
      catch{feedback(error.code==='POLL_CLOSED'?'The poll is closed. Select Refresh.':'Vote unconfirmed. Select Refresh without resubmitting.');}
    }
  },'submit');
  action($('#share'),()=>share(location.href,'Crowd Decides',poll.title));const refresh=$('#refresh');action(refresh,()=>showPoll(id,refresh));
  const close=$('#close');
  if(close)action(close,async()=>{
    try{await boundedApi('/api/poll/close',{id});await showPoll(id,close);}
    catch(error){
      // A missing response is not proof of failure. Reconcile with GET; never replay POST automatically.
      $('#close')?.remove();
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(id,close);}catch{}
        feedback('This session cannot manage the poll. Open it in the creator’s original browser.');return;
      }
      try{await showPoll(id,close);feedback('The server state was refreshed. Check whether the poll is closed.');}
      catch{feedback('Closing is unconfirmed. Use Refresh to check the state. The request is not sent again automatically.');}

    }
  });
}

