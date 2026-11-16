"""Offline regression tests: no monitor import, network or real reservations."""
import ast
from datetime import date, datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys
import time
import tempfile
import json
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('class_reservation_plan', ROOT / 'scripts/monitor/class_reservation_plan.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
sys.modules[spec.name] = policy
SOURCE = Path(sys.argv.pop(1)) if len(sys.argv) > 1 and sys.argv[1].endswith('.py') else None
TREE = ast.parse(SOURCE.read_text(encoding='utf-8-sig')) if SOURCE else None
D = date(2030, 6, 18)
def t(hour, minute=0):
    return datetime.combine(D, datetime.min.time()).replace(hour=hour, minute=minute, tzinfo=timezone.utc)


class ClassPlans(unittest.TestCase):
    def setUp(self):
        self.own = [{'event_id': 1, 'aula': 123, 'ini': t(15), 'fin': t(16, 30), 'aula_str': '10.123', 'tipo': 'group'}]
        self.free = {123: (t(15), t(16, 30)), 124: (t(16), t(17))}
        self.now = t(0) - timedelta(hours=1)

    def plans(self, **kwargs):
        def allowed(room, a, b, released):
            low, high = self.free[room]
            return low <= a and b <= high
        args = dict(start=t(16), end=t(17), desired_start=t(15,45), desired_end=t(17,15),
                    own=self.own, rooms=list(self.free), now=self.now, slot_allowed=allowed,
                    max_minutes=210, room_group=lambda a: 5)
        args.update(kwargs)
        return policy.full_class_plans(**args)

    def test_whole_hour_replaces_partial_old_booking(self):
        p = self.plans()[0]
        self.assertEqual((p['aula'], p['ini'], p['fin']), (124,t(16),t(17)))
        self.assertEqual(p['liberadas'],self.own)

    def test_margin_better_than_exact_hour(self):
        self.free[125]=(t(15,45),t(17,15))
        self.assertEqual(self.plans()[0]['aula'],125)

    def test_one_sided_margin(self):
        self.free[124]=(t(16),t(17,15))
        self.assertEqual(self.plans()[0]['fin'],t(17,15))

    def test_extend_current_room_without_cancellation(self):
        self.free[123]=(t(15),t(17,15))
        p=self.plans()[0]
        self.assertIs(p['ampliar'],self.own[0])
        self.assertEqual(p['ini'],t(15))

    def test_unrelated_booking_not_cancelled_for_margin(self):
        self.own.append({'event_id':2,'aula':125,'ini':t(17),'fin':t(18)})
        self.free[124]=(t(16),t(17,15))
        self.assertEqual(self.plans()[0]['fin'],t(17))
        self.assertEqual(len(self.plans()[0]['liberadas']),1)

    def test_started_booking_not_moved(self):
        self.now=t(15,30)
        self.assertEqual(self.plans(),[])

    def test_started_booking_can_extend_in_place(self):
        self.now=t(15,30)
        self.free[123]=(t(15),t(17))
        p=self.plans()[0]
        self.assertEqual((p['aula'],p['ini'],p['fin']),(123,t(15),t(17)))

    def test_complete_booking_stable_on_equal_alternative(self):
        self.own[0].update(ini=t(16),fin=t(17))
        self.free[123]=(t(16),t(17))
        self.assertTrue(self.plans(rooms=[124,123])[0]['unchanged'])

    def test_merge_fragments_for_whole_hour(self):
        self.own.append({'event_id':2,'aula':125,'ini':t(16,30),'fin':t(17)})
        self.assertEqual(len(self.plans()[0]['liberadas']),2)

    def test_no_partial_plan_claimed_as_whole(self):
        self.free[124]=(t(16,30),t(17,15))
        self.assertEqual(self.plans(),[])

    def test_maximum_never_clips_class(self):
        self.assertEqual(self.plans(max_minutes=45),[])
        self.assertEqual(self.plans(max_minutes=60)[0]['ini'],t(16))

    def test_blocked_room_excluded(self):
        self.assertEqual(self.plans(slot_allowed=lambda *a: False),[])


@unittest.skipUnless(SOURCE, 'Pass external monitor source to test integration')
class Integration(unittest.TestCase):
    def setUp(self):
        ClassPlans.setUp(self)
        functions=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name in {'_franja_margenes','_franja_clase_entera'}]
        self.assertEqual(len(functions),2)
        self.locks=[]; self.migrations=[]; self.messages=[]; self.reclaims=[]
        self.quota={'rf_secs':90*60,'sz_secs':30*60}
        self.ns=dict(datetime=datetime,date=date,time=time,_FRANJA_FALLOS={},FRANJA_REINTENTO_S=1800,
            MAX_RESERVA_HORAS=3.5,ACTIVE_USER='test',_franja_salas_ordenadas=lambda:list(self.free),
            _franja_sala_libre=lambda room,a,b,*args:self.free[room][0]<=a and b<=self.free[room][1],
            _franja_choque_1h=lambda *a:False,intersects_blind=lambda *a:False,_blinds_efectivos=lambda *a:[],
            obtener_grupo_aula=lambda a:5,fetch_cuotas_v2=lambda *a:self.quota,
            _qlab_sz_minutes=lambda a,b:int((b-a).total_seconds()/60),
            obtener_modo_reserva=lambda a:'group',_manual_shutdown_requested=lambda:False,
            _franja_candado=lambda eid,on,*a:self.locks.append((eid,on)),
            ejecutar_migracion=lambda cand,d:self.migrations.append(cand) or True,
            _franja_mias=lambda *a:self.own,send_tg=self.messages.append,
            _franja_sin_cuota=lambda *a:self.reclaims.append(a) or 'quota')
        exec(compile(ast.Module(body=functions,type_ignores=[]),'integration-extract','exec'),self.ns)

    def run_plan(self):
        return self.ns['_franja_clase_entera']({'ini':'16:00','fin':'17:00','margen_ini':'15:45','margen_fin':'17:15','nombre':'Clase'},D,t(16),t(17),{'cookies':None,'ua':None},self.now,self.own,self.own,{})

    def test_uses_existing_transaction_and_relocks(self):
        self.run_plan()
        self.assertEqual(self.migrations[0]['mig_ini'],t(16))
        self.assertEqual(self.migrations[0]['reservas_cubiertas'][0][:2],(t(15),t(16,30)))
        self.assertEqual(self.locks,[(1,False),(1,True)])

    def test_failure_relocks_restored_new_id(self):
        def fail(cand,d):
            self.own[0]['event_id']=9
            return False
        self.ns['ejecutar_migracion']=fail
        self.assertIn('fallido',self.run_plan())
        self.assertEqual(self.locks,[(1,False),(9,True)])

    def test_exception_relocks(self):
        def fail(*args): raise RuntimeError('test failure')
        self.ns['ejecutar_migracion']=fail
        with self.assertRaises(RuntimeError): self.run_plan()
        self.assertEqual(self.locks,[(1,False),(1,True)])

    def test_unknown_quota_does_not_unlock(self):
        self.quota=None
        self.assertIn('cuota',self.run_plan())
        self.assertEqual(self.locks,[])

    def test_optional_margin_does_not_force_quota_reclaim(self):
        self.own[0]['ini']=t(16)
        self.free[124]=(t(15,45),t(17,15))
        self.quota={'rf_secs':30*60,'sz_secs':30*60}
        self.run_plan()
        self.assertEqual((self.migrations[0]['mig_ini'],self.migrations[0]['mig_fin']),(t(16),t(17)))
        self.assertEqual(self.reclaims,[])

    def test_legacy_franja_has_no_invented_margin(self):
        self.assertEqual(self.ns['_franja_margenes']({'ini':'16:00','fin':'17:00'},t(16),t(17)),(t(16),t(17)))

    def test_invalid_margin_rejected(self):
        with self.assertRaises(ValueError):
            self.ns['_franja_margenes']({'ini':'16:00','fin':'17:00','margen_ini':'16:15'},t(16),t(17))

    def test_persistence_preserves_margins_and_unknown_fields(self):
        fn=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='_franja_load')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'state.json'
            value={'future_field':{'x':1},'puntuales':[{'id':'example','fecha':D.isoformat(),'ini':'16:00','fin':'17:00','margen_ini':'15:45','margen_fin':'17:15','other':True}], 'franjas':[]}
            path.write_text(json.dumps(value),encoding='utf-8')
            ns={'FRANJA_FILE':str(path),'date':date,'datetime':datetime}
            exec(compile(ast.Module(body=[fn],type_ignores=[]),'persistence-extract','exec'),ns)
            loaded=ns['_franja_load']()
            self.assertEqual(loaded['future_field'],value['future_field'])
            self.assertEqual(loaded['puntuales'][0]['margen_ini'],'15:45')
            self.assertTrue(loaded['puntuales'][0]['other'])

    def migration_setup(self):
        fn=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='ejecutar_migracion')
        self.ns.update(ZoneInfo=lambda _:timezone.utc,timedelta=timedelta,SESSIONS={'test':{'driver':None,'cookies':{},'ua':'test'}},
            _clip_fin_por_max_reserva=lambda a,b:(b,False),_monitor_window_for_date=lambda *a:(t(10),t(20,30)),
            _solo_g5_bloqueo_aula=lambda a:False,_puesta_bloqueo=lambda *a:False,ROOM_MAP={124:124},
            _reservation_snapshot=lambda *a:{'event_id':1},_reservation_protection_tier=lambda a:1,
            open_agenda_day=lambda *a:True,IDS_USER={'test':1})
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'transaction-extract','exec'),self.ns)
        return {'aula_objetivo':124,'mig_ini':t(16),'mig_fin':t(17),'h_ini':t(16),'h_fin':t(17),
                'clase_imprescindible':(t(16),t(17)),
                'reservas_cubiertas':[(t(15),t(16,30),'10.123','group')]}

    def test_clipping_cannot_cancel_before_truncating_class(self):
        cand=self.migration_setup()
        self.ns['_monitor_window_for_date']=lambda *a:(t(10),t(16,45))
        self.assertFalse(self.ns['ejecutar_migracion'](cand,D,[{}]))
        self.assertTrue(any('hora imprescindible' in x for x in self.messages))

    def test_failed_preflight_keeps_original(self):
        cand=self.migration_setup()
        def fail(*args,**kwargs): raise OSError('offline')
        self.ns['probe_event']=fail
        self.assertFalse(self.ns['ejecutar_migracion'](cand,D,[{}]))
        self.assertFalse(any('error inesperado' in x for x in self.messages))
        self.assertEqual(self.locks,[])


if __name__=='__main__': unittest.main()
