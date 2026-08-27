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
  load('pianoRoomsCoreScript','./piano-rooms-core.js?v=1');
  load('historicalEventsScript','./historical-events.js?v=1');
})();
