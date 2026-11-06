"""Prueba «Permitir» del monitor externo sin importarlo, arrancar Selenium ni tocar Asimut.

Uso: python tests/monitor/test_allow_rebook.py ruta/monitor_huecos_alberto.py
"""
import ast
from datetime import date, datetime, timedelta
from pathlib import Path
import sys
import unittest

source = Path(sys.argv.pop(1)).read_text(encoding="utf-8-sig")
names = {"_huecos_bloqueados", "_huecos_publicos", "_hueco_texto", "_app_permitir_huecos"}
tree = ast.parse(source)
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
# Solo la capa del despachador que atiende allow_rebook; hay otras encima y debajo.
wrapper = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_apply_study_dashboard_command"
               and "allow_rebook" in ast.get_source_segment(source, n))
module = ast.Module(body=functions + [wrapper], type_ignores=[])

HOY = date.today()
TAG = HOY.strftime("%Y%m%d")
TODAS = f"*:{TAG}:1800:2030"
AULA = f"175:{TAG}:1000:1100"
PASADO = f"175:{(HOY - timedelta(days=1)).strftime('%Y%m%d')}:1000:1100"


class AllowRebookTests(unittest.TestCase):
    def setUp(self):
        self.saved = []
        self.passed = []
        self.ns = {
            "date": date, "datetime": datetime, "timedelta": timedelta,
            "NO_REBOOK_ANY_ROOM": "*", "_NO_REBOOK_SLOTS": {TODAS, AULA, PASADO},
            "_DESAP_BLOQUEOS": {7: AULA, 8: "otro"}, "DASHBOARD_STATE": {},
            "_room_label": str,
            "_runtime_settings_save": lambda force=False: self.saved.append(force),
            "_tg_log": lambda *a: None,
            "_apply_study_dashboard_command_sin_huecos": lambda c: self.passed.append(c) or "antes",
        }
        exec(compile(module, "monitor-extract", "exec"), self.ns)
        self.apply = self.ns["_apply_study_dashboard_command"]

    def test_publica_solo_vigentes_con_todas_las_aulas_como_null(self):
        out = self.ns["_huecos_publicos"]()
        self.assertEqual({x["key"] for x in out}, {TODAS, AULA})
        todas = next(x for x in out if x["key"] == TODAS)
        self.assertEqual(todas, {"key": TODAS, "room": None, "date": HOY.isoformat(), "start": "18:00", "end": "20:30"})
        self.assertEqual(next(x for x in out if x["key"] == AULA)["room"], 175)

    def test_permitir_uno_deja_los_demas_y_guarda(self):
        self.apply({"command": "allow_rebook", "payload": {"key": AULA}})
        self.assertEqual(self.ns["_NO_REBOOK_SLOTS"], {TODAS, PASADO})
        self.assertEqual(self.ns["_DESAP_BLOQUEOS"], {8: "otro"})
        self.assertEqual(self.saved, [True])

    def test_permitir_todo(self):
        self.apply({"command": "allow_rebook", "payload": {"all": True}})
        self.assertEqual(self.ns["_NO_REBOOK_SLOTS"], set())
        self.assertEqual(self.saved, [True])

    def test_rechaza_lo_que_no_esta_y_no_toca_nada(self):
        for payload in ({"key": "999:20990101:1000:1100"}, {}, {"all": "true"}, {"all": 1}):
            with self.assertRaises(ValueError):
                self.apply({"command": "allow_rebook", "payload": payload})
        self.assertEqual(len(self.ns["_NO_REBOOK_SLOTS"]), 3)
        self.assertEqual(self.saved, [])

    def test_las_demas_ordenes_siguen_su_camino(self):
        orden = {"command": "pause", "payload": {}}
        self.assertEqual(self.apply(orden), "antes")
        self.assertEqual(self.passed, [orden])
        self.assertEqual(len(self.ns["_NO_REBOOK_SLOTS"]), 3)


if __name__ == "__main__":
    unittest.main()
