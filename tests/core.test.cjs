const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const corePath = path.join(__dirname, '..', 'core.js');
const core = () => require(corePath);

test('stale or future quotes are not current', () => {
  assert.ok(fs.existsSync(corePath), 'freshness module is missing');
  assert.equal(core().isFresh(990, 1000, 60), true);
  assert.equal(core().isFresh(900, 1000, 60), false);
  assert.equal(core().isFresh(1100, 1000, 60), false);
  assert.equal(core().isFresh(null, 1000, 60), false);
});
test('unknown kill state does not imply disabled protection', () => {
  assert.equal(core().killState(null).label, 'Bilinmiyor');
  assert.equal(core().killState(true).label, 'Tetiklendi');
  assert.equal(core().killState(false).label, 'Tetiklenmedi');
});
test('snapshots require a finite generation and at least one desk', () => {
  assert.throws(() => core().validateSnapshot({gen:1000}), /masa/i);
  assert.throws(() => core().validateSnapshot({gen:'bad',meme:{}}), /zaman/i);
  const d = {gen:1000,whale:{}};
  assert.equal(core().validateSnapshot(d), d);
});
test('position falls back to desk quote when live quote has expired', () => {
  const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const body=src.match(/function posLive\(p\) \{[\s\S]*?\n\}/)[0];
  const result=vm.runInNewContext(body+';posLive(p)', {Core:fs.existsSync(corePath)?core():{},dex:{X:{px:2,t:1}},D:{meme:{set:{slip:1.5}}},now:()=>1000,p:{mint:'X',last:1,qty:10,cost:10}});
  assert.equal(result.live,false);
  assert.equal(result.last,1);
});
test('one broken desk does not stop unrelated desk rendering', () => {
  const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const body=src.match(/function renderAll\(\) \{[^\n]*\}/)[0];
  const called=[];
  const context={console:{error(){}},window:{},Core:fs.existsSync(corePath)?core():{},D:{}};
  for(const name of ['seedOkx','renderMeme','renderSpot','renderLab','renderWhale','renderTeam','renderRadar','renderTickers','tickStatus']) context[name]=()=>{called.push(name);if(name==='renderMeme')throw Error('bad balance');};
  context.renderSection=(_name,fn)=>{try{fn();}catch{}};
  try{vm.runInNewContext(body+';renderAll()',context);}catch{}
  assert.ok(called.includes('renderSpot'));
  assert.ok(called.includes('renderTeam'));
});
const rows=[{book:'Solana',symbol:'ABC',closed:100,pnl:20},{book:'Spot',symbol:'BTC',closed:200,pnl:-5},{book:'Spot',symbol:'ETH',closed:300,pnl:0}];
test('journal filters source and query, and sorts numeric PnL',()=>{
  assert.deepEqual(core().filterTrades(rows,{book:'Spot',query:'bt',sort:'pnl'}).map(x=>x.symbol),['BTC']);
  assert.deepEqual(core().filterTrades(rows,{sort:'pnl'}).map(x=>x.symbol),['ABC','ETH','BTC']);
  assert.equal(core().filterTrades(rows,{since:250}).length,1);
});
test('closed metrics handle break-even and no losses without Infinity',()=>{
  const stats=core().tradeStats(rows);
  assert.ok(Math.abs(stats.winRate-33.3333333333)<0.000001);
  assert.deepEqual({...stats,winRate:null},{count:3,wins:1,losses:1,net:15,winRate:null,profitFactor:4});
  assert.equal(core().tradeStats([]).winRate,null);
  assert.equal(core().tradeStats([{pnl:2}]).profitFactor,null);
});
test('CSV escapes quotes and prevents spreadsheet formula execution',()=>{
  const csv=core().toCSV([['=1+1','a"b','a,b','@SUM(1)',-5]]);
  assert.equal(csv,'"\'=1+1","a""b","a,b","\'@SUM(1)","-5"');
});
test('journal ignores malformed trade collections without losing valid desks',()=>{
  const d={meme:{trades:[{sym:'X',xts:10,pnl:3}]},whale:{paper:{trades:{bad:true}}}};
  assert.equal(core().collectTrades(d).length,1);
});
test('null trade rows do not discard valid trades from another desk',()=>{
  assert.equal(core().collectTrades({meme:{trades:[null]},spot:{trades:[{pair:'BTC',xts:10,pnl:1}]}})[0].symbol,'BTC');
});
test('navigation chart redraw tolerates an absent memecoin desk',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const body=src.match(/function drawCurve\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotThrow(()=>vm.runInNewContext(body+';drawCurve()',{D:{},$:()=>({}),ctx2d:()=>[],curvePts:null}));
});
test('an empty Dex response cannot refresh an expired dialog price',async()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  const body=src.match(/async function pollDex\(\) \{[\s\S]*?\n\}/)[0];
  let updates=0;
  const context={D:{meme:{pos:[{mint:'X'}],radar:[]}},Core:core(),now:()=>1000,dex:{X:{px:2,t:1}},dexOk:0,sheet:{kind:'dex',mint:'X'},getJSON:async()=>[[]],$:()=>({classList:{remove(){},add(){}}}),updatePositionsLive(){},updateRadarLive(){},sheetLivePx(){updates++;}};
  await vm.runInNewContext(body+';pollDex()',context);
  assert.equal(updates,0);
  assert.equal(context.dexOk,0);
});
