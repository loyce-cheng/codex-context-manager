import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {join, isAbsolute, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {loaderClient} from '../../scripts/sidebar-loader-client.mjs';
import {LocalCodexSource} from '../../src/adapters/local-codex.mjs';
import {openTurnReceipt} from './turn-receipt.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Only a fresh, deliberate selection from the currently identified local chat.
// An existing preview in localStorage never produces a write.
export function desktopChoice(inspection, started, now) {
  const choice = inspection?.capacityChoice;
  const selected = inspection?.diagnostics?.capacityPreflight;
  if (inspection?.status !== 'following' || selected?.host !== 'local' ||
      !choice || !/^[0-9a-f]{32}$/.test(choice.id) || !uuid.test(choice.threadId) ||
      choice.threadId !== inspection.threadId || choice.threadId !== selected.threadId ||
      !/^[a-zA-Z0-9._:-]{1,96}$/.test(choice.expectedModel ?? '') ||
      choice.expectedModel !== selected.model || !Number.isSafeInteger(choice.chosenAt) ||
      choice.chosenAt < Math.max(started, now - 15000) || choice.chosenAt > now) return null;
  const tokens = choice.selection?.tokens;
  if (choice.selection !== 'default' && (!Number.isSafeInteger(tokens) || tokens <= 0)) return null;
  return {id:choice.id, record:{threadId:choice.threadId, expectedModel:choice.expectedModel,
    selection:choice.selection === 'default' ? 'default' : {tokens}}};
}

export async function writeDesktopTier(home, record) {
  if (!isAbsolute(home) || !uuid.test(record.threadId)) throw Error('Invalid desktop tier location.');
  const directory = join(home, 'context-lens-desktop-tiers-v1');
  await mkdir(directory, {recursive:true, mode:0o700});
  const temporary = join(directory, randomUUID()+'.tmp');
  try {
    await writeFile(temporary, JSON.stringify({...record,threadId:record.threadId.toLowerCase()}), {flag:'wx', mode:0o600});
    await rename(temporary, join(directory,record.threadId.toLowerCase()+'.json'));
  } finally {
    await rm(temporary, {force:true});
  }
}

export async function followDesktopChoices({home, inspect, signal, beforeWrite=async()=>true, acknowledge,confirmTurn,
  onError=code=>console.error('Context Lens tier bridge:',code)}) {
  const started = Date.now();
  const source=new LocalCodexSource({home}), submitted=new Map();
  while (!signal.aborted) {
    try {
      let response = await inspect();
      if(response?.ok===false)await onError(response.error?.code ?? 'INSPECT_FAILED');
      const choice = response?.ok && desktopChoice(response.result, started, Date.now());
      const prior=choice && submitted.get(choice.record.threadId);
      if (!signal.aborted && choice && choice.id!==prior?.id && response.result.capacityChoice.chosenAt>(prior?.chosenAt??0) && await beforeWrite() && !signal.aborted) {
        let readTurn=null;
        if(confirmTurn && response.result.turnReceipts){
          try{readTurn=await openTurnReceipt(source,choice.record);}
          catch(error){await onError(error.code??'RECEIPT_UNAVAILABLE');}
        }
        response=await inspect();
        const confirmed=response?.ok && desktopChoice(response.result,started,Date.now());
        if(!signal.aborted && confirmed?.id===choice.id &&
            confirmed.record.threadId===choice.record.threadId && confirmed.record.expectedModel===choice.record.expectedModel &&
            (confirmed.record.selection.tokens??'default')===(choice.record.selection.tokens??'default')){
          await writeDesktopTier(home, choice.record);
          submitted.delete(choice.record.threadId);
          submitted.set(choice.record.threadId,{...choice,chosenAt:response.result.capacityChoice.chosenAt,submittedAt:Date.now(),readTurn,acknowledged:false});
          if(submitted.size>64)submitted.delete(submitted.keys().next().value);
        }
      }
      const view=response?.ok && response.result;
      const selected=view?.diagnostics?.capacityPreflight;
      const written=submitted.get(view?.threadId);
      if(!signal.aborted && written && view?.status==='following' &&
          view.capacityChoice?.id===written.id && view.threadId===written.record.threadId &&
          selected?.host==='local' && selected.threadId===view.threadId && selected.model===written.record.expectedModel){
        if(!written.acknowledged){
          const receipt=await acknowledge?.(written.id);
          written.acknowledged=receipt?.ok!==false && receipt?.result?.displayed!==false;
        }
        if(written.acknowledged && written.readTurn && view.layoutOK===true && view.diagnostics?.visibility!=='hidden' && !signal.aborted){
          const capacity=await written.readTurn(written.submittedAt);
          if(capacity && !signal.aborted){
            const reply=await confirmTurn(written.id,capacity);
            if(reply?.ok && reply.result?.displayed)written.readTurn=null;
          }
        }
      }
    } catch (error) {
      if (!signal.aborted) await onError(error.code ?? error.name);
    }
    if (!signal.aborted) await delay(750, undefined, {signal}).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.CONTEXT_LENS_DESKTOP_TIERS !== '1' || !isAbsolute(process.env.CODEX_HOME ?? '')) {
    throw Error('Use the same explicitly enabled CODEX_HOME as the experimental desktop backend.');
  }
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const {inspect,acknowledge,confirmTurn} = await loaderClient(process.env.LOCALAPPDATA);
  await followDesktopChoices({home:process.env.CODEX_HOME, inspect, acknowledge,confirmTurn,signal:controller.signal});
}
