import { $, $$, api, escape, action, share, storage } from '/locales/en/shared/ui.js';
import {decodePending,parseUtcMinute,pollCreationPayload} from './intent.js';
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
        try{await showPoll(templateId);feedback('This session cannot manage the poll. Open it in the creator’s original browser.');return;}catch{}
      }
      $('#app').innerHTML='<section class="narrow panel stack"><p role="status">The template could not be loaded. No new poll was created. Check the link and original session, then retry loading.</p><button id="retry-template">Retry loading the template</button><a class="text-button" href="/decide/">Create your own</a></section>';
      action($('#retry-template'),()=>mount());return;
    }
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>What are we deciding?</h2>${template?'<p class="note">This is a new draft. Votes and closing settings are not copied.</p>':''}<label>Question<input name="title" maxlength="160" required placeholder="What should we name our cat?"></label><label>Options — one per line<textarea name="options" maxlength="485" rows="6" required placeholder="Donut&#10;Pixel&#10;Sir Loaf"></textarea></label><p class="small muted">2 to 6 options, up to 80 characters each.</p><label for="poll-deadline">Deadline (UTC, optional)</label><input id="poll-deadline" name="deadline" type="datetime-local" aria-describedby="poll-deadline-help poll-deadline-preview"><p id="poll-deadline-help" class="small muted">Leave blank for no deadline. Enter a UTC date and time up to 365 days ahead.</p><p id="poll-deadline-preview" class="small" role="status"></p><fieldset class="stack" aria-describedby="poll-mode-help"><legend>Voting type</legend><label><input type="radio" name="mode" value="single" checked> One option</label><label><input type="radio" name="mode" value="multiple"> Multiple options</label><p id="poll-mode-help" class="small muted">For multiple-choice polls, participants select one or more answers. The type cannot change after publication.</p></fieldset><label><input type="checkbox" name="hideResultsUntilClose"> Hide results until closing</label><p class="small muted">While voting is open, neither the creator nor voters can see aggregate results. After closing, everyone with the link can see them.</p><button type="submit">Create poll ↗</button></form><div class="stack"><div class="panel stack"><h2>One question. One link.</h2><p class="muted">Create a poll and send it to your chat. Friends can vote without signing up, and everyone sees the result.</p><p class="small muted">Anyone with the link can access the poll. Do not add confidential information.</p></div>${recent.length?`<div class="panel stack"><h3>Your recent polls</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">This list stays in your browser. A recent link does not prove ownership.</p></div>`:''}</div></div>`;
  const form=$('#create-poll'),deadline=form.elements.deadline,preview=$('#poll-deadline-preview');
  const hiddenControl=form.elements.hideResultsUntilClose;
  const modeControls=Array.from(form.querySelectorAll('input[name="mode"]'));
  let pending=null,pendingInvalid=false;
  const lockFields=locked=>{
    form.elements.title.readOnly=locked;
    form.elements.options.readOnly=locked;
    deadline.readOnly=locked;
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
    hiddenControl.checked=pending.hideResultsUntilClose;
    form.querySelector(`input[name="mode"][value="${pending.mode}"]`).checked=true;
    if(pending.expiresAt!==null)deadline.value=new Date(pending.expiresAt).toISOString().replace(/Z$/,'');
    lockFields(true);
    showDeadlinePreview(pending.expiresAt);
    feedback(template?'A creation is still unconfirmed. Retrying the original request; the loaded template is not applied.':'Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');
  }else{
    if(template){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}
    showDeadlinePreview(null);
  }
  action(form,async()=>{
    if(pendingInvalid)return;
    if(!pending){
      const expiresAt=deadline.validity.badInput?NaN:parseUtcMinute(deadline.value);
      if(Number.isNaN(expiresAt)){
        deadline.setCustomValidity('Enter a valid UTC date and time.');
        showDeadlinePreview(NaN);deadline.reportValidity();deadline.focus();return;
      }
      const title=form.elements.title.value.trim(),options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(!title||options.length<2||options.length>6||options.some(option=>option.length>80)){
        throw new Error('Enter a question and 2 to 6 options, up to 80 characters each.');
      }
      pending={version:2,requestId:crypto.randomUUID(),title,options,expiresAt,
        hideResultsUntilClose:hiddenControl.checked,
        mode:form.querySelector('input[name="mode"]:checked').value};
      try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
      catch{pending=null;throw new Error('The browser could not save the request. Allow session storage before submitting.');}
    }
    lockFields(true);
    let result;
    try{result=await boundedApi('/api/polls',pollCreationPayload(pending));}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;lockFields(false);$('#poll-feedback')?.remove();form.removeAttribute('aria-describedby');$('button[type=submit]',form).textContent='Create poll ↗';throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('This identifier was used for a different poll. Retry the original request.');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'Creation belongs to the original browser session. Open that profile; no new copy was created.':'Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');return;
    }
    try{sessionStorage.removeItem(pendingKey);}catch{}storage.set('my-polls',[{id:result.id,title:pending.title},...recent.filter(p=>p.id!==result.id)].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id,trigger){
  const poll=await boundedApi(`/api/poll?id=${encodeURIComponent(id)}`);
  const resultsVisible=poll.resultsVisible!==false&&Array.isArray(poll.counts);
  const counts=resultsVisible?poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0):null;
  const multiple=poll.mode==='multiple';
  const total=resultsVisible?(multiple?poll.ballotCount:counts.reduce((a,b)=>a+b,0)):null;
  const selected=multiple?(Array.isArray(poll.choice)?poll.choice:[]):poll.choice===null?[]:[Number(poll.choice)];
  const canVote=poll.choice===null&&!poll.closed;
  const choices=!canVote?'':multiple?
    `<form id="multi-vote" class="stack"><fieldset class="stack"><legend>Select one or more options</legend>${poll.options.map((option,i)=>`<label><input type="checkbox" name="choices" value="${i}"> ${escape(option)}</label>`).join('')}</fieldset><p class="small muted">One browser session, one ballot. Selected options are saved together.</p><button type="submit">Submit answer</button></form>`:
    `<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div>`;
  const results=canVote
    ?resultsVisible?`<p class="small muted">${total} votes. Vote to see the results.</p>`:''
    :resultsVisible?`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${selected.includes(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Total votes: ${total}. ${poll.choice!==null?'Your vote is counted.':'This poll is closed.'}${multiple?' A participant can select multiple options.':''}</p>`:'';
  const hidden=resultsVisible?'':`<div class="note" id="poll-results-hidden"><p>Results will be shown when the poll closes.</p>${poll.choice!==null?`<p>Your vote is counted. ${selected.map(i=>escape(poll.options[i])).join(', ')}</p>`:''}</div>`;
  const deadline=Number.isSafeInteger(poll.expiresAt)&&poll.expiresAt>0&&poll.expiresAt<=8_640_000_000_000_000
    ?`<p class="small muted">Deadline: <time id="poll-deadline-value" datetime="${new Date(poll.expiresAt).toISOString()}">${escape(localDeadline(poll.expiresAt))}</time></p>`:'';
  const restoreFocus=trigger&&(document.activeElement===trigger||document.activeElement===document.body);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'POLL CLOSED':'A DECISION IS IN THE MAKING'}</p><h2 class="poll-title" tabindex="-1">${escape(poll.title)}</h2>${deadline}${choices}${results}${hidden}<aside id="ownership-notice" class="note" aria-label="Creator access">${poll.isOwner?'You manage this poll through this browser session. Keep its site data.':'You can view this poll; only the creator can manage it.'}<details><summary>How do I keep creator access?</summary><p>To manage the poll, open it in the creator’s original browser and profile. Clearing cookies or ending private browsing loses that session. The link and recent polls list cannot restore permission. Automatic recovery is unavailable. You can vote in an open poll or create your own.</p></details></aside><div class="row"><button id="share">Send to friends ↗</button><button id="refresh" class="secondary">Refresh</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Close poll</button>':''}${poll.isOwner?`<a class="text-button" href="?copy=${encodeURIComponent(id)}">Create a similar poll</a>`:''}<a class="text-button" href="/decide/">Create your own</a></div></div>`;
  if(restoreFocus)$('.poll-title').focus({preventScroll:true});
  $$('.poll-option').forEach(button=>action(button,async()=>{
    // One pending choice: do not offer a competing vote while its result is unknown.
    $$('.poll-option').forEach(option=>{option.disabled=true;option.dataset.lock='true';});
    try{await boundedApi('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id,button);}
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

