/* Same musical algorithms as the UI, isolated from input/rendering. No network
 * data reads or persistence: each request contains one immutable snapshot. */
self.window = self;
importScripts('./readiness-core.js?v=342','./solidity-model.js?v=342',
  './readiness-pill-model.js?v=342','./readiness-recovery-context.js?v=342',
  './work-difficulty-model.js?v=342','./work-difficulty-stored-priority.js?v=342',
  './professor-core.js?v=349','./professor-report-normalizer.js?v=342',
  './professor-competition-deadline-bridge.js?v=342','./professor-event-gate.js?v=349',
  './professor-duration-policy.js?v=349','./professor-handoff-resilience.js?v=349');
WorkDifficultyModel.installReadiness(ReadinessCore);
self.onmessage = ({data:request}) => {
  try {
    const {id,data,options,enrichment,handoff}=request;
    const report=ProfessorCore.buildReport(data,{asOf:new Date(options.now),googleCalendarState:options.googleCalendarState,activeSession:options.activeSession});
    Object.assign(report,enrichment);
    self.ProfessorTemporaryChat={withTemporaryChat:url=>options.temporaryChat ? url+(url.includes('?')?'&':'?')+'temporary-chat=true' : url};
    // Blob is immutable: avoid cloning the full report + huge prompt back to
    // the UI or materializing the file contents in a DOM control.
    if(handoff) self.postMessage({id,built:ProfessorHandoffResilience.transferArtifact(report,options,ProfessorCore)});
    else self.postMessage({id,report});
  } catch(error) { self.postMessage({id:request.id,error:String(error?.message || error)}); }
};
