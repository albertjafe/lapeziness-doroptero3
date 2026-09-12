(function(root,factory) {
  const api=factory();
  if (typeof module==='object' && module.exports) module.exports=api; else root.GermanImport=api;
})(typeof window!=='undefined'?window:globalThis,function() {
  'use strict';
  const SCHEMA='german-study-pack.v1';
  const CARD_TYPES=['de_es','es_de','expression','grammar','question_answer','cloze'];
  const EXERCISE_TYPES=['fill_blank','translation','conjugation','short_answer','free_write'];
  const MAX_BYTES=2*1024*1024, MAX_ITEMS=2000;
  const object=x=>x && typeof x==='object' && !Array.isArray(x);
  function validate(input) {
    const errors=[];
    if (!object(input)) return {errors:['El paquete debe ser un objeto JSON.']};
    if (input.schema!==SCHEMA) errors.push('schema: se requiere '+SCHEMA);
    const text=(value,path,required=false)=> {
      if (value===undefined && !required) return '';
      if (typeof value!=='string' || (required && !value.trim()) || value.length>10000) {
        errors.push(path+': debe ser texto'+(required?' no vacío':'')+' (máximo 10.000 caracteres)'); return '';
      }
      return value.trim();
    };
    const list=(value,path)=> {
      if (value===undefined) return [];
      if (!Array.isArray(value) || value.length>100) { errors.push(path+': se requiere una lista de hasta 100 textos'); return []; }
      return value.map((v,i)=>text(v,path+'['+i+']',true));
    };
    const meta=object(input.metadata)?input.metadata:{};
    if (!object(input.metadata)) errors.push('metadata: se requiere un objeto');
    const metadata={title:text(meta.title,'metadata.title',true)};
    for (const key of ['date','teacher','source','notes']) metadata[key]=text(meta[key],'metadata.'+key);
    if (metadata.date) {
      const date=new Date(metadata.date+'T12:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date) || !Number.isFinite(+date) || date.toISOString().slice(0,10)!==metadata.date)
        errors.push('metadata.date: fecha real YYYY-MM-DD');
    }
    let count=0;
    const rows=(key,types)=> {
      if (!Array.isArray(input[key])) {errors.push(key+': se requiere una lista');return [];}
      count+=input[key].length;
      if (input[key].length>MAX_ITEMS) {errors.push(key+': demasiados elementos');return [];}
      const ids=new Set();
      return input[key].map((row,i)=> {
        const path=key+'['+i+']';
        if (!object(row)) {errors.push(path+': se requiere un objeto');return {};}
        if (!types.includes(row.type)) errors.push(path+'.type: valores permitidos '+types.join(', '));
        const result={type:row.type};
        if (row.id!==undefined) {
          result.sourceId=text(row.id,path+'.id',true);
          if (ids.has(result.sourceId)) errors.push(path+'.id: identificador repetido');
          ids.add(result.sourceId);
        }
        for (const field of key==='cards'?['front','back']:['prompt']) result[field]=text(row[field],path+'.'+field,true);
        for (const field of ['hint','explanation']) result[field]=text(row[field],path+'.'+field);
        result.tags=list(row.tags,path+'.tags');
        if (key==='cards') result.examples=list(row.examples,path+'.examples');
        else {
          result.answer=text(row.answer,path+'.answer');
          result.acceptedAnswers=list(row.acceptedAnswers,path+'.acceptedAnswers');
          if (!result.answer && !result.acceptedAnswers.length) errors.push(path+': incluye answer (modelo para free_write) o acceptedAnswers');
        }
        return result;
      });
    };
    const cards=rows('cards',CARD_TYPES),exercises=rows('exercises',EXERCISE_TYPES);
    if (!count || count>MAX_ITEMS) errors.push('El paquete debe contener entre 1 y 2.000 tarjetas/ejercicios en total.');
    return {errors,pack:{schema:SCHEMA,metadata,cards,exercises}};
  }
  function csvRows(source) {
    const delimiter=source.split(/\r?\n/)[0].includes(';')?';':',';
    const rows=[];let row=[],value='',quoted=false,closed=false;
    for (let i=0;i<source.length;i++) {
      const c=source[i];
      if (quoted) {
        if (c==='"' && source[i+1]==='"') {value+='"';i++;}
        else if (c==='"') {quoted=false;closed=true;} else value+=c;
      } else if (c==='"') {
        if (value || closed) throw new Error('CSV: comillas fuera de lugar');
        quoted=true;
      } else if (c===delimiter || c==='\n' || c==='\r') {
        row.push(value);value='';closed=false;
        if (c!==delimiter) {if (c==='\r' && source[i+1]==='\n') i++;if (row.some(x=>x.trim())) rows.push(row);row=[];}
      } else {if (closed) throw new Error('CSV: texto después de comillas de cierre');value+=c;}
    }
    if (quoted) throw new Error('CSV: comillas sin cerrar');
    row.push(value);if (row.some(x=>x.trim())) rows.push(row);
    return rows;
  }
  function fromCSV(source,title) {
    const [headers,...rows]=csvRows(source);
    if (!headers || !headers.includes('front') || !headers.includes('back')) throw new Error('CSV: cabeceras obligatorias front,back');
    if (new Set(headers).size!==headers.length) throw new Error('CSV: cabeceras repetidas');
    const cards=rows.map((row,i)=> {
      if (row.length!==headers.length) throw new Error('CSV fila '+(i+2)+': número de columnas incorrecto');
      const c=Object.fromEntries(headers.map((h,j)=>[h,row[j]]));
      return {...c,type:c.type || 'de_es',tags:c.tags?c.tags.split('|'):[],examples:c.examples?c.examples.split('|'):[]};
    });
    return {schema:SCHEMA,metadata:{title},cards,exercises:[]};
  }
  async function parse(source,filename='material.json') {
    if (new TextEncoder().encode(source).length>MAX_BYTES) throw new Error('El archivo supera 2 MB. Divídelo en paquetes más pequeños.');
    source=source.replace(/^\uFEFF/,'');
    let input;
    if (/\.csv$/i.test(filename)) input=fromCSV(source,filename.replace(/\.csv$/i,''));
    else if (/\.json$/i.test(filename)) {try {input=JSON.parse(source);} catch {throw new Error('JSON inválido: revisa las comillas, comas y llaves.');}}
    else throw new Error('Importa un archivo .json o .csv');
    const {errors,pack}=validate(input);
    if (errors.length) throw new Error(errors.join('\n'));
    const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(pack)));
    const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    return {id:'pack-'+hash,importHash:hash,...pack,
      cards:pack.cards.map((c,i)=>({...c,id:hash+':c:'+i})),exercises:pack.exercises.map((e,i)=>({...e,id:hash+':e:'+i}))};
  }
  function insert(state,pack,now=Date.now()) {
    if (state.materials.some(m=>m.id===pack.id || m.importHash===pack.importHash)) return false;
    state.materials.push({...pack,importedAt:new Date(now).toISOString()});return true;
  }
  const EXAMPLE={schema:SCHEMA,metadata:{title:'Unterwegs · A2/B1',teacher:'',date:'2026-09-12',source:'Ejemplo',notes:'Sustituye este material por el de tu clase.'},
    cards:[{type:'de_es',front:'der Bahnhof',back:'la estación de tren',examples:['Ich warte am Bahnhof.'],tags:['viajes']},
      {type:'es_de',front:'la estación de tren',back:'der Bahnhof'},
      {type:'cloze',front:'Ich ___ am Bahnhof. (warten)',back:'warte',explanation:'Ich + raíz verbal + -e.'}],
    exercises:[{type:'conjugation',prompt:'Conjuga warten con du en presente.',answer:'du wartest',acceptedAnswers:['wartest']},
      {type:'free_write',prompt:'Escribe dos frases sobre un viaje.',answer:'Ich fahre nach Berlin. Ich warte am Bahnhof.',explanation:'Comprueba el orden del verbo y las preposiciones.'}]};
  const AI_PROMPT=`Analiza este material de mi clase de alemán y devuelve exclusivamente un german-study-pack.v1.json válido, sin Markdown ni texto adicional.
Conserva el vocabulario original y los artículos/plurales. Genera ambas direcciones cuando tenga sentido, cloze con ___, traducciones, ejercicios adicionales útiles y conjugación si aparecen verbos relevantes. Incluye explicaciones y ejemplos. No inventes datos dudosos: omite lo incierto y explícalo en metadata.notes. Mantén A2/B1 salvo indicación del material.
Objeto raíz: {"schema":"german-study-pack.v1","metadata":{"title":"Título","date":"YYYY-MM-DD","teacher":"","source":"","notes":""},"cards":[],"exercises":[]}.
metadata.title es obligatorio; los demás campos son textos opcionales. Omite date si desconoces la fecha.
Cada tarjeta: type (${CARD_TYPES.join(', ')}), front y back no vacíos; hint y explanation opcionales; examples y tags son listas de textos. Cloze usa ___ en front y la respuesta completa en back.
Cada ejercicio: type (${EXERCISE_TYPES.join(', ')}), prompt no vacío, answer como texto y/o acceptedAnswers como lista de textos. En free_write incluye answer con la solución modelo. hint, explanation y tags son opcionales. Da todas las alternativas válidas para corrección literal; no hay evaluación semántica automática.
No uses HTML. Máximo 2.000 elementos y 2 MB. Incluye siempre ambas listas, aunque alguna esté vacía. No cambies estos nombres de campos o tipos.
Ejemplo válido:
${JSON.stringify(EXAMPLE,null,2)}`;
  return {SCHEMA,CARD_TYPES,EXERCISE_TYPES,MAX_BYTES,validate,csvRows,fromCSV,parse,insert,EXAMPLE,AI_PROMPT};
});
