// Only display preferences. Never persist thread IDs, usage or applied capacity.
const SIDEBAR_PREFERENCES_KEY='context-lens.sidebar.ui.v1';
export function validSidebarPreferences(value) {
  return value?.version===1&&['docked','horizontal','vertical'].includes(value.mode)&&
    Number.isFinite(value.position?.x)&&value.position.x>=0&&value.position.x<=1&&
    Number.isFinite(value.position?.y)&&value.position.y>=0&&value.position.y<=1;
}
export function readSidebarPreferences(storage) {
  // Existing windows retain their own position; newly opened windows inherit
  // the user's most recent preference. No storage-event listener moves peers.
  for(const name of ['sessionStorage','localStorage']) {
    try {
      const value=JSON.parse(storage[name].getItem(SIDEBAR_PREFERENCES_KEY));
      if(validSidebarPreferences(value))return {mode:value.mode,position:{x:value.position.x,y:value.position.y}};
    } catch { /* Restricted storage, malformed data or future schema: keep a usable meter. */ }
  }
  return {mode:'docked',position:{x:0.4,y:0.35}};
}
export function saveSidebarPreferences(storage,{mode,position}) {
  const value={version:1,mode,position:{x:position?.x,y:position?.y}};
  if(!validSidebarPreferences(value))return false;
  let saved=false;
  for(const name of ['sessionStorage','localStorage']) {
    try { storage[name].setItem(SIDEBAR_PREFERENCES_KEY,JSON.stringify(value));saved=true; } catch { /* Still works in memory. */ }
  }
  return saved;
}
