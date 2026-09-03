/* Bootstrap pequeño de módulos independientes cargados después de app.js. */
(function loadAppAddons(){
  (function retireMysteryHouse(){
    const style=document.createElement('style');
    style.id='retiredMysteryHouseStyles';
    style.textContent='#view-casa{display:none!important}.nav-btn[data-view="casa"]{display:none!important}';
    document.head.appendChild(style);
    function cleanup(){
      const nav=document.querySelector('.nav-btn[data-view="casa"]');
      const view=document.getElementById('view-casa');
      const wasActive=Boolean(nav&&nav.classList.contains('active'))||Boolean(view&&view.classList.contains('active'));
      // Conservamos el botón Casa oculto para que el Profesor pueda reutilizarlo
      // cuando termine de cargar. Solo retiramos la vista 3D antigua.
      if(view) view.remove();
      if(wasActive&&typeof window.showView==='function') window.showView('session');
    }
    if(typeof window.showView==='function'&&!window.showView.__retiredMysteryHousePatched){
      const original=window.showView;
      const patched=function(name){
        const target=name==='casa'?(document.getElementById('view-profesor')?'profesor':'session'):name;
        return original.apply(this,[target].concat(Array.prototype.slice.call(arguments,1)));
      };
      patched.__retiredMysteryHousePatched=true;
      patched.__original=original;
      window.showView=patched;
      try { showView=patched; } catch(error){}
    }
    cleanup();
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',cleanup,{once:true});
  })();

  function load(id,src,onload){
    if(document.getElementById(id)){ if(onload) onload(); return; }
    const script=document.createElement('script');
    script.id=id; script.src=src; script.async=false;
    if(onload) script.addEventListener('load',onload,{once:true});
    document.head.appendChild(script);
  }
  function loadStyle(id,href){
    if(document.getElementById(id)) return;
    const link=document.createElement('link');
    link.id=id; link.rel='stylesheet'; link.href=href;
    document.head.appendChild(link);
  }
  function loadProfessor(){
    load('professorCoreScript','./professor-core.js?v=2',function(){
      load('professorReportNormalizerScript','./professor-report-normalizer.js?v=2',function(){
        load('professorContextEnrichmentScript','./professor-context-enrichment.js?v=2',function(){
          load('professorCompetitionDeadlineBridgeScript','./professor-competition-deadline-bridge.js?v=2',function(){
            load('professorEventGateScript','./professor-event-gate.js?v=2',function(){
              load('professorDurationPolicyScript','./professor-duration-policy.js?v=1',function(){
                load('professorDashboardScript','./professor-dashboard.js?v=2',function(){
                  load('professorEventGateUiScript','./professor-event-gate-ui.js?v=2');
                });
              });
            });
          });
        });
      });
    });
  }

  loadStyle('cronoReadinessLayoutStyles','./crono-readiness-layout.css?v=1');
  loadStyle('cronoIdleHierarchyStyles','./crono-idle-hierarchy.css?v=3');
  loadStyle('cronoRunningPremiumStyles','./crono-running-premium.css?v=1');
  loadStyle('obrasRedesignStyles','./obras-redesign.css?v=1');
  loadStyle('obrasRedesignPolishStyles','./obras-redesign-polish.css?v=2');
  loadStyle('obrasUnifiedLibraryStyles','./obras-unified-library.css?v=1');
  loadStyle('workDifficultyStyles','./work-difficulty.css?v=1');
  loadStyle('eventPlanningStyles','./event-planning.css?v=1');
  loadStyle('eventPlanningUiV2Styles','./event-planning-ui-v2.css?v=1');
  loadStyle('planningEnhancementsV3Styles','./planning-enhancements-v3.css?v=1');
  loadStyle('planningEnhancementsV4Styles','./planning-enhancements-v4.css?v=1');
  load('pianoRoomsCoreScript','./piano-rooms-core.js?v=1');
  load('paseLiquidDirectTouchScript','./pase-liquid-direct-touch.js?v=2');
  load('localSaveResilienceScript','./local-save-resilience.js?v=1');
  load('cronoSaveResilienceScript','./crono-save-resilience.js?v=1',function(){
    load('taskSyncBootstrapScript','./task-sync-bootstrap.js?v=1',function(){
      load('taskSyncResilienceScript','./task-sync-resilience.js?v=1',function(){
        load('taskRecoveryUiScript','./task-recovery-ui.js?v=1');
      });
    });
  });
  load('updateSafetyScript','./update-safety.js?v=1');
  load('cronoRunningPremiumScript','./crono-running-premium.js?v=1');
  load('eventPlanningScript','./event-planning.js?v=1',function(){
    load('competitionPlanningSeedScript','./competition-planning-seed.js?v=1',function(){
      load('eventPlanningUiV2Script','./event-planning-ui-v2.js?v=1',function(){
        load('planningEnhancementsV3Script','./planning-enhancements-v3.js?v=1',function(){
          load('planningEnhancementsV3FixScript','./planning-enhancements-v3-fix.js?v=1',function(){
            load('planningEnhancementsV4Script','./planning-enhancements-v4.js?v=2',function(){
              load('planningEnhancementsV4SpeechFixScript','./planning-enhancements-v4-speech-fix.js?v=1',loadProfessor);
            });
          });
        });
      });
    });
  });
  load('workDifficultyModelScript','./work-difficulty-model.js?v=1',function(){
    load('workDifficultyStoredPriorityScript','./work-difficulty-stored-priority.js?v=1');
  });
  load('historicalEventsScript','./historical-events.js?v=1',function(){
    load('historicalEventsDetailsScript','./historical-events-details.js?v=2');
  });
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
