/* Bootstrap pequeño de módulos independientes cargados después de app.js. */
(function loadAppAddons(){
  function load(id,src,onload){
    if(document.getElementById(id)){
      if(onload) onload();
      return;
    }
    const script=document.createElement('script');
    script.id=id;
    script.src=src;
    script.async=false;
    if(onload) script.addEventListener('load',onload,{once:true});
    document.head.appendChild(script);
  }
  function loadStyle(id,href){
    if(document.getElementById(id)) return;
    const link=document.createElement('link');
    link.id=id;
    link.rel='stylesheet';
    link.href=href;
    document.head.appendChild(link);
  }
  loadStyle('cronoReadinessLayoutStyles','./crono-readiness-layout.css?v=1');
  loadStyle('cronoIdleHierarchyStyles','./crono-idle-hierarchy.css?v=3');
  loadStyle('cronoRunningPremiumStyles','./crono-running-premium.css?v=1');
  loadStyle('obrasRedesignStyles','./obras-redesign.css?v=1');
  loadStyle('obrasRedesignPolishStyles','./obras-redesign-polish.css?v=2');
  loadStyle('obrasUnifiedLibraryStyles','./obras-unified-library.css?v=1');
  loadStyle('workDifficultyStyles','./work-difficulty.css?v=1');
  loadStyle('eventPlanningStyles','./event-planning.css?v=1');
  load('pianoRoomsCoreScript','./piano-rooms-core.js?v=1');
  load('localSaveResilienceScript','./local-save-resilience.js?v=1');
  load('cronoSaveResilienceScript','./crono-save-resilience.js?v=1');
  load('updateSafetyScript','./update-safety.js?v=1');
  load('cronoRunningPremiumScript','./crono-running-premium.js?v=1');
  load('eventPlanningScript','./event-planning.js?v=1');
  load('workDifficultyModelScript','./work-difficulty-model.js?v=1',function(){
    load('workDifficultyStoredPriorityScript','./work-difficulty-stored-priority.js?v=1');
  });
  load('historicalEventsScript','./historical-events.js?v=1',function(){
    load('historicalEventsDetailsScript','./historical-events-details.js?v=2');
  });

  // La píldora 0–100 sigue siendo la única verdad del estado presente. Si se
  // trabaja por movimientos, la obra deriva su píldora de esas mediciones; el
  // hecho de ser repertorio recuperado es solo contexto histórico automático.
  load('solidityModelScript','./solidity-model.js?v=5',function(){
    load('readinessPillModelScript','./readiness-pill-model.js?v=1',function(){
      load('readinessRecoveryContextScript','./readiness-recovery-context.js?v=2');
    });

    load('workStructureCatalogScript','./work-structure-catalog.js?v=1',function(){
      load('obraPremiumScript','./obra-premium.js?v=1',function(){
        load('obraPremiumPolishScript','./obra-premium-polish.js?v=4',function(){
          load('obrasRedesignScript','./obras-redesign.js?v=1',function(){
            load('obrasRedesignPolishScript','./obras-redesign-polish.js?v=6',function(){
              load('obrasUnifiedLibraryScript','./obras-unified-library.js?v=2',function(){
                load('workDifficultyIntegrationScript','./work-difficulty-integration.js?v=1');
                load('historicalRealStudyPolishScript','./historical-real-study-polish.js?v=1');
              });
            });
          });
        });
      });
    });
  });
})();
