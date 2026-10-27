import { $, $$, api, escape, action, share, storage } from '/locales/es/shared/ui.js';
export async function mount(){
  const id=new URLSearchParams(location.search).get('poll');
  if(id){await showPoll(id);return;}
  const recent=storage.get('my-polls',[]);
  $('#app').innerHTML=`<div class="split"><form id="create-poll" class="panel stack"><h2>¿Qué decidimos?</h2><label>Pregunta<input name="title" maxlength="160" required placeholder="¿Cómo llamamos a nuestro gato?"></label><label>Opciones: una por línea<textarea name="options" maxlength="485" rows="6" required placeholder="Donut&#10;Píxel&#10;Don Pan"></textarea></label><p class="small muted">De 2 a 6 opciones, hasta 80 caracteres cada una.</p><button type="submit">Crear encuesta ↗</button></form><div class="stack"><div class="panel stack"><h2>Una pregunta. Un enlace.</h2><p class="muted">Crea una encuesta y envíala al chat. Tus amigos votan sin registrarse y todos ven el resultado.</p><p class="small muted">Cualquiera con el enlace puede acceder. No incluyas información confidencial.</p></div>${recent.length?`<div class="panel stack"><h3>Tus encuestas recientes</h3>${recent.slice(0,8).map(p=>`<a href="?poll=${escape(p.id)}">${escape(p.title)}</a>`).join('')}<p class="small muted">Esta lista se guarda solo en tu navegador.</p></div>`:''}</div></div>`;
  const form=$('#create-poll');action(form,async()=>{
    const title=form.elements.title.value,options=form.elements.options.value.split('\n').map(s=>s.trim()).filter(Boolean);
    const result=await api('/api/polls',{title,options});storage.set('my-polls',[{id:result.id,title},...recent].slice(0,20));location.href=`?poll=${result.id}`;
  },'submit');
}
async function showPoll(id){
  const poll=await api(`/api/poll?id=${encodeURIComponent(id)}`);
  const counts=poll.options.map((_,i)=>poll.counts.find(c=>c.choice===String(i))?.count??0),total=counts.reduce((a,b)=>a+b,0);
  $('#app').innerHTML=`<div class="narrow panel stack"><p class="eyebrow">DECISIÓN EN MARCHA</p><h2 class="poll-title">${escape(poll.title)}</h2>${poll.choice===null?`<div>${poll.options.map((option,i)=>`<button class="poll-option" data-index="${i}">${escape(option)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="small muted">${total} votos. Vota para ver los resultados.</p>`:`<div>${poll.options.map((option,i)=>`<div class="result-line"><div class="row"><span>${escape(option)} ${poll.choice===String(i)?'✓':''}</span><strong>${Math.round(counts[i]/Math.max(1,total)*100)}% · ${counts[i]}</strong></div><progress max="${Math.max(1,total)}" value="${counts[i]}" aria-label="${escape(option)}"></progress></div>`).join('')}</div><p class="small muted">Votos totales: ${total}. Tu voto se ha registrado.</p>`}<div class="row"><button id="share">Enviar a tus amigos ↗</button><button id="refresh" class="secondary">Actualizar</button><a class="text-button" href="/decide/">Crear la tuya</a></div></div>`;
  $$('.poll-option').forEach(button=>action(button,async()=>{await api('/api/poll/vote',{id,choice:Number(button.dataset.index)});await showPoll(id);}));
  action($('#share'),()=>share(location.href,'Vosotros decidís',poll.title));action($('#refresh'),()=>showPoll(id));
}
