import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const M=require('../../chamber-factor-migration.js');

describe('chamber factor migration',()=>{
  it('changes every stored chamber representation to one half without touching minutes',()=>{
    const db={
      sessionPlants:[{id:'a',activityType:'chamber',activityFactor:1/3,mins:40}],
      forestPlants:[{id:'b',activityType:'chamber',mins:60}],
      pianoRewards:{sessions:[{id:'c',activityType:'chamber',activityFactor:1/3,seconds:1200}]},
      sesiones:[{items:[
        {id:'d',activityType:'chamber',activityFactor:1/3,minutosReales:30},
        {id:'e',activityType:'study',activityFactor:1,minutosReales:50}
      ]}]
    };
    expect(M.migrateDatabase(db)).toBe(4);
    expect(db.sessionPlants[0]).toMatchObject({activityFactor:.5,mins:40});
    expect(db.sessionPlants[0]._fieldClock.activityFactor).toBeTruthy();
    expect(db.forestPlants[0]).toMatchObject({activityFactor:.5,mins:60});
    expect(db.pianoRewards.sessions[0]).toMatchObject({activityFactor:.5,seconds:1200});
    expect(db.pianoRewards.sessions[0]._fieldClock.activityFactor).toBeTruthy();
    expect(db.sesiones[0].items[0]).toMatchObject({activityFactor:.5,minutosReales:30});
    expect(db.sesiones[0].items[1]).toMatchObject({activityFactor:1,minutosReales:50});
  });

  it('is idempotent once chamber rows are already migrated',()=>{
    const db={sessionPlants:[{activityType:'chamber',activityFactor:.5,mins:40}],forestPlants:[],sesiones:[],pianoRewards:{sessions:[]}};
    expect(M.migrateDatabase(db)).toBe(0);
  });
});
