/* Bootstrap pequeño de módulos independientes cargados después de app.js. */
(function loadAppAddons(){
  function load(id,src){
    if(document.getElementById(id)) return;
    const script=document.createElement('script');
    script.id=id;
    script.src=src;
    script.async=false;
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
  loadStyle('cronoIdleHierarchyStyles','./crono-idle-hierarchy.css?v=2');
  load('pianoRoomsCoreScript','./piano-rooms-core.js?v=1');
  load('historicalEventsScript','./historical-events.js?v=1');
})();
