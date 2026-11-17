import { $, $$, api, escape, action, share, storage, toast } from '/locales/ru/shared/ui.js';
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
    catch(error){if(error.code!=='OWNER_SESSION_REQUIRED')throw error;await showPoll(templateId);toast('Управление недоступно в этой сессии. Откройте опрос в исходном браузере создателя.');return;}
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>Что решаем?</h2>${template?'<p class="note">Это новый черновик. Голоса и закрытие исходного опроса не переносятся.</p>':''}<label>Вопрос<input name="title" maxlength="160" required placeholder="Как назовём нашего кота?"></label><label>Варианты — каждый с новой строки<textarea name="options" maxlength="485" rows="6" required placeholder="Пончик&#10;Пиксель&#10;Граф Батон"></textarea></label><p class="small muted">От 2 до 6 вариантов, до 80 символов каждый.</p><button type="submit">Создать голосование ↗</button></form><div class="stack"><div class="panel stack"><h2>Один вопрос. Одна ссылка.</h2><p class="muted">Создай опрос и отправь его в чат. Друзья смогут ответить без регистрации, а ты — увидеть общий результат.</p><p class="small muted">Опрос доступен каждому, у кого есть ссылка. Не добавляй конфиденциальные сведения.</p></div>${recent.length?`<div class="panel stack"><h3>Твои недавние опросы</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">Этот список хранится только в твоём браузере. Ссылка в списке не подтверждает владение.</p></div>`:''}</div></div>`;
  const form=$('#create-poll');let pending=null,pendingInvalid=false;
  try{const raw=sessionStorage.getItem(pendingKey);pendingInvalid=raw!==null;if(raw&&raw.length<=2000){const value=JSON.parse(raw);if(typeof value.requestId==='string'&&/^[a-f0-9-]{36}$/.test(value.requestId)&&typeof value.title==='string'&&value.title.length<=160&&Array.isArray(value.options)&&value.options.length>=2&&value.options.length<=6&&value.options.every(v=>typeof v==='string'&&v.length<=80)){pending=value;pendingInvalid=false;}}}
  catch{pendingInvalid=true;}
  if(pendingInvalid){form.elements.title.readOnly=true;form.elements.options.readOnly=true;const submit=$('button[type=submit]',form);submit.disabled=true;submit.dataset.lock='true';feedback('Сохранённый запрос недоступен. Проверьте недавние опросы в исходном браузере перед новым созданием.');}
  if(pending){form.elements.title.value=pending.title;form.elements.options.value=pending.options.join('\n');form.elements.title.readOnly=true;form.elements.options.readOnly=true;feedback('Создание ещё не подтверждено. Повторите отправку: будет использован тот же запрос. Не очищайте данные браузера.');}
  if(template&&!pending){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}action(form,async()=>{
    if(pendingInvalid)throw new Error('Сохранённый запрос недоступен. Проверьте недавние опросы в исходном браузере перед новым созданием.');
    const title=form.elements.title.value,options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!pending){pending={requestId:crypto.randomUUID(),title,options};try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}catch{pending=null;throw new Error('Браузер не разрешил сохранить запрос. Разрешите хранилище сессии перед отправкой.');}}
    form.elements.title.readOnly=true;form.elements.options.readOnly=true;
    let result;
    try{result=await boundedApi('/api/polls',pending);}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;form.elements.title.readOnly=false;form.elements.options.readOnly=false;throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('Этот идентификатор уже использован для другого опроса. Повторите исходный запрос.');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'Создание связано с исходной сессией браузера. Откройте исходный профиль; новая копия не создана.':'Создание ещё не подтверждено. Повторите отправку: будет использован тот же запрос. Не очищайте данные браузера.');return;
    }
    try{sessionStorage.removeItem(pendingKey);}catch{}storage.set('my-polls',[{id:result.id,title:pending.title},...recent.filter(p=>p.id!==result.id)].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id){
  const poll=await boundedApi(`/api/poll?id=${encodeURIComponent(id)}`);
  const counts=poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0),total=counts.reduce((a,b)=>a+b,0);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'ОПРОС ЗАВЕРШЁН':'РЕШЕНИЕ ПРИНИМАЕТСЯ'}</p><h2 class="poll-title">${escape(poll.title)}</h2>${poll.choice===null&&!poll.closed?`<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="small muted">${total} голосов. Результат откроется после твоего ответа.</p>`:`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${poll.choice===String(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Всего голосов: ${total}. ${poll.choice!==null?'Твой ответ учтён.':'Опрос завершён.'}</p>`}<aside id="ownership-notice" class="note" aria-label="Доступ создателя">${poll.isOwner?'Вы управляете этим опросом через текущую сессию браузера. Сохраните данные сайта.':'Вы просматриваете опрос. Управлять им может только создатель.'}<details><summary>Как сохранить доступ создателя?</summary><p>Для управления откройте опрос в исходном браузере и профиле создателя. После удаления cookie или завершения приватного просмотра эта сессия теряется. Ссылка и список недавних опросов не восстанавливают права. Автоматического восстановления нет. Можно участвовать в открытом опросе или создать свой.</p></details></aside><div class="row"><button id="share">Отправить друзьям ↗</button><button id="refresh" class="secondary">Обновить</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Завершить опрос</button>':''}${poll.isOwner?`<a class="text-button" href="?copy=${encodeURIComponent(id)}">Создать похожий</a>`:''}<a class="text-button" href="/decide/">Создать свой</a></div></div>`;
  $$('.poll-option').forEach(button=>action(button,async()=>{await api('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id);}));
  action($('#share'),()=>share(location.href,'Решайте',poll.title));action($('#refresh'),()=>showPoll(id));
  if($('#close'))action($('#close'),async()=>{
    try{await boundedApi('/api/poll/close',{id});await showPoll(id);}
    catch(error){
      // A missing response is not proof of failure. Reconcile with GET; never replay POST automatically.
      $('#close')?.remove();
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(id);}catch{}
        feedback('Управление недоступно в этой сессии. Откройте опрос в исходном браузере создателя.');return;
      }
      try{await showPoll(id);feedback('Состояние перечитано с сервера. Проверьте, завершён ли опрос.');}
      catch{feedback('Результат завершения не подтверждён. Нажмите «Обновить», чтобы проверить состояние. Повторная отправка не выполняется.');}

    }
  });
}

