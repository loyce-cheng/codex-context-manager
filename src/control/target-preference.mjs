export function targetPreferenceKey(threadId,model) {
  return 'context-lens.target.v1.local.'+threadId+'.'+model;
}

export function readTargetPreference(read,key,levels) {
  try {
    const tier=Number(read(key));
    return levels.includes(tier)?tier:null;
  } catch {return null;}
}
