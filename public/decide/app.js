import { $, $$, api, escape, action, share, storage } from '/shared/ui.js';
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
 const retry=$('#create-poll button[type=submit]');if(retry&&retry.dataset.lock!=='true'){retry.textContent='Повторить тот же запрос';$('#create-poll').setAttribute('aria-describedby','poll-feedback');}
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
        try{await showPoll(templateId);feedback('Управление недоступно в этой сессии. Откройте опрос в исходном браузере создателя.');return;}catch{}
      }
      $('#app').innerHTML='<section class="narrow panel stack"><p role="status">Шаблон не загружен. Новый опрос не создан. Проверьте ссылку и исходную сессию, затем повторите загрузку.</p><button id="retry-template">Повторить загрузку шаблона</button><a class="text-button" href="/decide/">Создать свой</a></section>';
      action($('#retry-template'),()=>mount());return;
    }
  }
  const saved=storage.get('my-polls',[]),recent=Array.isArray(saved)?saved:[];
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>Что решаем?</h2>${template?'<p class="note">Это новый черновик. Голоса и настройки завершения исходного опроса не переносятся.</p>':''}<label>Вопрос<input name="title" maxlength="160" required placeholder="Как назовём нашего кота?"></label><label id="poll-options-group">Варианты — каждый с новой строки<textarea name="options" maxlength="485" rows="6" required placeholder="Пончик&#10;Пиксель&#10;Граф Батон"></textarea></label><p id="poll-options-help" class="small muted">От 2 до 6 вариантов, до 80 символов каждый.</p><label id="meeting-slots-group" hidden>Время встречи (UTC, по одному на строку)<textarea name="slots" rows="5" placeholder="2026-12-15T18:30&#10;2026-12-16T18:30" aria-describedby="meeting-slots-help meeting-slots-preview"></textarea></label><p id="meeting-slots-help" class="small muted" hidden>От 2 до 6 разных дат UTC в течение 365 дней. Дедлайн голосования обязателен и должен быть раньше первой встречи.</p><p id="meeting-slots-preview" class="small" role="status" hidden></p><label for="poll-deadline">Дедлайн (UTC, необязательно)</label><input id="poll-deadline" name="deadline" type="datetime-local" aria-describedby="poll-deadline-help poll-deadline-preview"><p id="poll-deadline-help" class="small muted">Пустое поле означает опрос без срока. Укажите дату и время в UTC, не позднее чем через 365 дней.</p><p id="poll-deadline-preview" class="small" role="status"></p><fieldset class="stack" aria-describedby="poll-mode-help"><legend>Тип голосования</legend><label><input type="radio" name="mode" value="single" checked> Один вариант</label><label><input type="radio" name="mode" value="multiple"> Несколько вариантов</label><label><input type="radio" name="mode" value="meeting"> Выбрать дату встречи</label><p id="poll-mode-help" class="small muted">При выборе нескольких вариантов участник отмечает один или больше ответов. Изменить тип после публикации нельзя.</p></fieldset><label><input type="checkbox" name="hideResultsUntilClose"> Скрывать результаты до закрытия</label><p class="small muted">Пока голосование открыто, ни создатель, ни участники не увидят общий счёт. После закрытия результаты станут доступны всем по ссылке.</p><div class="row"><button type="submit">Создать голосование ↗</button><button id="save-poll-draft" class="secondary" type="button">Сохранить черновик</button><button id="restore-poll-draft" class="secondary" type="button">Восстановить черновик</button><button id="delete-poll-draft" class="secondary" type="button">Удалить черновик</button></div><p id="poll-draft-status" class="small muted" role="status" aria-live="polite">Черновик сохраняется только в этом браузере. Он не публикуется автоматически.</p></form><div class="stack"><div class="panel stack"><h2>Один вопрос. Одна ссылка.</h2><p class="muted">Создай опрос и отправь его в чат. Друзья смогут ответить без регистрации, а ты — увидеть общий результат.</p><p class="small muted">Опрос доступен каждому, у кого есть ссылка. Не добавляй конфиденциальные сведения.</p></div>${recent.length?`<div class="panel stack"><h3>Твои недавние опросы</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">Этот список хранится только в твоём браузере. Ссылка в списке не подтверждает владение.</p></div>`:''}</div></div>`;
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
        count:'Укажите от 2 до 6 временных слотов UTC.',
        format:'Укажите корректные даты UTC.',
        duplicate:'Временные слоты должны различаться.',
        bounds:'Все встречи должны быть в будущем в пределах 365 дней.',
        deadline:'Укажите дедлайн голосования раньше первой встречи.'
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
      pending||pendingInvalid?'Публикация ещё не подтверждена. Черновик не может заменить исходный запрос.':
      draftUnreadable?'Сохранённый черновик повреждён или недоступен. Удалите его отдельно; запрос публикации не затронут.':
      savedDraft?'Есть локальный черновик. Восстановите его вручную; отправки на сервер не будет.':
      'Черновик сохраняется только в этом браузере. Он не публикуется автоматически.');
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
    preview.textContent=Number.isFinite(value)?'Ваше местное время: '+localDeadline(value):
      value===null?'Без срока.':'Укажите корректные дату и время UTC.';
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
    feedback('Сохранённый запрос недоступен. Проверьте недавние опросы в исходном браузере перед новым созданием.');
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
    feedback(template?'Есть неподтверждённое создание. Повторяется прежний запрос; загруженный шаблон не применяется.':'Создание ещё не подтверждено. Повторите отправку: будет использован тот же запрос. Не очищайте данные браузера.');
  }else{
    if(template){form.elements.title.value=template.title;form.elements.options.value=template.options.join('\n');}
    showDeadlinePreview(null);
  }
  meetingInputs();
  draftControls();
  action(draftSave,()=>{
    if(pending||pendingInvalid||draftUnreadable)return;
    savedDraft=saveDraft(localStorage,draftFields());
    draftControls('Черновик сохранён в этом браузере. Публикация не выполнялась.');
  });
  action(draftRestore,()=>{
    if(pending||pendingInvalid)return;
    const draft=readDraft(localStorage);
    if(!draft){savedDraft=null;draftControls();return;}
    savedDraft=draft;
    applyDraft(draft);
    form.elements.title.focus();
    draftControls('Черновик восстановлен. Проверьте поля перед публикацией.');
  });
  action(draftDelete,()=>{
    if(pending||pendingInvalid)return;
    clearDraft(localStorage);
    savedDraft=null;draftUnreadable=false;
    draftControls('Локальный черновик удалён. Форма и запрос публикации не изменились.');
  });
  action(form,async()=>{
    if(pendingInvalid)return;
    if(!pending){
      const expiresAt=deadline.validity.badInput?NaN:parseUtcMinute(deadline.value);
      if(Number.isNaN(expiresAt)){
        deadline.setCustomValidity('Укажите корректные дату и время UTC.');
        showDeadlinePreview(NaN);deadline.reportValidity();deadline.focus();return;
      }
      const title=form.elements.title.value.trim(),mode=form.querySelector('input[name="mode"]:checked').value;
      const meeting=mode==='meeting';
      const options=meeting?[]:form.elements.options.value.split('\n').map(x=>x.trim()).filter(Boolean);
      const meetingResult=meeting?meetingInput(slotsControl.value,expiresAt):null;
      const slots=meeting?meetingResult.slots:null;
      if(!title||(!meeting&&(options.length<2||options.length>6||options.some(option=>option.length>80)))){
        throw new Error('Укажите вопрос и от 2 до 6 вариантов, до 80 символов каждый.');
      }
      if(meeting&&meetingResult.reason){
        meetingInputs();
        (meetingResult.reason==='deadline'?deadline:slotsControl).focus();
        throw new Error('Укажите 2–6 разных будущих слотов UTC и дедлайн голосования раньше первой встречи.');
      }
      pending={version:3,requestId:crypto.randomUUID(),title,options,slots,expiresAt,
        hideResultsUntilClose:hiddenControl.checked,mode};
      try{sessionStorage.setItem(pendingKey,JSON.stringify(pending));}
      catch{pending=null;throw new Error('Браузер не разрешил сохранить запрос. Разрешите хранилище сессии перед отправкой.');}
    }
    lockFields(true);
    let result;
    try{result=await boundedApi('/api/polls',pollCreationPayload(pending));}
    catch(error){
      if(error.status===400){try{sessionStorage.removeItem(pendingKey);}catch{}pending=null;lockFields(false);draftControls();$('#poll-feedback')?.remove();form.removeAttribute('aria-describedby');$('button[type=submit]',form).textContent='Создать голосование ↗';throw error;}
      if(error.code==='POLL_REQUEST_CONFLICT'){feedback('Этот идентификатор уже использован для другого опроса. Повторите исходный запрос.');return;}
      feedback(error.code==='OWNER_SESSION_REQUIRED'?'Создание связано с исходной сессией браузера. Откройте исходный профиль; новая копия не создана.':'Создание ещё не подтверждено. Повторите отправку: будет использован тот же запрос. Не очищайте данные браузера.');return;
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
    `<form id="multi-vote" class="stack"><fieldset class="stack"><legend>Выберите один или несколько вариантов</legend>${options.map((option,i)=>`<label><input type="checkbox" name="choices" value="${i}"> ${escape(option)}</label>`).join('')}</fieldset><p class="small muted">Одна сессия браузера — один ответ. Выбранные варианты будут сохранены вместе.</p><button type="submit">Отправить ответ</button></form>`:
    `<div>${options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div>`;
  const results=canVote
    ?resultsVisible?`<p class="small muted">${total} голосов. Результат откроется после твоего ответа.</p>`:''
    :resultsVisible?`<div>${options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${selected.includes(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Всего голосов: ${total}. ${poll.choice!==null?'Твой ответ учтён.':'Опрос завершён.'}${multiple?' Один участник может выбрать несколько вариантов.':''}</p>`:'';
  const hidden=resultsVisible?'':`<div class="note" id="poll-results-hidden"><p>Результаты откроются после завершения опроса.</p>${poll.choice!==null?`<p>Твой ответ учтён. ${selected.map(i=>escape(options[i])).join(', ')}</p>`:''}</div>`;
  const deadline=Number.isSafeInteger(poll.expiresAt)&&poll.expiresAt>0&&poll.expiresAt<=8_640_000_000_000_000
    ?`<p class="small muted">Дедлайн: <time id="poll-deadline-value" datetime="${new Date(poll.expiresAt).toISOString()}">${escape(localDeadline(poll.expiresAt))}</time></p>`:'';
  const restoreFocus=trigger&&(document.activeElement===trigger||document.activeElement===document.body);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">${poll.closed?'ОПРОС ЗАВЕРШЁН':'РЕШЕНИЕ ПРИНИМАЕТСЯ'}</p><h2 class="poll-title" tabindex="-1">${escape(poll.title)}</h2>${deadline}${choices}${results}${hidden}<aside id="ownership-notice" class="note" aria-label="Доступ создателя">${poll.isOwner?'Вы управляете этим опросом через текущую сессию браузера. Сохраните данные сайта.':'Вы просматриваете опрос. Управлять им может только создатель.'}<details><summary>Как сохранить доступ создателя?</summary><p>Для управления откройте опрос в исходном браузере и профиле создателя. После удаления cookie или завершения приватного просмотра эта сессия теряется. Ссылка и список недавних опросов не восстанавливают права. Автоматического восстановления нет. Можно участвовать в открытом опросе или создать свой.</p></details></aside><div class="row"><button id="share">Отправить друзьям ↗</button><button id="refresh" class="secondary">Обновить</button>${poll.isOwner&&!poll.closed?'<button id="close" class="secondary">Завершить опрос</button>':''}${poll.isOwner&&!meeting?`<a class="text-button" href="?copy=${encodeURIComponent(id)}">Создать похожий</a>`:''}<a class="text-button" href="/decide/">Создать свой</a></div></div>`;
  if(restoreFocus)$('.poll-title').focus({preventScroll:true});
  $$('.poll-option').forEach(button=>action(button,async()=>{
    // One pending choice: do not offer a competing vote while its result is unknown.
    $$('.poll-option').forEach(option=>{option.disabled=true;option.dataset.lock='true';});
    try{await boundedApi('/api/poll/vote',meeting?{id,slot:Number(button.dataset.index)}:{id,choice:Number(button.dataset.index)});await showPoll(id,button);}
    catch(error){
      try{
        await showPoll(id,button);
        feedback(error.code==='POLL_CLOSED'?'Опрос уже закрыт. Состояние перечитано с сервера.':error.code==='POLL_ALREADY_VOTED'?'Ваш голос уже учтён. Показан сохранённый ответ.':'Состояние голоса перечитано с сервера. Проверьте свой ответ и результат.');
      }
      catch{feedback(error.code==='POLL_CLOSED'?'Сервер подтвердил закрытие. Нажмите «Обновить», чтобы загрузить итог.':'Результат голоса не подтверждён. Нажмите «Обновить», чтобы проверить состояние. Повторная отправка не выполняется.');}
    }
  }));
  const multiForm=$('#multi-vote');
  if(multiForm)action(multiForm,async()=>{
    const checked=Array.from(multiForm.querySelectorAll('input[name="choices"]:checked')).map(input=>Number(input.value));
    if(!checked.length){feedback('Отметьте хотя бы один вариант.');multiForm.querySelector('input')?.focus();return;}
    multiForm.querySelectorAll('input,button').forEach(input=>{input.disabled=true;});
    try{await boundedApi('/api/poll/vote',{id,choices:checked});await showPoll(id,multiForm);}
    catch(error){
      try{await showPoll(id,multiForm);feedback('Состояние голоса перечитано с сервера. Проверьте свой ответ и результат.');}
      catch{feedback(error.code==='POLL_CLOSED'?'Опрос уже закрыт. Нажмите «Обновить».':'Результат голоса не подтверждён. Нажмите «Обновить», не повторяя отправку.');}
    }
  },'submit');
  action($('#share'),()=>share(location.href,'Решайте',poll.title));const refresh=$('#refresh');action(refresh,()=>showPoll(id,refresh));
  const close=$('#close');
  if(close)action(close,async()=>{
    try{await boundedApi('/api/poll/close',{id});await showPoll(id,close);}
    catch(error){
      // A missing response is not proof of failure. Reconcile with GET; never replay POST automatically.
      $('#close')?.remove();
      if(error.code==='OWNER_SESSION_REQUIRED'){
        try{await showPoll(id,close);}catch{}
        feedback('Управление недоступно в этой сессии. Откройте опрос в исходном браузере создателя.');return;
      }
      try{await showPoll(id,close);feedback('Состояние перечитано с сервера. Проверьте, завершён ли опрос.');}
      catch{feedback('Результат завершения не подтверждён. Нажмите «Обновить», чтобы проверить состояние. Повторная отправка не выполняется.');}

    }
  });
}

