/* Same musical algorithms as the UI, isolated from input/rendering. No network
 * data reads or persistence: each request contains one immutable snapshot. */
self.window = self;
importScripts('./readiness-core.js?v=342','./solidity-model.js?v=342',
  './readiness-pill-model.js?v=342','./readiness-recovery-context.js?v=342',
  './work-difficulty-model.js?v=342','./work-difficulty-stored-priority.js?v=342',
  './professor-core.js?v=342','./professor-report-normalizer.js?v=342',
  './professor-competition-deadline-bridge.js?v=342','./professor-event-gate.js?v=342',
  './professor-duration-policy.js?v=342','./professor-handoff-resilience.js?v=342');
WorkDifficultyModel.installReadiness(ReadinessCore);
self.onmessage = ({data:request}) => {
  try {
    const {id,data,options,enrichment,handoff}=request;
    const report=ProfessorCore.buildReport(data,{asOf:new Date(options.now),googleCalendarState:options.googleCalendarState,activeSession:options.activeSession});
    Object.assign(report,enrichment);
    self.ProfessorTemporaryChat={withTemporaryChat:url=>options.temporaryChat ? url+'&temporary-chat=true' : url};
    const built=handoff ? ProfessorHandoffResilience.buildSafeChatGptUrl(report,options,ProfessorCore) : null;
    self.postMessage({id,report,built});
  } catch(error) { self.postMessage({id:request.id,error:String(error?.message || error)}); }
};
