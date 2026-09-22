import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function archiveHarness(){
 const calls=[];
 const data={exists:()=>false,docs:[]};
 const fake={doc:(_db,...parts)=>parts.join('/'),collection:(_db,...parts)=>parts.join('/'),getDoc:async path=>{calls.push(path);return data;},getDocs:async path=>{calls.push(path);return data;}};
 const modules={'firebase/firestore':fake,'$lib/firebase':{db:{}},'./surgerySchema':{createEmptySurgeryState:()=>({topics:{}}),hydrateState:s=>s},'./retentionSchema':{normalizeRetentionCard:c=>c}};
 const source=readFileSync(new URL('../src/lib/study/surgeryArchive.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports',code)(name=>{assert.ok(modules[name],`Unexpected archive dependency ${name}`);return modules[name];},exports);
 return {calls,archive:exports};
}

test('Surgery does no reads until explicitly opened, then caches the frozen snapshot',async()=>{
 const {calls,archive}=archiveHarness();assert.equal(calls.length,0);
 const first=await archive.readSurgeryArchive('user-a');assert.equal(calls.length,7);
 assert.equal(await archive.readSurgeryArchive('user-a'),first);assert.equal(calls.length,7);
 assert.ok(calls.every(path=>path.startsWith('users/user-a/')));
});

test('archive cache never crosses accounts and can be cleared on sign-out',async()=>{
 const {calls,archive}=archiveHarness();await archive.readSurgeryArchive('user-a');await archive.readSurgeryArchive('user-b');assert.equal(calls.length,14);
 assert.ok(calls.slice(7).every(path=>path.startsWith('users/user-b/')));
 archive.clearSurgeryArchive();await archive.readSurgeryArchive('user-b');assert.equal(calls.length,21);
});

test('active Study and dashboard cannot load the Surgery repository or its data',()=>{
 for(const path of ['../src/routes/(app)/study/+page.svelte','../src/routes/(app)/study/plan/+page.svelte','../src/routes/(app)/study/review/+page.svelte','../src/routes/(app)/dashboard/+page.svelte']){
   const source=readFileSync(new URL(path,import.meta.url),'utf8');
   assert.doesNotMatch(source,/surgeryTracker|surgerySessions|surgeryRepository|surgeryPlan|surgeryReviewEvents|surgerySimulations/);
 }
 const archived=readFileSync(new URL('../src/routes/(app)/study/surgery/+page.svelte',import.meta.url),'utf8');
 assert.doesNotMatch(archived,/setInterval|onSnapshot|saveSurgery|syncAnki|recordPatchPlanProgress/);
});
