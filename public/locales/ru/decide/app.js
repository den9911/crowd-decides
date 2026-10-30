import { $, $$, api, escape, action, share, storage } from '/locales/ru/shared/ui.js';
export async function mount(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id){await showPoll(id);return;}
  const recent=storage.get('my-polls',[]);
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>Что решаем?</h2><label>Вопрос<input name="title" maxlength="160" required placeholder="Как назовём нашего кота?"></label><label>Варианты — каждый с новой строки<textarea name="options" maxlength="485" rows="6" required placeholder="Пончик&#10;Пиксель&#10;Граф Батон"></textarea></label><p class="small muted">От 2 до 6 вариантов, до 80 символов каждый.</p><button type="submit">Создать голосование ↗</button></form><div class="stack"><div class="panel stack"><h2>Один вопрос. Одна ссылка.</h2><p class="muted">Создай опрос и отправь его в чат. Друзья смогут ответить без регистрации, а ты — увидеть общий результат.</p><p class="small muted">Опрос доступен каждому, у кого есть ссылка. Не добавляй конфиденциальные сведения.</p></div>${recent.length?`<div class="panel stack"><h3>Твои недавние опросы</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">Этот список хранится только в твоём браузере.</p></div>`:''}</div></div>`;
  const form=$('#create-poll');action(form,async()=>{
    const title=form.elements.title.value,options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
    const result=await api('/api/polls',{title,options});storage.set('my-polls',[{id:result.id,title},...recent].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id){
  const poll=await api(`/api/poll?id=${encodeURIComponent(id)}`);
  const counts=poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0),total=counts.reduce((a,b)=>a+b,0);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'ОПРОС ЗАВЕРШЁН':'РЕШЕНИЕ ПРИНИМАЕТСЯ'}</p><h2 class="poll-title">${escape(poll.title)}</h2>${poll.choice===null&&!poll.closed?`<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="small muted">${total} голосов. Результат откроется после твоего ответа.</p>`:`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${poll.choice===String(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Всего голосов: ${total}. ${poll.choice!==null?'Твой ответ учтён.':'Опрос завершён.'}</p>`}<div class="row"><button id="share">Отправить друзьям ↗</button><button id="refresh" class="secondary">Обновить</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Завершить опрос</button>':''}<a class="text-button" href="/decide/">Создать свой</a></div></div>`;
  $$('.poll-option').forEach(button=>action(button,async()=>{await api('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id);}));
  action($('#share'),()=>share(location.href,'Решайте',poll.title));action($('#refresh'),()=>showPoll(id));
  if($('#close'))action($('#close'),async()=>{await api('/api/poll/close',{id});await showPoll(id);});
}
