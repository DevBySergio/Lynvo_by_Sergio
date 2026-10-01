"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pathToFileURL } = require("node:url");
const webpack = require("webpack");
const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const candidates = [process.env.LYNVO_CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")].filter(Boolean);
const chrome = candidates.find((filename) => fs.existsSync(filename));

// Run the current source in a fresh browser profile with an in-memory VS Code
// bridge. Every task is synthetic; no extension dist files or real boards change.
const createHtml = () => `<!doctype html><html><head><meta charset="utf-8"><title>Lynvo UI regression fixture</title>
<style>:root{--vscode-font-family:Arial;--vscode-font-size:12px;--vscode-foreground:#e6edf3;--vscode-descriptionForeground:#8b949e;--vscode-input-background:#21262d;--vscode-input-foreground:#e6edf3;--vscode-editor-background:#0d1117;--vscode-button-background:#1f6feb;--vscode-button-foreground:#fff;--vscode-focusBorder:#58a6ff;--vscode-errorForeground:#f85149;}</style></head><body><div id="root"></div>
<script>
const user={githubId:'fixture',username:'Test'};
const makeTask=(id,status)=>({id,title:id==='one'?'Task one':id,description:'Fixture',status,createdBy:user,lastModifiedBy:user,createdAt:1,updatedAt:2,priority:'medium',dueDate:3,labelIds:[],checklist:[{id:'item',text:'Original item',done:false,createdAt:1,updatedAt:1}],relations:[{id:'relation',type:'related',targetTaskId:'two',createdAt:1}]});
const original={version:'2.0.0',columns:Object.fromEntries([['todo','Pendiente'],['in-progress','En curso'],['done','Finalizado']].map(([id,title],position)=>[id,{id,title,position,color:'#58a6ff'}])),tasks:{one:makeTask('one','todo'),two:makeTask('two','done'),three:makeTask('three','in-progress')},labels:{},conflicts:{}};
let board=structuredClone(original),workspaceId='project-a',failNext=false,uiState=null;const outbound=[];
const receive=(message)=>window.dispatchEvent(new MessageEvent('message',{data:message}));
const refresh=()=>receive({command:'loadData',data:structuredClone(board),workspaceId});
window.acquireVsCodeApi=()=>({getState:()=>uiState,setState:(value)=>{uiState=value;},postMessage:(message)=>{
  outbound.push(structuredClone(message));
  if(message.command==='requestData'){setTimeout(refresh,10);return;}
  setTimeout(()=>{let error;
    if(message.command==='editTask'){
      const task=board.tasks[message.taskId];
      if(failNext){error='Simulated write failure';failNext=false;}
      else if(message.expectedUpdatedAt!==task.updatedAt){error='Task changed remotely. Reopen it before saving.';}
      else{Object.assign(task,{title:message.title,description:message.description,labelIds:message.labelIds,priority:message.priority,dueDate:message.dueDate,checklist:message.checklist,relations:message.relations,updatedAt:task.updatedAt+1});refresh();}
    }
    if(message.command==='createTask'){
      if(failNext){error='Simulated write failure';failNext=false;}
      else{board.tasks.created={...makeTask('created',message.targetColId),title:message.title,description:message.description,checklist:[],relations:[]};refresh();}
    }
    if(message.command==='resolveConflict'||message.command==='resolveConflicts'){receive({command:'conflictResolutionComplete',workspaceId});}
    receive({command:'operationComplete',operation:message.command,requestId:message.requestId,workspaceId,error});
  },100);
}});
</script><script src="webview.js"></script><script>
(async()=>{
  const checks=[];
  const check=(condition,label)=>{if(!condition){throw Error(label);}checks.push(label);};
  const delay=()=>new Promise(resolve=>setTimeout(resolve,20));
  const until=async(predicate,label)=>{for(let i=0;i<200;i++){if(predicate()){return;}await delay();}throw Error('Timed out: '+label);};
  const button=(label,scope=document)=>Array.from(scope.querySelectorAll('button')).find(element=>element.textContent.trim()===label);
  const click=(label,scope=document)=>{const element=button(label,scope);if(!element){throw Error('Missing button '+label);}element.click();};
  const setInput=(element,value)=>{if(!element){throw Error('Missing input');}Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
  const card=()=>document.querySelector('.lynvo-card');
  const form=()=>document.querySelector('fieldset');
  const finish=(status,error)=>{document.getElementById('root').innerHTML='';const result=document.createElement('pre');result.id='test-result';result.dataset.status=status;result.textContent=JSON.stringify({status,checks,error});document.body.appendChild(result);};
  try{
    await until(()=>document.querySelectorAll('.lynvo-card').length===3,'fixture load');
    const stats=Array.from(document.querySelectorAll('.lynvo-stat')).map(node=>node.textContent.replace(/\\s+/g,''));
    check(stats.includes('Completed1'),'renamed Done counts as completed');
    check(stats.includes('Overdue2'),'completed tasks excluded from overdue');
    click('E',card());await until(form,'task editor');
    const before=outbound.length;
    form().querySelector('input[type=checkbox]').click();
    setInput(Array.from(form().querySelectorAll('input')).find(node=>node.value==='Original item'),'Changed checklist draft');await delay();
    const relationRemove=Array.from(form().querySelectorAll('button')).filter(node=>node.textContent.trim()==='×').at(-1);relationRemove.click();await delay();
    setInput(form().querySelector('input[placeholder="Add checklist item..."]'),'Added draft');await delay();click('Add',form());await delay();
    check(outbound.length===before,'checklist and relation edits stay local before Save');
    click('Cancel',form());await until(()=>!form(),'cancel');
    check(outbound.length===before,'Cancel persists no draft changes');
    click('E',card());await until(form,'reopen task');
    check(Array.from(form().querySelectorAll('input')).some(node=>node.value==='Original item'),'Cancel restores original checklist');
    check(form().textContent.includes('two'),'Cancel restores original relations');
    setInput(form().querySelector('input'),'Saved draft title');await delay();
    setInput(Array.from(form().querySelectorAll('input')).find(node=>node.value==='Original item'),'Saved checklist text');await delay();
    failNext=true;click('Save',form());await delay();check(form().disabled,'Save waits with disabled editor');
    await until(()=>document.querySelector('[role=alert]')?.textContent.includes('Simulated write failure'),'failed save');
    check(form().querySelector('input').value==='Saved draft title'&&!form().disabled,'failed Save keeps draft and enables retry');
    click('Save',form());await until(()=>!form(),'successful save');
    check(card().textContent.includes('Saved draft title'),'successful acknowledgement closes editor and displays saved task');
    const sentEdit=outbound.filter(message=>message.command==='editTask').at(-1);
    check(sentEdit.expectedUpdatedAt===2&&sentEdit.checklist[0].text==='Saved checklist text','Save includes original version and checklist draft');
    click('E',card());await until(form,'edit before remote update');setInput(form().querySelector('input'),'Draft after remote');await delay();
    board.tasks.one.title='Remote title';board.tasks.one.updatedAt+=5;refresh();await delay();
    check(form().querySelector('input').value==='Draft after remote','remote refresh preserves open draft');
    click('Save',form());await until(()=>document.querySelector('[role=alert]')?.textContent.includes('changed remotely'),'stale save');
    check(form().querySelector('input').value==='Draft after remote','stale write rejection preserves draft');
    workspaceId='project-b';board=structuredClone(original);refresh();await until(()=>!form(),'project change');
    check(!document.querySelector('[role=alert]'),'switching project clears prior errors and drafts');
    click('+ Add Task here');await until(()=>document.querySelector('input[placeholder="Task title..."]'),'new task form');
    setInput(document.querySelector('input[placeholder="Task title..."]'),'Unsaved new task');await delay();failNext=true;click('Save');
    await until(()=>document.querySelector('[role=alert]')?.textContent.includes('Simulated write failure'),'failed create');
    check(document.querySelector('input[placeholder="Task title..."]').value==='Unsaved new task','failed Create preserves form');click('Cancel');await delay();
    for(const count of [657,1200]){
      board.tasks={};for(let i=0;i<count;i++){const id='task-'+i;board.tasks[id]={...makeTask(id,['todo','in-progress','done'][i%3]),relations:[]};}refresh();await delay();
      click('Table');await delay();click('Map');await until(()=>document.querySelectorAll('.lynvo-map-node').length===count,'large map '+count);await delay();
      const viewport=document.querySelector('.lynvo-task-map').getBoundingClientRect();
      const nodes=Array.from(document.querySelectorAll('.lynvo-map-node'));
      const inBounds=nodes.every(node=>{const bounds=node.getBoundingClientRect();return bounds.width>0&&bounds.height>0&&bounds.left>=viewport.left-1&&bounds.right<=viewport.right+1&&bounds.top>=viewport.top-1&&bounds.bottom<=viewport.bottom+1;});
      check(inBounds,'all '+count+' map tasks rendered and fitted inside viewport');
      click('Board');await delay();
    }
    finish('passed');
  }catch(error){finish('failed',error.stack||String(error));}
})();
</script></body></html>`;

(async () => {
  if (!chrome) {console.log("Headless UI checks skipped: Chrome/Chromium is unavailable (set LYNVO_CHROME_BIN)."); return;}
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "lynvo-headless-ui-"));
  try {
    const config = require(path.join(root, "webpack.config.js"))({}, { mode: "development" })[1];
    config.context = root; config.output.path = temp; config.devtool = false;
    await new Promise((resolve, reject) => webpack(config, (error, stats) => {
      if (error || stats.hasErrors()) {reject(error || new Error(stats.toString({ all: false, errors: true })));}
      else {resolve();}
    }));
    await fsp.writeFile(path.join(temp, "index.html"), createHtml());
    const { stdout } = await execFileAsync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-component-update", `--user-data-dir=${path.join(temp, "profile")}`,
      "--window-size=1280,1000", "--virtual-time-budget=20000", "--dump-dom", pathToFileURL(path.join(temp, "index.html")).href],
    { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
    const result = stdout.match(/<pre id="test-result" data-status="([^"]+)">([\s\S]*?)<\/pre>/);
    assert.ok(result, "Chrome did not return a UI test result");
    const report = JSON.parse(result[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    assert.equal(report.status, "passed", report.error);
    console.log(`Lynvo real DOM checks passed (${report.checks.length} assertions, ${chrome}).`);
    for (const check of report.checks) {console.log(`  ${check}`);}
  } finally {await fsp.rm(temp, { recursive: true, force: true });}
})().catch((error) => {console.error(error); process.exitCode = 1;});
