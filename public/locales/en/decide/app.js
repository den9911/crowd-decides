import { $, $$, api, escape, action, share, storage, toast } from '/locales/en/shared/ui.js';
const pendingKey='minute:pending-poll';
const boundedApi=(path,input)=>api(path,input,{}, {signal:AbortSignal.timeout(10000)});
function feedback(message){
 let note=$('#poll-feedback');if(!note){note=document.createElement('p');note.id='poll-feedback';note.className='note';note.setAttribute('role','status');$('#app').prepend(note);}note.textContent=message;
}
export async function mount(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id){await showPoll(id);return;}
  const templateId=new URLSearchParams(location.search).get('copy');
  let template=null;
  if(templateId){
    try{template=await api(`/api/poll/template?id=${encodeURIComponent(templateId)}`);}
    catch(error){if(error.code!=='OWNER_SESSION_REQUIRED')throw error;await showPoll(templateId);toast('This session cannot manage the poll. Open it in the creator’s original browser.');return;}
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>What are we deciding?</h2>${template?'<p class="note">This is a new draft. Votes and the original closed state are not copied.</p>':''}<label>Question<input name="title" maxlength="160" required placeholder="What should we name our cat?"></label><label>Options — one per line<textarea name="options" maxlength="485" rows="6" required placeholder="Donut&#10;Pixel&#10;Sir Loaf"></textarea></label><p class="small muted">2 to 6 options, up to 80 characters each.</p><button type="submit">Create poll ↗</button></form><div class="stack"><div class="panel stack"><h2>One question. One link.</h2><p class="muted">Create a poll and send it to your chat. Friends can vote without signing up, and everyone sees the result.</p><p class="small muted">Anyone with the link can access the poll. Do not add confidential information.</p></div>${recent.length?`<div class="panel stack"><h3>Your recent polls</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">This list stays in your browser. A recent link does not prove ownership.</p></div>`:''}</div></div>`;
  const form=$('#create-poll');let pending=null,pendingInvalid=false;
  try{const raw=sessionStorage.getItem(pendingKey);pendingInvalid=raw!==null;if(raw&&raw.length<=2000){const value=JSON.parse(raw);if(typeof value.requestId==='string'&&/^[a-f0-9-]{36}$/.test(value.requestId)&&typeof value.title==='string'&&value.title.length<=160&&Array.isArray(value.options)&&value.options.length>=2&&value.options.length<=6&&value.options.every(v=>typeof v==='string'&&v.length<=80)){pending=value;pendingInvalid=false;}}}
  catch{pendingInvalid=true;}
  if(pendingInvalid){form.elements.title.readOnly=true;form.elements.options.readOnly=true;const submit=$('button[type=submit]',form);submit.disabled=true;submit.dataset.lock='true';feedback('The saved request is unavailable. Review recent polls in the original browser before creating another.');}
  if(pending){form.elements.title.value=pending.title;form.elements.options.value=pending.options.join('\n');form.elements.title.readOnly=true;form.elements.options.readOnly=true;feedback('Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');}
  if(template&&!pending){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}action(form,async()=>{
    if(pendingInvalid)throw new Error('The saved request is unavailable. Review recent polls in the original browser before creating another.');
    const title=form.elements.title.value,options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!pending){pending={requestId:crypto.randomUUID(),title,options};try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}catch{pending=null;throw new Error('The browser could not save the request. Allow session storage before submitting.');}}
    form.elements.title.readOnly=true;form.elements.options.readOnly=true;
    let result;
    try{result=await boundedApi('/api/polls',pending);}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;form.elements.title.readOnly=false;form.elements.options.readOnly=false;throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('This identifier was used for a different poll. Retry the original request.');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'Creation belongs to the original browser session. Open that profile; no new copy was created.':'Creation is unconfirmed. Submit again to retry the same request. Keep your browser data.');return;
    }
    try{sessionStorage.removeItem(pendingKey);}catch{}storage.set('my-polls',[{id:result.id,title:pending.title},...recent.filter(p=>p.id!==result.id)].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id){
  const poll=await boundedApi(`/api/poll?id=${encodeURIComponent(id)}`);
  const counts=poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0),total=counts.reduce((a,b)=>a+b,0);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'POLL CLOSED':'A DECISION IS IN THE MAKING'}</p><h2 class="poll-title">${escape(poll.title)}</h2>${poll.choice===null&&!poll.closed?`<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="small muted">${total} votes. Vote to see the results.</p>`:`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${poll.choice===String(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Total votes: ${total}. ${poll.choice!==null?'Your vote is counted.':'This poll is closed.'}</p>`}<aside id="ownership-notice" class="note" aria-label="Creator access">${poll.isOwner?'You manage this poll through this browser session. Keep its site data.':'You can view this poll; only the creator can manage it.'}<details><summary>How do I keep creator access?</summary><p>To manage the poll, open it in the creator’s original browser and profile. Clearing cookies or ending private browsing loses that session. The link and recent polls list cannot restore permission. Automatic recovery is unavailable. You can vote in an open poll or create your own.</p></details></aside><div class="row"><button id="share">Send to friends ↗</button><button id="refresh" class="secondary">Refresh</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Close poll</button>':''}${poll.isOwner?`<a class="text-button" href="?copy=${encodeURIComponent(id)}">Create a similar poll</a>`:''}<a class="text-button" href="/decide/">Create your own</a></div></div>`;
  $$('.poll-option').forEach(button=>action(button,async()=>{await api('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id);}));
  action($('#share'),()=>share(location.href,'Crowd Decides',poll.title));action($('#refresh'),()=>showPoll(id));
  if($('#close'))action($('#close'),async()=>{
    try{await boundedApi('/api/poll/close',{id});await showPoll(id);}
    catch(error){
      // A missing response is not proof of failure. Reconcile with GET; never replay POST automatically.
      $('#close')?.remove();
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(id);}catch{}
        feedback('This session cannot manage the poll. Open it in the creator’s original browser.');return;
      }
      try{await showPoll(id);feedback('The server state was refreshed. Check whether the poll is closed.');}
      catch{feedback('Closing is unconfirmed. Use Refresh to check the state. The request is not sent again automatically.');}

    }
  });
}

