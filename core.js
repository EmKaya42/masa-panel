/* Shared, dependency-free calculations. Values describe published paper records. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MasaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  function isFresh(timestamp, now, ttl = 60) {
    return finite(timestamp) && timestamp > 0 && timestamp <= now + 5 && now - timestamp <= ttl;
  }
  function killState(value) {
    return value === true ? {label:'Tetiklendi',tone:'dn'} : value === false ? {label:'Tetiklenmedi',tone:'up'} : {label:'Bilinmiyor',tone:'muted'};
  }
  function validateSnapshot(d) {
    if (!d || !finite(d.gen) || d.gen <= 0) throw new Error('Veri zamanı geçersiz');
    if (!['meme','spot','lab','whale'].some(k => d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]))) throw new Error('Masa verisi bulunamadı');
    return d;
  }
  function collectTrades(d) {
    const rows = [], add = (items, book, symbol, percent) => {
      for (const t of Array.isArray(items) ? items : []) {
        if (!t || !finite(t.pnl) || !finite(t.xts)) continue;
        rows.push({book,symbol:String(t[symbol] || '—'),closed:t.xts,opened:t.ts || null,pnl:t.pnl,pct:finite(t[percent])?t[percent]:null,reason:String(t.why || '—'),fees:finite(t.fees)?t.fees:null});
      }
    };
    add(d.meme?.trades,'Memecoin','sym','pnl_pct');
    add(d.spot?.trades,'Spot','pair','pnl_pct');
    add(d.lab?.sol?.trades,'Deney Solana','sym','pct');
    add(d.lab?.okx?.trades,'Deney OKX','inst','pct');
    for (const t of Array.isArray(d.whale?.paper?.trades) ? d.whale.paper.trades : []) if (t && t.ev === 'exit' && finite(t.pnl) && finite(t.t)) rows.push({book:'Balina',symbol:String(t.s||'—'),closed:t.t,pnl:t.pnl,pct:null,reason:String(t.why||t.st||'—'),fees:null});
    return rows;
  }
  function filterTrades(rows, {book='',query='',sort='date',since=0} = {}) {
    const q = query.toLocaleLowerCase('tr-TR').trim();
    return rows.filter(r => (!book || r.book===book) && (!since || r.closed>=since) && (!q || `${r.symbol} ${r.reason} ${r.book}`.toLocaleLowerCase('tr-TR').includes(q)))
      .sort((a,b) => sort==='pnl' ? b.pnl-a.pnl : sort==='loss' ? a.pnl-b.pnl : b.closed-a.closed);
  }
  function tradeStats(rows) {
    const valid=rows.filter(r=>finite(r.pnl));
    const wins=valid.filter(r=>r.pnl>0), losses=valid.filter(r=>r.pnl<0);
    const grossWin=wins.reduce((s,r)=>s+r.pnl,0), grossLoss=-losses.reduce((s,r)=>s+r.pnl,0);
    return {count:valid.length,wins:wins.length,losses:losses.length,net:valid.reduce((s,r)=>s+r.pnl,0),winRate:valid.length?wins.length/valid.length*100:null,profitFactor:grossLoss?grossWin/grossLoss:null};
  }
  function toCSV(rows) {
    return rows.map(row=>row.map(value=>{
      let s=String(value??'');
      if(typeof value==='string' && /^[\s]*[=+\-@\t\r]/.test(s)) s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    }).join(',')).join('\r\n');
  }
  return {isFresh,killState,validateSnapshot,collectTrades,filterTrades,tradeStats,toCSV};
});
