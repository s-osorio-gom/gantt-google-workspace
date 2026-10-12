#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pruebas_verificador.py — pruebas del propio verificador, con proyectos mínimos.

    python3 herramientas/pruebas_verificador.py

Un chequeo que se puede engañar da una falsa tranquilidad. Aquí se arma un
proyecto de Apps Script de juguete en un directorio temporal y se comprueba que
los chequeos de permisos fallan cuando deben: un assertAdmin() comentado o
dentro de una cadena no cuenta, y un menú no puede apuntar a una función
privada.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

VERIFICADOR = Path(__file__).with_name("verificar_apps_script.py")

MENU = """
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('X');
  const adminMenu = ui.createMenu('Admin');
  adminMenu.addItem('Hacer', '%s');
  menu.addSubMenu(adminMenu);
  menu.addToUi();
}
function assertAdmin(a) { if (!a) throw new Error('no'); }
"""


def correr(cuerpo_gs: str, manejador: str = "hacer") -> dict[str, str]:
    """Corre el verificador sobre un proyecto mínimo; devuelve {chequeo: 'OK'|'FALLA'|'AVISO'}."""
    with tempfile.TemporaryDirectory() as tmp:
        raiz = Path(tmp) / "apps-script"
        raiz.mkdir()
        (raiz / "appsscript.json").write_text(json.dumps(
            {"timeZone": "UTC", "runtimeVersion": "V8", "oauthScopes": []}), encoding="utf-8")
        (raiz / "01_Menu.gs").write_text(MENU % manejador, encoding="utf-8")
        (raiz / "02_Cuerpo.gs").write_text(cuerpo_gs, encoding="utf-8")
        r = subprocess.run([sys.executable, str(VERIFICADOR), str(raiz)],
                           capture_output=True, text=True)
    estado = {}
    for linea in r.stdout.splitlines():
        linea = linea.strip()
        if linea.startswith("[") and "]" in linea:
            marca, resto = linea[1:].split("]", 1)
            estado[resto.strip().split(" — ")[0]] = marca.strip()
    return estado


MENU_ADMIN = "Menú Admin comprueba admin en el servidor"
DIAG = "Funciones _diag/_demo comprueban admin"
PRIVADAS = "Menú, disparadores y paneles no apuntan a funciones privadas (…_)"


class ChequeoMenuAdmin(unittest.TestCase):
    def test_assert_real_pasa(self):
        e = correr("function hacer() {\n  assertAdmin('hacer');\n}\n")
        self.assertEqual(e[MENU_ADMIN], "OK")

    def test_assert_comentado_con_barras_no_cuenta(self):
        e = correr("function hacer() {\n  // assertAdmin('hacer');\n  return 1;\n}\n")
        self.assertEqual(e[MENU_ADMIN], "FALLA")

    def test_assert_en_bloque_de_comentario_no_cuenta(self):
        e = correr("function hacer() {\n  /* assertAdmin('hacer'); */\n  return 1;\n}\n")
        self.assertEqual(e[MENU_ADMIN], "FALLA")

    def test_assert_dentro_de_una_cadena_no_cuenta(self):
        e = correr("function hacer() {\n  return 'falta assertAdmin(aquí)';\n}\n")
        self.assertEqual(e[MENU_ADMIN], "FALLA")

    def test_url_con_barras_en_cadena_no_corta_el_cuerpo(self):
        e = correr("function hacer() {\n  const u = 'https://example.com/x';\n  assertAdmin('hacer');\n}\n")
        self.assertEqual(e[MENU_ADMIN], "OK")


class ChequeoDiagnostico(unittest.TestCase):
    def test_diag_sin_assert_falla(self):
        e = correr("function hacer() { assertAdmin('x'); }\n"
                   "function _diag_algo() {\n  // assertAdmin('x');\n  return 1;\n}\n")
        self.assertEqual(e[DIAG], "FALLA")

    def test_diag_con_assert_pasa(self):
        e = correr("function hacer() { assertAdmin('x'); }\n"
                   "function _demoAlgo() {\n  assertAdmin('x');\n}\n")
        self.assertEqual(e[DIAG], "OK")


class ChequeoPrivadas(unittest.TestCase):
    def test_menu_que_apunta_a_privada_falla(self):
        e = correr("function hacer_() { assertAdmin('x'); }\n", manejador="hacer_")
        self.assertEqual(e[PRIVADAS], "FALLA")


if __name__ == "__main__":
    unittest.main(verbosity=2)
