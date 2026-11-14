/* Overview and journal. Derived values are scoped to the published snapshot. */
(() => {
  'use strict';
  const C = window.MasaCore, $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = (v,n=2) => typeof v==='number' && Number.isFinite(v) ? v.toLocaleString('tr-TR',{minimumFractionDigits:n,maximumFractionDigits:n}) : '—';
  const money = v => typeof v==='number' && Number.isFinite(v) ? (v<0?'−':'')+'$'+number(Math.abs(v)) : '—';
  const tone = v => v>0?'up':v<0?'dn':'muted';
  const date = t => t ? new Date(t*1000).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
  let snapshot=null, filtered=[], healthState={};
  const age = t => { if(!t) return 'Veri yok'; const s=Math.max(0,Date.now()/1000-t); return s<60?Math.floor(s)+' sn önce':s<3600?Math.floor(s/60)+' dk önce':number(s/3600,1)+' sa önce'; };
  function card(label,eq,delta,count,tab,detail) {
    return '<button class="account-card" data-open-tab="'+tab+'"><span class="account-label">'+esc(label)+' <span>↗</span></span><strong>'+money(eq)+'</strong><span class="account-change '+tone(delta)+'">'+(delta>0?'+':'')+money(delta)+' <small>başlangıca göre</small></span><span class="account-bottom"><span>'+esc(detail)+'</span><b>'+(count??'—')+' açık</b></span></button>';
  }
  function render(d) {
    snapshot=d;
    const m=d.meme?.bal, s=d.lab?.sol, o=d.lab?.okx, w=d.whale?.paper;
    $('#accountGrid').innerHTML=[
      card('Memecoin · Solana',m?.eq,m?.pnl,m?.open,'masa',d.meme?.status?'Son kayıt: '+d.meme.status:'Veri yok'),
      card('Deney · Solana',s?.eq,s? s.eq-s.start:null,s?.pos?.length,'deney','Bağımsız deney hesabı'),
      card('Deney · OKX',o?.eq,o? o.eq-o.start:null,o?.pos?.length,'deney','Spot + vadeli · sanal'),
      card('Balina · OKX',w?.eq,w? w.eq-w.start:null,w?.pos?.length,'balina',d.whale?.safe?'Güvenli mod':'Son kayıt')
    ].join('');
    const indicators=Object.values(d.spot?.ind||{}).filter(x=>x&&typeof x==='object'), up=indicators.filter(x=>x.trend==='yukarı').length, down=indicators.filter(x=>x.trend==='aşağı').length;
    $('#marketContext').innerHTML='<div class="market-regime"><strong>'+(indicators.length?down>up?'Aşağı yön ağırlıklı':up>down?'Yukarı yön ağırlıklı':'Karışık görünüm':'Tarama bekleniyor')+'</strong><span>Trend dağılımı · '+indicators.length+' izlenen parite</span></div><div class="breadth-bar"><i style="width:'+(indicators.length?up/indicators.length*100:0)+'%"></i></div><div class="breadth-labels"><span class="up">↑ '+up+' yukarı</span><span class="dn">↓ '+down+' aşağı</span></div><p class="panel-footnote">Tarama: '+date(d.spot?.scan_ts)+'. Bu dağılım alım/satım sinyali değildir.</p>';
    const ml=d.lab?.quant?.ml, opt=d.lab?.quant?.opt;
    $('#modelContext').innerHTML=ml?'<div class="model-metrics"><div><span>Test AUC</span><strong>'+number(ml.auc,3)+'</strong></div><div><span>Test örneklemi</span><strong>'+number(ml.n_test,0)+'</strong></div><div><span>Yüksek skor grubu ort.</span><strong class="'+tone(ml.terc?.high?.mean_ret_pct)+'">'+number(ml.terc?.high?.mean_ret_pct)+'%</strong></div></div><p class="panel-footnote">Skor bir getiri garantisi değildir. Model sürümü ve eğitim tarihleri kaynakta bulunmuyor; sonuçlar gölge test kapsamındadır.</p>'+(opt?'<p class="evidence-note">'+esc(opt.verdict)+'</p>':''):'<div class="empty">Model değerlendirmesi yayımlanmamış.</div>';
    renderJournal();
  }
  function health(d,state) {
    healthState=state;
    const t=Date.now()/1000, fresh=C.isFresh(d.gen,t,300), connected=!state.fetchErr, whaleFresh=C.isFresh(d.whale?.gen,t,300);
    const noTrade=!fresh || !connected;
    $('#decisionBanner').className='decision-banner '+(noTrade?'caution':'');
    $('#decisionBanner').innerHTML='<span class="decision-icon">'+(noTrade?'!':'✓')+'</span><div><b>'+(noTrade?'Değerlendirme beklemede · veri doğrulanmalı':'Masa kaydı güncel · risk kontrollerini incele')+'</b><p>'+(noTrade?'Bakiyeler ve çalışma durumları son kayda aittir. Yeni karar için önce veri bağlantısını doğrula.':'Güncellik tek başına işlem uygunluğu göstermez. Strateji doğrulaması ve risk limitlerini birlikte değerlendir.')+'</p></div><span class="decision-date">'+date(d.gen)+'</span>';
    const checks=[
      [fresh&&connected,'Masa kaydı',fresh&&connected?'Son kayıt güncel':'Eski kayıt veya kaynak bağlantısı hatası'],
      [C.isFresh(d.spot?.scan_ts,t,300),'Spot taraması',date(d.spot?.scan_ts)+' · '+(d.spot?.universe??'—')+' parite'],
      [d.spot?.kill===false,'Acil durdurma',C.killState(d.spot?.kill).label+' · son kayıt'],
      [whaleFresh&&d.whale?.safe===false,'Balina veri kalitesi',d.whale?.safe?d.whale.safe_why||'Güvenli mod':whaleFresh?'Güvenli mod kapalı':'Güncel kayıt yok'],
      [false,'Strateji doğrulaması',d.spot?.override?'Spot: doğrulanmamış sanal gözlem; sahip override kaydı var':'Onaylı motor bağlantısı ve doğrulama kanıtı gerekli']
    ];
    $('#readiness').innerHTML=checks.map(([ok,label,desc])=>'<div class="check-item"><span class="check-mark '+(ok?'ok':'wait')+'">'+(ok?'✓':'!')+'</span><div><b>'+esc(label)+'</b><span>'+esc(desc)+'</span></div></div>').join('');
    const sourceRows=[['Masa yayını',fresh&&connected,date(d.gen)],['DexScreener',C.isFresh(state.dexOk,t,60),age(state.dexOk)],['OKX fiyatı',C.isFresh(state.okxOk,t,60),age(state.okxOk)],['Balina yayını',whaleFresh&&d.whale?.safe===false,age(d.whale?.gen)]];
    $('#healthRows').innerHTML=sourceRows.map(([name,ok,desc])=>'<div class="health-row"><span><i class="health-dot '+(ok?'ok':'')+'"></i>'+name+'</span><div><b class="'+(ok?'up':'muted')+'">'+(ok?'Güncel':'Kontrol gerekli')+'</b><small>'+esc(desc)+'</small></div></div>').join('');
    $('#healthStamp').textContent='Son başarılı indirme: '+date(state.lastFetchOk)+' · '+(state.dataSrc||'Kaynak bekleniyor');
    const errs=Object.keys(state.renderErrors||{});
    $('#sectionErrors').classList.toggle('hide',!errs.length);
    const names={renderMeme:'Memecoin',renderSpot:'Spot',renderLab:'Deney',renderWhale:'Balina',renderTeam:'Sistem',renderRadar:'Radar',renderTickers:'Piyasa',overview:'Genel bakış',positions:'Pozisyonlar','radar-live':'Radar fiyatları'};
    $('#sectionErrors').textContent=errs.length?'Bazı bölümlerin verisi eksik. Diğer bölümler gösteriliyor. Bölümler: '+errs.map(k=>names[k]||'Veri kaynağı').join(', '):'';
  }
  function renderJournal() {
    if(!snapshot)return;
    const hours=Number($('#tradePeriod').value);
    filtered=C.filterTrades(C.collectTrades(snapshot),{book:$('#tradeBook').value,query:$('#tradeSearch').value,sort:$('#tradeSort').value,since:hours?Date.now()/1000-hours*3600:0});
    const stats=C.tradeStats(filtered);
    $('#journalStats').innerHTML=[['Gösterilen işlem',number(stats.count,0)],['Net sonuç',money(stats.net)],['Kazanma oranı',stats.winRate===null?'—':number(stats.winRate,1)+'%'],['Kâr faktörü',stats.profitFactor===null?'—':number(stats.profitFactor)]].map(([k,v])=>'<div><span>'+k+'</span><b>'+v+'</b></div>').join('');
    $('#journalBody').innerHTML=filtered.length?filtered.map(r=>'<tr><td><strong>'+esc(r.symbol)+'</strong><small>'+esc(r.book)+'</small></td><td class="num">'+date(r.closed)+'</td><td class="num '+tone(r.pnl)+'">'+(r.pnl>0?'+':'')+money(r.pnl)+'</td><td class="num '+tone(r.pct)+'">'+(r.pct===null?'—':number(r.pct)+'%')+'</td><td>'+esc(r.reason)+'</td></tr>').join(''):'<tr><td colspan="5" class="table-empty">Bu filtrelere uygun kapanmış işlem bulunamadı.</td></tr>';
    $('#exportTrades').disabled=!filtered.length;
  }
  for(const id of ['tradeSearch','tradeBook','tradePeriod','tradeSort']) $('#'+id).addEventListener(id==='tradeSearch'?'input':'change',renderJournal);
  $('#exportTrades').onclick=()=>{
    const rows=[['Masa','Enstrüman','Kapanış (UTC)','Net sonuç (USD/USDT)','Getiri (%)','Kapanış nedeni'],...filtered.map(r=>[r.book,r.symbol,new Date(r.closed*1000).toISOString(),r.pnl,r.pct,r.reason])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+C.toCSV(rows)],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download='masa-islem-gunlugu.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-open-tab]');
    if(btn) document.querySelector('[data-go="'+btn.dataset.openTab+'"]')?.click();
  });
  window.MasaTerminal={render,health};
})();
