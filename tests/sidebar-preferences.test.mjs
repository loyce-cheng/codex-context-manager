import test from 'node:test';
import assert from 'node:assert/strict';
import {readSidebarPreferences,saveSidebarPreferences} from '../native-sidebar/src/preferences.mjs';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),data};};
const one={mode:'vertical',position:{x:.25,y:.75}},two={mode:'horizontal',position:{x:.5,y:.2}};
test('reload and new windows retain preferences without moving another open window',()=>{
  const localStorage=memory(),a={localStorage,sessionStorage:memory()},b={localStorage,sessionStorage:memory()};
  saveSidebarPreferences(a,one);assert.deepEqual(readSidebarPreferences(a),one);assert.deepEqual(readSidebarPreferences(b),one);
  saveSidebarPreferences(b,two);assert.deepEqual(readSidebarPreferences(a),one);assert.deepEqual(readSidebarPreferences(b),two);
  assert.deepEqual(readSidebarPreferences({localStorage,sessionStorage:memory()}),two);
});
test('storage failures, corrupt data and future versions fall back safely; no thread data is saved',()=>{
  const blocked={get localStorage(){throw Error('denied');},get sessionStorage(){throw Error('denied');}};
  assert.equal(saveSidebarPreferences(blocked,one),false);assert.equal(readSidebarPreferences(blocked).mode,'docked');
  const storage={localStorage:memory(),sessionStorage:memory()};
  assert.equal(saveSidebarPreferences(storage,{...one,position:{x:2,y:0}}),false);
  saveSidebarPreferences(storage,{...one,threadId:'private-id',capacity:100000});
  const [[key,stored]]=storage.localStorage.data;assert.ok(!stored.includes('private-id'));assert.ok(!stored.includes('capacity'));
  storage.sessionStorage.setItem(key,'invalid-json');assert.deepEqual(readSidebarPreferences(storage),one);
  storage.localStorage.setItem(key,JSON.stringify({version:99,...one}));assert.equal(readSidebarPreferences(storage).mode,'docked');
});
