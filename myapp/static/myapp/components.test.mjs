import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {accessibilityText, alertPreview, expansion, bullet, routeText, equipmentReport, saveControl} from './components.js';
const {document, window} = parseHTML('<html><body></body></html>');
globalThis.document=document;
const item = (a) => {const el=document.createElement('article'); el.textContent=a.header; return el;};
test('previews handle empty, short and long lists and retain expansion after rerender', () => {
  for (const n of [0,1,2,5]) {
    const alerts=Array.from({length:n},(_,i)=>({header:`Alert ${i}`}));
    const key=`test-${n}`; expansion.delete(key);
    let node=alertPreview('Coming up',alerts,key,item,'None reported');
    assert.equal(node.querySelectorAll('article').length,Math.min(n,2));
    assert.equal(Boolean(node.querySelector('button')),n>2);
    if (n===0) assert.match(node.textContent,/None reported/);
    if (n>2) {
      const button=node.querySelector('button'); button.click();
      assert.equal(button.getAttribute('aria-expanded'),'true');
      assert.equal(node.querySelectorAll('article').length,n);
      node=alertPreview('Coming up',alerts,key,item,'None');
      assert.equal(node.querySelectorAll('article').length,n);
      node.querySelector('button').click();
      assert.equal(node.querySelectorAll('article').length,2);
    }
  }
});
test('route text formats recognized tokens without interpreting HTML', () => {
  const node=document.createElement('p'); node.append(routeText('Take [N] or [6X]; [UNKNOWN] <img src=x onerror=alert(1)>'));
  assert.equal(node.querySelectorAll('.bullet').length,2);
  assert.equal(node.querySelector('img'),null);
  assert.match(node.textContent,/\[UNKNOWN\] <img/);
  assert.ok(node.querySelector('.express'));
  assert.match(bullet('6X').getAttribute('style'),/#00933C/);
  assert.match(bullet('7X').getAttribute('style'),/#B933AD/);
  assert.equal(bullet('FS').getAttribute('aria-label'),'Franklin Av Shuttle');
});
test('equipment reports include location, identity, reason and missing-return state', () => {
  const node=equipmentReport({type:'Elevator',equipment:'EL1',station:'Test',serving:'street to platform',reason:'Maintenance',since:'2026-01-01',accessible_route:true},s=>s);
  for(const text of ['EL1','street to platform','Maintenance','Out since','Return time unknown','step-free']) assert.ok(node.textContent.includes(text));
  assert.equal(node.querySelector('undefined'),null);
  const planned=equipmentReport({type:'Escalator',station:'Test',upcoming:true,since:'start',back:'2099-01-01'},s=>s);
  assert.match(planned.textContent,/Scheduled start/);
  assert.match(planned.textContent,/Estimated return/);
});
test('save controls expose state and decorative icons are hidden', () => {
  let calls=0;const node=saveControl({saved:true,pending:false,label:'station',key:'save',onClick:()=>calls++});
  assert.equal(node.getAttribute('aria-pressed'),'true');
  assert.equal(node.querySelector('.icon').getAttribute('aria-hidden'),'true');
  node.click();assert.equal(calls,1);
  assert.equal(saveControl({saved:false,pending:true,label:'line',key:'line',onClick:()=>{}}).disabled,true);
});

test('feed symbols accept spaces and case variants alongside routes', () => {
  const node=document.createElement('p');
  node.append(routeText('[shuttle bus icon][N] [ACCESSIBILITY ICON] [  Shuttle   Bus Icon  ] [unknown icon] [constructor] <script>bad</script>'));
  assert.equal(node.querySelectorAll('.icon-bus').length,2);
  assert.equal(node.querySelectorAll('.icon-accessibility').length,1);
  assert.equal(node.querySelectorAll('.bullet').length,1);
  assert.match(node.textContent,/Shuttle bus/);
  assert.match(node.textContent,/Accessibility/);
  assert.match(node.textContent,/\[unknown icon\]/);
  assert.equal(node.querySelector('script'),null);
  assert.match(node.textContent,/\[constructor\]/);
});
test('plain accessibility language covers every catalog state and missing data', () => {
  assert.equal(accessibilityText('ADA accessible'),'Step-free access is available at this station.');
  assert.match(accessibilityText('Partially ADA accessible'),/only for some platforms or directions/);
  assert.match(accessibilityText('Not ADA accessible'),/not listed/);
  assert.match(accessibilityText(undefined),/not available/);
  assert.match(accessibilityText('unexpected'),/not available/);
});
