import './style.css';
import { initial } from './demo-data.js';
import { CloudRepository, readConfig, safeImage } from './repository.js';
'use strict';
const paths={chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',box:'m21 8-9 5-9-5 M12 13v9 M3 7l9-5 9 5v10l-9 5-9-5z M7.5 4.5l9 5',truck:'M1 3h14v13H1z M15 8h4l3 4v4h-7 M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',chevronDown:'m6 9 6 6 6-6',plus:'M12 5v14 M5 12h14',search:'M21 21l-5-5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',sort:'M4 7h16 M7 12h10 M10 17h4',shield:'m12 22-8-4V4l8-3 8 3v14z m-4-11 3 3 5-5',panel:'M3 3h18v18H3z M15 3v18',more:'M5 12h.01 M12 12h.01 M19 12h.01',arrowLeft:'M19 12H5 m7-7-7 7 7 7',arrowRight:'M5 12h14 m-7-7 7 7-7 7',bolt:'m13 2-9 12h7l-1 8 10-13h-8z',smile:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M8 14s1 3 4 3 4-3 4-3 M8 9h.01 M16 9h.01',paperclip:'m21.4 11.6-9.2 9.2a6 6 0 0 1-8.5-8.5L13.6 2.4a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 0 1-2.8-2.8l9.2-9.2',send:'m22 2-7 20-4-9-9-4 20-7z M22 2 11 13',lock:'M5 11h14v11H5z M8 11V7a4 4 0 0 1 8 0v4',check:'m5 12 4 4L19 6',checks:'m3 12 4 4L17 6 M12 16l9-10',x:'m6 6 12 12 M6 18 18 6',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n]||paths.chat}"/></svg>`;
const $=s=>document.querySelector(s);const $$=s=>Array.from(document.querySelectorAll(s));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let repository=null,cloudMode=false,saving=false,refreshTimer=null,refreshing=false,refreshAgain=false,sessionGeneration=0;
let chats=structuredClone(initial),storageAvailable=true;try{const saved=JSON.parse(localStorage.getItem('wasl-inbox-v1'));if(Array.isArray(saved)&&saved.length&&saved.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&Array.isArray(c.messages)))chats=saved}catch(e){}
let activeId=chats[0].id,filter='all',reverseSort=false,attachment=null,toastTimer;const drafts={};const current=()=>chats.find(c=>c.id===activeId);const statusLabels={open:'مفتوحة',pending:'قيد المتابعة',resolved:'تم الحل'};
function persist(){if(cloudMode)return true;try{localStorage.setItem('wasl-inbox-v1',JSON.stringify(chats));storageAvailable=true;return true}catch(e){storageAvailable=false;toast('تعذّر الحفظ في المتصفح. التغييرات متاحة مؤقتاً في هذه الجلسة.');return false}}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200)}
function avatar(c,big=false){return `<span class="avatar ${esc(c.color)} ${c.online?'online':''} ${big?'big':''}">${esc(c.initials)}</span>`}
function fillIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon))}
function last(c){return [...c.messages].reverse().find(m=>m.by!=='event')}
function renderList(){const q=$('#search').value.trim().toLowerCase();let list=chats.filter(c=>(filter==='all'||(filter==='unread'?c.unread>0:c.type===filter))&&(!q||[c.name,c.order,...c.messages.map(m=>m.text||'صورة مرفقة')].join(' ').toLowerCase().includes(q)));if(reverseSort)list=[...list].reverse();$('#conversationList').innerHTML=list.length?list.map(c=>`<button class="conversation-row ${c.id===activeId?'active':''}" data-id="${esc(c.id)}" aria-label="محادثة ${esc(c.name)}" aria-current="${c.id===activeId}">${avatar(c)}<div class="row-content"><div class="row-top"><strong>${esc(c.name)}${c.type==='driver'?'<span class="role-tag">مندوب</span>':''}</strong><time>${esc(c.time)}</time></div><div class="last-message">${last(c)?.by==='me'?'أنت: ':''}${esc(last(c)?.text||(last(c)?.image?'📎 صورة مرفقة':'ابدأ المحادثة'))}</div><div class="row-bottom"><span class="order-label">#W-${esc(c.order)}</span>${c.unread?`<span class="unread-badge">${c.unread}</span>`:`<span class="read-check">${c.status==='resolved'?icon('check'):''}</span>`}</div></div></button>`).join(''):'<div class="empty-list">لا توجد محادثات مطابقة<br>جرّب اسماً أو رقم طلب آخر</div>';$('#listCount').textContent=list.length;$('#totalCount').textContent=chats.length;$('#unreadCount').textContent=chats.filter(c=>c.unread>0).length;$('#resolvedCount').textContent=chats.filter(c=>c.status==='resolved').length}
function renderDetails(){const c=current();if(!c){$('#detailsPanel').innerHTML='<p class="detail-note">اختر محادثة لعرض الطلب</p>';return;}$('#detailsPanel').innerHTML=`<div class="details-heading"><h3>تفاصيل الطلب</h3><button class="icon-btn" id="closeDetails" aria-label="إغلاق التفاصيل">${icon('x')}</button></div><div class="order-card"><div class="order-card-top"><span class="package-icon">${icon('box')}</span><div><small>رقم الطلب</small><b dir="ltr">#W-${esc(c.order)}</b></div></div><div class="delivery-badge">${icon(c.orderState==='تم التسليم'?'check':'truck')} ${esc(c.orderState)}</div></div><div class="section-label">رحلة الطلب</div><div class="route"><div class="route-point"><small>نقطة الاستلام</small><strong>${esc(c.restaurant||'لم يُحدد المتجر بعد')}</strong><p>${esc(c.pickup||'بانتظار بيانات الطلب')}</p></div><div class="route-point destination"><small>عنوان التوصيل</small><strong>${esc(c.address||'لم يُحدد العنوان بعد')}</strong><p>عدن، اليمن</p></div></div><div class="section-label">مندوب التوصيل</div><div class="driver-card"><span class="avatar sage">${esc((c.driver||'—').split(' ').map(s=>s[0]).slice(0,2).join(' '))}</span><div><strong>${esc(c.driver||'لم يُعيّن مندوب')}</strong><small>${c.driver?'مندوب الطلب':'بانتظار التعيين'}</small></div><button id="contactDriver" aria-label="مراسلة المندوب">${icon('chat')}</button></div><div class="section-label">ملخص الدفع</div><div class="detail-pair"><span>قيمة الطلب</span><strong>${esc(c.amount||'—')} ر.ي</strong></div><div class="detail-pair"><span>رسوم التوصيل</span><strong>${esc(c.delivery||'—')} ر.ي</strong></div><div class="detail-pair"><span>طريقة الدفع</span><strong>${esc(c.payment||'غير محددة')}</strong></div>${c.payment==='مدفوع إلكترونياً'?'<div class="payment-state">تم الدفع</div>':''}<button class="resolve-btn" id="resolveBtn">${icon(c.status==='resolved'?'chat':'check')} ${c.status==='resolved'?'إعادة فتح المحادثة':'تحديد المحادثة كمحلولة'}</button><p class="detail-note">${c.status==='resolved'?'تمت معالجة هذه المحادثة':'كل محادثة فرصة لتجربة أفضل'}</p>`;$('#resolveBtn').onclick=()=>setStatus(c.status==='resolved'?'open':'resolved');$('#closeDetails').onclick=()=>$('#detailsPanel').classList.remove('open');$('#contactDriver').onclick=async()=>{if(saving)return;if(!c.driver)return toast('لم يتم تعيين مندوب لهذا الطلب بعد');let d=chats.find(x=>x.type==='driver'&&x.name===c.driver&&x.order===c.order);if(!d){d={...c,id:crypto.randomUUID(),name:c.driver,initials:c.driver.split(' ').map(s=>s[0]).slice(0,2).join(' '),type:'driver',color:'sage',messages:[],unread:0,status:'open',time:now()};if(cloudMode){try{await repository.create(d)}catch(error){showCloudError(error);return;}}chats.unshift(d);persist()}selectChat(d.id);$('#detailsPanel').classList.remove('open')};}
function renderChat(){const c=current();if(!c){$('#chatAvatar').innerHTML='';$('#chatName').textContent='صندوق الوارد';$('#chatSubtitle').textContent='ابدأ محادثة جديدة';$('#orderStripId').textContent='—';$('#orderStripState').textContent='';$('#messages').innerHTML='<div class="empty-message">لا توجد محادثة محددة<br>أنشئ محادثة جديدة للبدء</div>';$('#messageInput').value='';renderDetails();return;}$('#chatAvatar').innerHTML=avatar(c,true);$('#chatName').textContent=c.name;$('#chatSubtitle').innerHTML=`${c.online?'<i class="online-dot"></i>':''}${c.type==='customer'?'عميل':'مندوب توصيل'} <span>·</span> ${cloudMode?'الحضور غير متاح':c.online?'متاح في بيانات العرض':'غير متصل في بيانات العرض'}`;$('#statusBtn').innerHTML=`<i class="status-dot ${c.status==='resolved'?'green':'orange'}"></i>${statusLabels[c.status]}${icon('chevronDown')}`;$('#orderStripId').textContent='#W-'+c.order;$('#orderStripState').textContent=c.orderState;$('#messages').innerHTML='<div class="date-label">سجل المحادثة</div>'+ (c.messages.length?c.messages.map(m=>m.by==='event'?`<div class="event-label">${icon('checks')}${esc(m.text)}</div>`:`<div class="message ${m.by==='me'?'outgoing':'incoming'}">${m.by==='me'?'<div class="message-name"><span class="mini-agent">م</span>أنت · خدمة العملاء</div>':''}<div class="bubble">${m.image?`<img src="${esc(safeImage(m.image,repository?.origin))}" alt="صورة مرفقة في المحادثة">`:''}${esc(m.text||'')}</div><div class="message-meta"><span>${esc(m.time)}</span>${m.by==='me'?`<span title="${cloudMode?'محفوظة في مساحة العمل':'محفوظة في هذا المتصفح'}">${icon('check')}</span>`:''}</div></div>`).join(''):'<div class="empty-message">بداية تواصل أفضل ✨<br>اكتب أول رسالة لبدء المحادثة</div>');$('#messageInput').value=drafts[c.id]||'';renderDetails();requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight})}
async function selectChat(id){
  if(saving)return;
  drafts[activeId]=$('#messageInput').value;activeId=id;
  const c=current();if(!c)return;
  attachment=null;$('#attachmentPreview').hidden=true;$('#chatMenu').hidden=true;$('#emojiPicker').hidden=true;
  $('.inbox').classList.add('chat-visible');
  if(cloudMode&&c.unread){
    try{await repository.update(c.id,{unread_count:0});c.unread=0;}
    catch(error){showCloudError(error);}
  }else if(!cloudMode){c.unread=0;persist();}
  renderList();renderChat();
}
async function setStatus(status){
  const c=current();if(!c||saving)return;
  if(cloudMode){await cloudMutation(()=>repository.update(c.id,{status}));}
  else{c.status=status;persist();renderList();renderChat();}
}
function now(){return new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Aden'})}
async function send(e){
  e?.preventDefault();if(saving)return;
  const text=$('#messageInput').value.trim(),c=current();
  if(!c)return toast('أنشئ محادثة أولاً');
  if(!text&&!attachment)return;
  if(text.length>4000)return toast('الحد الأقصى للرسالة 4000 حرف');
  if(cloudMode){
    if(!pendingSend||pendingSend.chat!==c.id||pendingSend.text!==text||pendingSend.image!==attachment){pendingSend={id:crypto.randomUUID(),chat:c.id,text,image:attachment};}
    const id=pendingSend.id;
    await cloudMutation(async()=>{
      await repository.send(c.id,text,attachment,id);
      pendingSend=null;
      drafts[c.id]='';attachment=null;$('#messageInput').value='';$('#attachmentPreview').hidden=true;
    });
    return;
  }
  c.messages.push({id:crypto.randomUUID(),by:'me',text,time:now(),...(attachment?{image:attachment}:{})});
  c.time=now();c.unread=0;if(c.status==='resolved')c.status='open';
  chats=chats.filter(x=>x.id!==c.id);chats.unshift(c);drafts[c.id]='';attachment=null;
  $('#messageInput').value='';$('#messageInput').style.height='auto';$('#attachmentPreview').hidden=true;
  persist();renderList();renderChat();$('#messageInput').focus();
}
function info(title,html){$('#infoTitle').textContent=title;$('#infoBody').innerHTML=html;$('#infoDialog').showModal()}
fillIcons();
$('#conversationList').onclick=e=>{const row=e.target.closest('[data-id]');if(row)selectChat(row.dataset.id)};$('#search').oninput=renderList;
$$('[data-filter]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.filter===filter));b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(t=>{t.classList.toggle('selected',t===b);t.setAttribute('aria-selected',String(t===b))});renderList()}});
$('#sortBtn').onclick=()=>{reverseSort=!reverseSort;renderList();toast(reverseSort?'عرض الأقدم أولاً':'عرض الأحدث أولاً')};$('#messageForm').onsubmit=send;
$('#messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}};$('#messageInput').oninput=()=>{drafts[activeId]=$('#messageInput').value;$('#messageInput').style.height='auto';$('#messageInput').style.height=Math.min($('#messageInput').scrollHeight,100)+'px'};
$$('[data-reply]').forEach(b=>b.onclick=()=>{$('#messageInput').value=b.dataset.reply;drafts[activeId]=b.dataset.reply;$('#messageInput').focus()});$('#statusBtn').onclick=()=>{const labels=['open','pending','resolved'];current()&&setStatus(labels[(labels.indexOf(current().status)+1)%labels.length])};
$('#backBtn').onclick=()=>$('.inbox').classList.remove('chat-visible');const showDetails=()=>{if(matchMedia('(max-width:1190px)').matches){$('#detailsPanel').classList.toggle('open')}else{$('#detailsPanel').animate([{background:'#fff0e4'},{background:'#fcfdfd'}],{duration:700});$('#detailsPanel').scrollTop=0}};$('#detailsBtn').onclick=showDetails;$('#viewOrderBtn').onclick=()=>{if(matchMedia('(max-width:1190px)').matches)showDetails();else{$('#detailsPanel').animate([{background:'#fff0e4'},{background:'#fcfdfd'}],{duration:700});$('#detailsPanel').scrollTop=0}};
$('#menuBtn').onclick=e=>{e.stopPropagation();$('#chatMenu').hidden=!$('#chatMenu').hidden};document.addEventListener('click',e=>{if(!e.target.closest('#chatMenu')&&!e.target.closest('#menuBtn'))$('#chatMenu').hidden=true;if(!e.target.closest('#emojiPicker')&&!e.target.closest('#emojiBtn'))$('#emojiPicker').hidden=true});
$('#markUnreadBtn').onclick=async()=>{
  const c=current();if(!c||saving)return;
  if(cloudMode)await cloudMutation(()=>repository.update(c.id,{unread_count:1}));
  else{c.unread=1;persist();renderList();}
  $('#chatMenu').hidden=true;
};
$('#exportBtn').onclick=()=>{const c=current();if(!c)return toast('اختر محادثة أولاً');const content=`وصل — سجل المحادثة\n${c.name}\nالطلب: #W-${c.order}\nالحالة: ${statusLabels[c.status]}\n\n`+c.messages.map(m=>`${m.time||''} ${m.by==='me'?'خدمة العملاء':m.by==='event'?'النظام':c.name}: ${m.text||'[صورة مرفقة]'}`).join('\n\n');const u=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=`Wasl-W-${c.order}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);$('#chatMenu').hidden=true;toast('تم تنزيل سجل المحادثة')};
$('#emojiBtn').onclick=()=>$('#emojiPicker').hidden=!$('#emojiPicker').hidden;$$('#emojiPicker button').forEach(b=>b.onclick=()=>{const input=$('#messageInput');input.setRangeText(b.textContent,input.selectionStart,input.selectionEnd,'end');drafts[activeId]=input.value;input.focus();$('#emojiPicker').hidden=true});
$('#attachBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))return toast('اختر صورة PNG أو JPG أو WebP');if(file.size>5*1024*1024)return toast('الحد الأقصى للصورة 5 ميجابايت');const owner=activeId;try{const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas'),ratio=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=bitmap.width*ratio;canvas.height=bitmap.height*ratio;canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();if(owner!==activeId)return toast('اختر الصورة مجدداً في المحادثة الحالية');attachment=canvas.toDataURL('image/jpeg',.72);$('#attachmentPreview').hidden=false;$('#attachmentPreview').innerHTML=`<img src="${attachment}" alt="معاينة المرفق"><span>${esc(file.name)}</span><button id="removeAttachment" class="icon-btn" aria-label="إزالة المرفق">${icon('x')}</button>`;$('#removeAttachment').onclick=()=>{attachment=null;$('#attachmentPreview').hidden=true}}catch(e){toast('تعذّر فتح الصورة، جرّب صورة أخرى')}};
$('#newChatBtn').onclick=()=>$('#newChatDialog').showModal();$('#closeDialog').onclick=()=>$('#newChatDialog').close();$('#newChatForm').onsubmit=async e=>{e.preventDefault();if(saving)return;const name=$('#newName').value.trim(),order=$('#newOrder').value.trim().replace(/^#?(W-)?/i,'');if(!name||!order)return;const c={id:crypto.randomUUID(),name,initials:name.split(/\s+/).map(s=>s[0]).slice(0,2).join(' '),type:$('#newType').value,color:'blue',online:false,order,orderState:'طلب جديد',status:'open',unread:0,time:now(),messages:[]};if(cloudMode){let created=await cloudMutation(()=>repository.create(c));if(!created)return;}else{chats.unshift(c);persist();}$('#newChatDialog').close();$('#newChatForm').reset();selectChat(c.id);toast('تم إنشاء المحادثة')};
$('#closeInfo').onclick=()=>$('#infoDialog').close();$$('dialog').forEach(d=>d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}});
$('#helpBtn').onclick=()=>info('أهلاً بك في وصل',`<p>واجهة لإدارة محادثات العملاء والمناديب، مرتبطة بتفاصيل طلب التوصيل.</p><p>جرّب البحث والفلاتر، إنشاء محادثة، إرسال رسالة أو صورة، تغيير الحالة، وتنزيل السجل.</p><p>${cloudMode?'أنت في مساحة عمل محفوظة على Supabase. الصندوق خاص بحسابك. استقبال رسائل من عملاء حقيقيين يحتاج ربط تطبيق العميل بهذا النظام.':'هذا عرض تجريبي ببيانات توضيحية، محفوظ في هذا المتصفح فقط.'}</p>`);
$('#notificationsBtn').onclick=()=>{const unread=chats.filter(c=>c.unread);info('محادثات تنتظر الرد',unread.length?unread.map(c=>`<p><button class="resolve-btn" data-open-chat="${esc(c.id)}">${esc(c.name)} · ${c.unread} رسالة غير مقروءة ${icon('arrowLeft')}</button></p>`).join(''):'<p>أنت مطّلع على جميع المحادثات 🎉</p>')};$('#infoBody').onclick=e=>{const b=e.target.closest('[data-open-chat]');if(b){$('#infoDialog').close();selectChat(b.dataset.openChat)}};
$$('[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.view==='inbox'){$('.inbox').classList.remove('chat-visible');return}if(b.dataset.view==='overview')info('نظرة على التواصل',`<p>إجمالي المحادثات: <b>${chats.length}</b></p><p>بانتظار الرد: <b>${chats.filter(c=>c.unread).length}</b></p><p>قيد المتابعة: <b>${chats.filter(c=>c.status==='pending').length}</b></p><p>تم حلها: <b>${chats.filter(c=>c.status==='resolved').length}</b></p>`);if(b.dataset.view==='orders'){const unique=[...new Map(chats.map(c=>[c.order,c])).values()];info('طلبات المحادثات',`<table><tbody>${unique.map(c=>`<tr><td dir="ltr">#W-${esc(c.order)}</td><td>${esc(c.orderState)}</td><td><button data-open-chat="${esc(c.id)}">فتح المحادثة</button></td></tr>`).join('')}</tbody></table>`)}if(b.dataset.view==='drivers')info('المناديب',chats.filter(c=>c.type==='driver').map(c=>`<p><button class="resolve-btn" data-open-chat="${esc(c.id)}">${esc(c.name)} ${icon('chat')}</button></p>`).join('')||'<p>لا يوجد مناديب بعد</p>')});
window.addEventListener('storage',e=>{if(!cloudMode&&e.key==='wasl-inbox-v1'&&e.newValue){try{const updated=JSON.parse(e.newValue);if(Array.isArray(updated)&&updated.some(c=>c.id===activeId)){drafts[activeId]=$('#messageInput').value;chats=updated;renderList();renderChat()}}catch(e){}}});

let activeUserId=null,configError='',pendingSend=null;
function setSaving(value){
  saving=value;
  for(const el of [$('#messageInput'),$('#messageForm button[type="submit"]'),$('#attachBtn'),$('#emojiBtn'),$('#loginBtn'),$('#newChatForm button[type="submit"]')])el.disabled=value;
}
function showCloudError(error){
  const text=error?.code==='42501'?'لا توجد صلاحية لتنفيذ العملية.':
    error?.code==='42P01'?'قاعدة البيانات غير مهيأة بعد.':
    error?.message==='Failed to fetch'?'تعذّر الاتصال بمساحة العمل. حاول مجدداً.':'تعذّر إكمال العملية. حاول مجدداً أو راجع إعداد مساحة العمل.';
  toast(text);
}
function setModeLabel(label,offline=false){
  $('.local-indicator').innerHTML=`<i></i> ${esc(label)}`;
  $('.local-indicator').classList.toggle('offline',offline);
}
async function refreshCloud(){
  if(!cloudMode)return;
  if(refreshing){refreshAgain=true;return;}
  const generation=sessionGeneration;
  refreshing=true;
  if(activeId)drafts[activeId]=$('#messageInput').value;
  try{
    const data=await repository.list();
    if(generation!==sessionGeneration||!cloudMode)return;
    chats=data;
    if(!chats.some(c=>c.id===activeId))activeId=chats[0]?.id||null;
    renderList();renderChat();
  }finally{
    refreshing=false;
    if(refreshAgain&&!saving&&cloudMode){refreshAgain=false;scheduleRefresh();}
  }
}
function scheduleRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(()=>{
    if(saving||refreshing){refreshAgain=true;return;}
    refreshCloud().catch(showCloudError);
  },200);
}
async function cloudMutation(operation){
  if(saving)return false;
  setSaving(true);
  let committed=false;
  try{
    await operation();committed=true;
    try{await refreshCloud();}
    catch(error){toast('تم الحفظ، لكن تعذّر تحديث القائمة. أعد تحميل الصفحة.');}
    return true;
  }catch(error){showCloudError(error);return false;}
  finally{setSaving(false);if(refreshAgain){refreshAgain=false;scheduleRefresh();}if(committed)$('#messageInput').focus();}
}
function clearPrivateState(){
  sessionGeneration++;activeUserId=null;cloudMode=false;repository?.unsubscribe();
  clearTimeout(refreshTimer);chats=[];activeId=null;attachment=null;pendingSend=null;
  for(const key of Object.keys(drafts))delete drafts[key];
  $('#messageInput').value='';$('#attachmentPreview').hidden=true;
  renderList();renderChat();
}
function showAuth(){
  $('#authError').textContent=configError||(!repository?'مساحة العمل غير مهيأة بعد. يمكنك استكشاف العرض التجريبي.':'');
  $('#loginBtn').disabled=!repository||saving;
  if(!$('#authDialog').open)$('#authDialog').showModal();
}
function demoMode(){
  clearPrivateState();
  chats=structuredClone(initial);
  try{const saved=JSON.parse(localStorage.getItem('wasl-inbox-v1'));if(Array.isArray(saved)&&saved.length&&saved.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&Array.isArray(c.messages)))chats=saved;}catch{}
  activeId=chats[0]?.id||null;
  $('#agentName').textContent='مساحة العرض';$('#accountBtn').textContent='تسجيل الدخول';
  $('#modeFooter').textContent='عرض تجريبي ببيانات توضيحية · الحفظ على هذا المتصفح';
  setModeLabel('عرض تجريبي');renderList();renderChat();
  $('#authDialog').close();
}
async function enterCloud(user){
  clearPrivateState();repository.user=user;activeUserId=user.id;cloudMode=true;
  $('#agentName').textContent=user.user_metadata?.full_name||user.email?.split('@')[0]||'مساحة العمل';
  $('#accountBtn').textContent='تسجيل الخروج';$('#modeFooter').textContent='مساحة عمل خاصة · آخر 100 محادثة وآخر 200 رسالة لكل محادثة';
  setModeLabel('جارٍ الاتصال…');
  try{
    await refreshCloud();
    if(!cloudMode||activeUserId!==user.id)return;
    $('#authDialog').close();
    repository.subscribe(scheduleRefresh,status=>{
      if(!cloudMode)return;
      if(status==='SUBSCRIBED'){setModeLabel('متصل بمساحة العمل');scheduleRefresh();}
      else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))setModeLabel('التحديث المباشر غير متصل',true);
    });
  }catch(error){
    clearPrivateState();$('#accountBtn').textContent='تسجيل الدخول';
    $('#authError').textContent='تعذّر تحميل مساحة العمل. تأكد من تشغيل قاعدة البيانات وإعداد الجداول ثم أعد المحاولة.';
    if(!$('#authDialog').open)$('#authDialog').showModal();
    setModeLabel('تعذّر الاتصال',true);
  }
}
$('#authDialog').addEventListener('cancel',e=>e.preventDefault());
$('#demoBtn').onclick=demoMode;
$('#accountBtn').onclick=async()=>{
  if(saving)return;
  if(cloudMode){
    setSaving(true);
    try{await repository.signOut();clearPrivateState();showAuth();}
    catch(error){showCloudError(error);}
    finally{setSaving(false);$('#loginBtn').disabled=!repository;}
  }else showAuth();
};
$('#authForm').onsubmit=async e=>{
  e.preventDefault();if(!repository||saving)return;
  $('#authError').textContent='';setSaving(true);
  try{
    const user=await repository.signIn($('#authEmail').value.trim(),$('#authPassword').value);
    $('#authPassword').value='';await enterCloud(user);
  }catch(error){$('#authError').textContent='تعذّر تسجيل الدخول. تحقق من بياناتك ومن اتصال الإنترنت.';}
  finally{setSaving(false);}
};
window.addEventListener('online',()=>{if(cloudMode)scheduleRefresh();});
window.addEventListener('offline',()=>{if(cloudMode)setModeLabel('الاتصال بالإنترنت منقطع',true);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloudMode)scheduleRefresh();});
// Renew short-lived signed image URLs while the page remains visible.
setInterval(()=>{if(cloudMode&&!document.hidden)scheduleRefresh();},240000);

async function boot(){
  let config=null;
  try{config=readConfig(import.meta.env);}catch(error){configError=error.message;}
  if(!config){demoMode();if(configError)showAuth();return;}
  repository=new CloudRepository(config);
  clearPrivateState();setModeLabel('جارٍ الاتصال…');
  repository.client.auth.onAuthStateChange((event,session)=>{
    // Avoid awaited Supabase calls inside the auth callback lock.
    setTimeout(()=>{
      if(event==='SIGNED_OUT'&&cloudMode){clearPrivateState();showAuth();}
      else if(event==='SIGNED_IN'&&session?.user&&activeUserId!==session.user.id)enterCloud(session.user);
    },0);
  });
  try{const user=await repository.session();if(user)await enterCloud(user);else showAuth();}
  catch(error){configError='تعذّر الاتصال بمساحة العمل. أعد المحاولة.';showAuth();}
}
boot();
