import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';

test('station and line pages preserve disclosures, equipment details and error summaries', async () => {
  const html=await readFile(new URL('../../templates/myapp/dashboard.html',import.meta.url),'utf8');
  const {window,document}=parseHTML(html);
  Object.assign(globalThis,{window,document,localStorage:{getItem:()=>null,setItem:()=>{}}});
  globalThis.Option=function(text,value) {const option=document.createElement("option");option.textContent=text;option.value=value;return option;};
  document.body.dataset.page="stations";
  window.location={search:""};
  window.matchMedia=()=>({matches:false});
  const originalInterval=globalThis.setInterval;
  globalThis.setInterval=()=>0;
  const originalFetch=globalThis.fetch;
  const station={id:'1',name:'Test Station',borough:'Queens',lines:['N'],accessibility:'ADA accessible',accessibility_notes:'Use the north entrance',outage_names:['Test Station']};
  const alerts=Array.from({length:5},(_,i)=>({id:String(i),routes:['N'],active:i===0,header:'Take [N] <script>bad</script>',type:'Delays'}));
  let failAlerts=false;
  globalThis.fetch=async (url)=>{
    let body;
    if(url==='/api/stations/') body={stations:[station]};
    else if(String(url).startsWith('/api/status/')) body={routes:{N:{status:'Delays'},A:{status:'Good Service'}}};
    else if(String(url).startsWith('/api/elevators/')) body={warning:'Showing stale equipment data',outages:[{station:station.name,lines:['N'],type:'Elevator',equipment:'EL1',serving:'North entrance to mezzanine',reason:'Repair',upcoming:false}]};
    else if(String(url).startsWith('/api/alerts/')) {if(failAlerts) throw new Error('offline');body={alerts};}
    else throw new Error(`Unexpected URL ${url}`);
    return {ok:true,json:async()=>body};
  };
  const settle=async()=>{for(let i=0;i<6;i++) await new Promise(r=>setImmediate(r));};
  try {
    await import('./dashboard.js');await settle();
    document.querySelector('#station-results button').click();await settle();
    assert.match(document.querySelector('#details').textContent,/Test Station/);
    assert.match(document.querySelector('.accessibility-card').textContent,/North entrance to mezzanine/);
    assert.match(document.querySelector('.accessibility-card').textContent,/Step-free access is available at this station/);
    assert.match(document.querySelector('.accessibility-card').textContent,/Use the north entrance/);
    assert.match(document.querySelector('.accessibility-card').textContent,/Showing stale equipment data/);
    assert.equal(document.querySelectorAll('.alert-preview:last-child article').length,2);
    document.querySelector('.disclosure').click();
    assert.equal(document.querySelector('.disclosure').getAttribute('aria-expanded'),'true');
    document.querySelector('#refresh').click();await settle();
    assert.equal(document.querySelector('.disclosure').getAttribute('aria-expanded'),'true');
    assert.equal(document.querySelector('[data-key="station-line-N"]').getAttribute('href'),'/lines/?route=N');
    failAlerts=true;
    document.querySelector('#station-results button').click();await settle();
    assert.match(document.querySelector('#details').textContent,/Test Station/);
    assert.match(document.querySelector('#details').textContent,/Alert information is unavailable/);
    const linePage=parseHTML(html);
    linePage.document.body.dataset.page="lines";
    linePage.window.location={search:"?route=N"};
    linePage.window.matchMedia=()=>({matches:false});
    Object.assign(globalThis,{document:linePage.document,window:linePage.window});
    globalThis.Option=function(text,value) {const option=linePage.document.createElement("option");option.textContent=text;option.value=value;return option;};
    failAlerts=false;
    await import('./dashboard.js?line-test');await settle();
    assert.match(linePage.document.querySelector('.line-summary').textContent,/N line/);
    linePage.document.querySelector('[data-key="tile-A"]').click();await settle();
    assert.equal(linePage.document.querySelector('.station-detail-head'),null);
    failAlerts=true;
    linePage.document.querySelector('[data-key="tile-N"]').click();await settle();
    assert.match(linePage.document.querySelector('.line-summary').textContent,/N line/);
    assert.match(linePage.document.querySelector('#details').textContent,/Alert information is unavailable/);
    assert.equal(linePage.document.querySelector('#details script'),null);
  } finally {globalThis.fetch=originalFetch;globalThis.setInterval=originalInterval;}
});
