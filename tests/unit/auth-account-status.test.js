import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';

const source=readFileSync('app.js','utf8');
const auth=source.slice(source.indexOf('async function _cloudAuthUser('),source.indexOf('async function _cloudQuery('));
const ui=source.slice(source.indexOf('async function updateSyncStatusInfo('),source.indexOf('function ajustesAccountTap('));
function harness(result){
  const elements=Object.fromEntries(['syncStatusInfo','ajustesAccountAvatar','ajustesAccountName','ajustesAccountSub'].map(id=>[id,{style:{}}]));
  const ctx={document:{getElementById:id=>elements[id]},getSB:()=>({auth:{getUser:async()=>result}}),
    _setCloudStage:()=>{throw Error('Settings must not overwrite an active sync diagnostic');},
    SyncCore:{isDirty:()=>true},_readSyncMeta:()=>({}),_lastCloudSnapshot:null,setTimeout,clearTimeout};
  vm.createContext(ctx);vm.runInContext(auth+ui,ctx);return {ctx,elements};
}
describe('account verification errors in Settings',()=>{
  it('distinguishes an unavailable auth server from an absent session',async()=>{
    const h=harness({data:{user:null},error:{name:'AuthRetryableFetchError',status:503}});
    await h.ctx.updateSyncStatusInfo();await h.ctx.updateAjustesAccountRow();
    expect(h.elements.syncStatusInfo.innerHTML).toContain('No se ha podido verificar');
    expect(h.elements.syncStatusInfo.innerHTML).not.toContain('Sin sesión activa');
    expect(h.elements.ajustesAccountSub.textContent).toContain('estudio guardado localmente');
  });
  it('shows the connection action when the SDK confirms a missing session',async()=>{
    const h=harness({data:{user:null},error:{name:'AuthSessionMissingError'}});
    await h.ctx.updateSyncStatusInfo();expect(h.elements.syncStatusInfo.innerHTML).toContain('Sin sesión activa');
  });
});
