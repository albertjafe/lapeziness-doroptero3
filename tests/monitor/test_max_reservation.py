"""Prueba el monitor externo sin importarlo, arrancar Selenium ni enviar reservas.

Uso: python tests/monitor/test_max_reservation.py ruta/monitor_huecos_alberto.py
"""
import ast
from datetime import datetime, timedelta
import os
from pathlib import Path
import sys
import tempfile
import unittest

source = Path(sys.argv.pop(1)).read_text(encoding="utf-8-sig")
names = {"_state_file_for_active_user", "_max_reserva_load", "_max_reserva_save",
         "_max_reserva_set_minutes", "_max_reserva_lbl", "_max_reserva_td",
         "_clip_fin_por_max_reserva", "_apply_study_dashboard_command"}
tree = ast.parse(source)
module = ast.Module(body=[n for n in tree.body if
    (isinstance(n, ast.FunctionDef) and n.name in names) or
    (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and
        t.id.startswith("_apply_study_dashboard_command_") for t in n.targets))], type_ignores=[])


class MaxReservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ns = {"os": os, "datetime": datetime, "timedelta": timedelta,
                   "STATE_DIR": self.temp.name, "ACTIVE_USER": "emma", "MAX_RESERVA_HORAS": 3.0,
                   "DASHBOARD_STATE": {}, "_runtime_settings_save": lambda **kw: None,
                   "_tg_log": lambda *a: None}
        exec(compile(module, "monitor-extract", "exec"), self.ns)
        self.ns["_MAX_RESERVA_FILE"] = self.ns["_state_file_for_active_user"]("max_reserva.json")

    def test_five_hours_persist_and_survive_reload(self):
        for _ in range(2):  # la misma orden repetida no suma otras cinco horas
            self.ns["_apply_study_dashboard_command"]({"command": "set_max_reservation", "payload": {"minutes": 300}})
            self.assertEqual(self.ns["MAX_RESERVA_HORAS"], 5)
        self.ns["MAX_RESERVA_HORAS"] = 3
        self.ns["_max_reserva_load"]()
        self.assertEqual(self.ns["MAX_RESERVA_HORAS"], 5)
        start = datetime(2026, 11, 7, 15)
        self.assertEqual(self.ns["_clip_fin_por_max_reserva"](start, start + timedelta(hours=6)),
                         (start + timedelta(hours=5), True))

    def test_profiles_have_separate_files(self):
        self.ns["_max_reserva_set_minutes"](300)
        self.ns["ACTIVE_USER"] = "alberto"
        other = self.ns["_state_file_for_active_user"]("max_reserva.json")
        self.assertNotEqual(other, self.ns["_MAX_RESERVA_FILE"])
        self.assertFalse(Path(other).exists())

    def test_invalid_commands_do_not_change_the_setting(self):
        for minutes in (None, True, "300", 0, 29, 301, 300.5, 1470):
            with self.subTest(minutes=minutes), self.assertRaises(ValueError):
                self.ns["_max_reserva_set_minutes"](minutes)
            self.assertEqual(self.ns["MAX_RESERVA_HORAS"], 3)

    def test_failed_save_keeps_the_previous_setting(self):
        self.ns["_max_reserva_save"] = lambda: False
        with self.assertRaises(OSError):
            self.ns["_max_reserva_set_minutes"](300)
        self.assertEqual(self.ns["MAX_RESERVA_HORAS"], 3)


if __name__ == "__main__":
    unittest.main()
