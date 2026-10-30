import { $, $$, api, escape, action, share, storage } from '/locales/en/shared/ui.js';
export async function mount(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id){await showPoll(id);return;}
  const recent=storage.get('my-polls',[]);
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>What are we deciding?</h2><label>Question<input name="title" maxlength="160" required placeholder="What should we name our cat?"></label><label>Options — one per line<textarea name="options" maxlength="485" rows="6" required placeholder="Donut&#10;Pixel&#10;Sir Loaf"></textarea></label><p class="small muted">2 to 6 options, up to 80 characters each.</p><button type="submit">Create poll ↗</button></form><div class="stack"><div class="panel stack"><h2>One question. One link.</h2><p class="muted">Create a poll and send it to your chat. Friends can vote without signing up, and everyone sees the result.</p><p class="small muted">Anyone with the link can access the poll. Do not add confidential information.</p></div>${recent.length?`<div class="panel stack"><h3>Your recent polls</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">This list stays in your browser.</p></div>`:''}</div></div>`;
  const form=$('#create-poll');action(form,async()=>{
    const title=form.elements.title.value,options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
    const result=await api('/api/polls',{title,options});storage.set('my-polls',[{id:result.id,title},...recent].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id){
  const poll=await api(`/api/poll?id=${encodeURIComponent(id)}`);
  const counts=poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0),total=counts.reduce((a,b)=>a+b,0);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'POLL CLOSED':'A DECISION IS IN THE MAKING'}</p><h2 class="poll-title">${escape(poll.title)}</h2>${poll.choice===null&&!poll.closed?`<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="small muted">${total} votes. Vote to see the results.</p>`:`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${poll.choice===String(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Total votes: ${total}. ${poll.choice!==null?'Your vote is counted.':'This poll is closed.'}</p>`}<div class="row"><button id="share">Send to friends ↗</button><button id="refresh" class="secondary">Refresh</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Close poll</button>':''}<a class="text-button" href="/decide/">Create your own</a></div></div>`;
  $$('.poll-option').forEach(button=>action(button,async()=>{await api('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id);}));
  action($('#share'),()=>share(location.href,'Crowd Decides',poll.title));action($('#refresh'),()=>showPoll(id));
  if($('#close'))action($('#close'),async()=>{await api('/api/poll/close',{id});await showPoll(id);});
}
