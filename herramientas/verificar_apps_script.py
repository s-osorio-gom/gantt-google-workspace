#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verificar_apps_script.py — lo que se puede comprobar sin subir el proyecto.

    python3 herramientas/verificar_apps_script.py apps-script

Apps Script no avisa de casi nada hasta que el trigger corre a las 8:30 de un
lunes y el correo no sale. Esto adelanta lo comprobable:

    sintaxis      cada .gs y cada <script> de los paneles parsea (requiere node)
    plantillas    cada renderTemplate('x') / include('x') tiene su x.html
    duplicados    ninguna función definida dos veces
    referencias   menús, disparadores y google.script.run apuntan a funciones que existen
    innerHTML     los paneles no concatenan datos sin esc() en innerHTML
    zona horaria  ninguna fecha usa una zona escrita a mano (sale de appsscript.json)
    manifiesto    appsscript.json es válido y declara sus permisos
    huerfanas     ningún .html que nadie usa
    pruebas       herramientas/pruebas_logica.js (requiere node)

El de DUPLICADOS es el que más sorprende: todos los archivos de un proyecto de
Apps Script comparten un único ámbito global. Dos funciones con el mismo nombre
en archivos distintos no son un error — **gana la del archivo que se cargue de
último**, en silencio.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

# Cualquier literal que nombre una plantilla, la llame quien la llame. Buscar
# solo las APIs de HtmlService deja fuera las que pasan por un helper propio
# —aquí, `_sidebar('sidebar_add_task')`— y las reporta como huérfanas.
REF_PLANTILLA = re.compile(r"""['"]((?:email|sidebar)_[A-Za-z0-9_\-]+)['"]""")
DEF_FUNCION = re.compile(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
CORREO = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ID_GOOGLE = re.compile(r"\b[01][A-Za-z0-9_-]{27,}\b")

INCLUDE = re.compile(r"""createHtmlOutputFromFile\(\s*['"]([^'"]+)['"]""")
MENU = re.compile(r"""addItem\([^;]*?,\s*['"]([A-Za-z_$][\w$]*)['"]\s*\)""")
TRIGGER = re.compile(r"""newTrigger\(\s*['"]([A-Za-z_$][\w$]*)['"]""")
CALL_HELPER = re.compile(r"""\bcall\(\s*['"]([A-Za-z_$][\w$]*)['"]""")
ZONA_FIJA = re.compile(r"""(?:formatDate\([^,()]+,\s*|inTimezone\(\s*)['"][A-Za-z]+/[A-Za-z_]+['"]""")

# Dominios que sí pueden aparecer: son los de los ejemplos.
DOMINIOS_EJEMPLO = {"example.com", "example.org", "example.net"}  # RFC 2606

fallos: list[str] = []


def revisar(nombre: str, ok: bool, detalle: str = "", critico: bool = True):
    print(f"  [{'OK  ' if ok else ('FALLA' if critico else 'AVISO')}] {nombre}"
          + (f" — {detalle}" if detalle else ""))
    if not ok and critico:
        fallos.append(nombre)


def _cierre(texto: str, i: int) -> int:
    """Índice justo después del paréntesis que cierra el que abre en texto[i]."""
    prof, q = 0, None
    while i < len(texto):
        c = texto[i]
        if q:
            if c == "\\":
                i += 1
            elif c == q:
                q = None
        elif c in "'\"`":
            q = c
        elif c == "(":
            prof += 1
        elif c == ")":
            prof -= 1
            if prof == 0:
                return i + 1
        i += 1
    return i


def funciones_run(texto: str) -> list[str]:
    """Nombres invocados como google.script.run[.withX(...)]*.nombre(...)."""
    out = []
    for m in re.finditer(r"google\.script\.run", texto):
        i = m.end()
        while True:
            n = re.compile(r"\s*\.\s*([A-Za-z_$][\w$]*)\s*\(").match(texto, i)
            if not n:
                break
            if n.group(1).startswith("with"):
                i = _cierre(texto, n.end() - 1)
                continue
            out.append(n.group(1))
            break
    return out


def _partes(expr: str, sep: str) -> list[str]:
    """Divide una expresión JS por `sep` a nivel superior (fuera de comillas y paréntesis)."""
    partes, prof, q, ini, i = [], 0, None, 0, 0
    while i < len(expr):
        c = expr[i]
        if q:
            if c == "\\":
                i += 1
            elif c == q:
                q = None
        elif c in "'\"`":
            q = c
        elif c in "([{":
            prof += 1
        elif c in ")]}":
            prof -= 1
        elif c == sep and prof == 0:
            partes.append(expr[ini:i])
            ini = i + 1
        i += 1
    partes.append(expr[ini:])
    return partes


def _sin_literales_ni_esc(expr: str) -> str:
    """Quita literales de texto y llamadas esc(...) de una expresión."""
    out, i = [], 0
    while i < len(expr):
        c = expr[i]
        if c in "'\"`":
            j = i + 1
            while j < len(expr) and expr[j] != c:
                j += 2 if expr[j] == "\\" else 1
            i = j + 1
            continue
        if expr.startswith("esc(", i) and (i == 0 or not re.match(r"[\w$.]", expr[i - 1])):
            i = _cierre(expr, i + 3)
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _operando_seguro(op: str, texto: str, prof: int = 0) -> bool:
    resto = _sin_literales_ni_esc(op).strip()
    if "?" in resto:                      # ternario: la condición no se imprime
        resto = resto.split("?", 1)[1]
    resto = resto.replace("(", " ").replace(")", " ").replace(":", " ").strip()
    if not re.search(r"[A-Za-z_$]", resto):
        return True
    # variable local cuyo valor se armó de forma segura (p. ej. var checked = x ? 'checked' : '')
    if prof == 0 and re.fullmatch(r"[A-Za-z_$][\w$]*", resto):
        m = re.search(r"\b(?:var|let|const)\s+" + re.escape(resto) + r"\s*=\s*([^;]+);", texto)
        if m:
            return all(_operando_seguro(o, texto, 1) for o in _partes(m.group(1), "+"))
    return False


def innerhtml_inseguros(texto: str) -> list[str]:
    """Operandos concatenados en `x.innerHTML = …` que no son literales ni pasan por esc()."""
    malos = []
    for m in re.finditer(r"\.innerHTML\s*=(?!=)", texto):
        fin, prof, q, i = None, 0, None, m.end()
        while i < len(texto):
            c = texto[i]
            if q:
                if c == "\\":
                    i += 1
                elif c == q:
                    q = None
            elif c in "'\"`":
                q = c
            elif c in "([{":
                prof += 1
            elif c in ")]}":
                prof -= 1
                if prof < 0:
                    fin = i
                    break
            elif c == ";" and prof == 0:
                fin = i
                break
            i += 1
        expr = texto[m.end():fin]
        for op in _partes(expr, "+"):
            if op.strip() and not _operando_seguro(op, texto):
                linea = texto.count("\n", 0, m.start()) + 1
                malos.append(f"línea {linea}: {' '.join(op.split())[:50]}")
    return malos


def main() -> int:
    raiz = Path(sys.argv[1] if len(sys.argv) > 1 else "apps-script").resolve()
    if not raiz.is_dir():
        print(f"No existe: {raiz}")
        return 2
    gs = sorted(raiz.glob("*.gs"))
    html = sorted(raiz.glob("*.html"))
    print(f"\n  {raiz.name}: {len(gs)} archivos .gs · {len(html)} .html · "
          f"{sum(len(f.read_text(encoding='utf-8').splitlines()) for f in gs):,} líneas\n")

    # ── sintaxis ────────────────────────────────────────────────────────────
    tiene_node = subprocess.run(["node", "--version"], capture_output=True).returncode == 0
    if not tiene_node:
        revisar("Sintaxis de JavaScript", True, "omitido: node no está instalado",
                critico=False)
    else:
        malos = []
        with tempfile.TemporaryDirectory() as tmp:
            for f in gs:
                # node rechaza la extensión .gs, así que se le da una copia .js
                copia = Path(tmp) / (f.stem + ".js")
                copia.write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
                r = subprocess.run(["node", "--check", str(copia)],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    primera = next((l for l in r.stderr.splitlines()
                                    if "Error" in l or "^" not in l and l.strip()), "")
                    malos.append(f"{f.name}: {primera.strip()[:90]}")
        revisar("Cada .gs parsea como JavaScript", not malos,
                f"{len(gs) - len(malos)} / {len(gs)}")
        for m in malos[:5]:
            print(f"        · {m}")

        # Los <script> de los paneles tampoco avisan: un error de sintaxis deja el
        # panel en blanco solo para quien lo abre.
        malos, n = [], 0
        with tempfile.TemporaryDirectory() as tmp:
            for f in html:
                bloques = re.findall(r"<script>(.*?)</script>",
                                     f.read_text(encoding="utf-8"), re.S)
                for i, js in enumerate(b for b in bloques if "<?" not in b):
                    n += 1
                    copia = Path(tmp) / f"{f.stem}_{i}.js"
                    copia.write_text(js, encoding="utf-8")
                    r = subprocess.run(["node", "--check", str(copia)],
                                       capture_output=True, text=True)
                    if r.returncode != 0:
                        err = next((l for l in r.stderr.splitlines() if "Error" in l), "")
                        malos.append(f"{f.name}: {err.strip()[:90]}")
        revisar("Cada <script> de los paneles parsea", not malos, f"{n - len(malos)} / {n}")
        for m in malos[:5]:
            print(f"        · {m}")

    # ── plantillas ──────────────────────────────────────────────────────────
    existen = {f.stem for f in html}
    referidas: dict[str, set[str]] = defaultdict(set)
    for f in gs + html:
        for nombre in REF_PLANTILLA.findall(f.read_text(encoding="utf-8")):
            referidas[nombre].add(f.name)
    rotas = {n: v for n, v in referidas.items() if n not in existen}
    revisar("Cada plantilla referenciada existe", not rotas,
            f"{len(referidas) - len(rotas)} / {len(referidas)} referencias")
    for n, donde in list(rotas.items())[:8]:
        print(f"        · falta {n}.html — lo usa {', '.join(sorted(donde))}")

    huerfanas = sorted(existen - set(referidas) - {f.stem for f in html
                                                   if f.stem.startswith("_")})
    revisar("Sin plantillas huérfanas", not huerfanas,
            ", ".join(huerfanas) if huerfanas else f"{len(existen)} en uso",
            critico=False)

    # ── duplicados en el ámbito global ──────────────────────────────────────
    donde: dict[str, list[str]] = defaultdict(list)
    for f in gs:
        for fn in DEF_FUNCION.findall(f.read_text(encoding="utf-8")):
            donde[fn].append(f.name)
    dup = {fn: v for fn, v in donde.items() if len(v) > 1}
    revisar("Ninguna función definida dos veces", not dup,
            f"{len(donde)} funciones" if not dup else f"{len(dup)} duplicadas")
    for fn, v in list(dup.items())[:8]:
        print(f"        · {fn}() en {', '.join(v)}")

    # ── referencias a funciones ─────────────────────────────────────────────
    # Un menú o un disparador que apunta a una función que no existe no avisa al
    # subir: falla cuando alguien hace clic o cuando el reloj llega a la hora.
    rotas_fn = []
    for f in gs:
        texto = f.read_text(encoding="utf-8")
        for patron, que in ((MENU, "menú"), (TRIGGER, "disparador")):
            for fn in patron.findall(texto):
                if fn not in donde:
                    rotas_fn.append(f"{f.name}: {que} → {fn}()")
    for f in html:
        texto = f.read_text(encoding="utf-8")
        for fn in funciones_run(texto) + CALL_HELPER.findall(texto):
            if fn not in donde:
                rotas_fn.append(f"{f.name}: google.script.run → {fn}()")
        for inc in INCLUDE.findall(texto):
            if inc not in existen:
                rotas_fn.append(f"{f.name}: incluye {inc}.html, que no existe")
    revisar("Menús, disparadores y paneles llaman funciones que existen", not rotas_fn,
            f"{len(rotas_fn)} rotas" if rotas_fn else "todas resuelven")
    for r in rotas_fn[:8]:
        print(f"        · {r}")

    # ── innerHTML con datos sin escapar ─────────────────────────────────────
    # Los nombres de tareas, proyectos y personas los escribe el equipo. Pegarlos
    # en innerHTML sin esc() permite inyectar HTML/JS en el panel de otro.
    xss = []
    for f in html:
        for m in innerhtml_inseguros(f.read_text(encoding="utf-8")):
            xss.append(f"{f.name} {m}")
    revisar("innerHTML de los paneles sin datos sin escapar", not xss,
            f"{len(xss)} operandos sin esc()" if xss else "todo pasa por esc()")
    for x in xss[:8]:
        print(f"        · {x}")

    # ── zona horaria ────────────────────────────────────────────────────────
    zonas = []
    for f in gs + html:
        for n, linea in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if ZONA_FIJA.search(linea):
                zonas.append(f"{f.name}:{n}")
    revisar("Fechas en la zona de appsscript.json, no en una escrita a mano", not zonas,
            ", ".join(zonas[:4]) if zonas else "usan tz()")

    # ── manifiesto ──────────────────────────────────────────────────────────
    man = raiz / "appsscript.json"
    if not man.is_file():
        revisar("appsscript.json presente", False, "no está")
    else:
        try:
            m = json.loads(man.read_text(encoding="utf-8"))
            revisar("appsscript.json válido", True,
                    f"{len(m.get('oauthScopes', []))} permisos · "
                    f"{m.get('runtimeVersion', '?')} · {m.get('timeZone', '?')}")
        except json.JSONDecodeError as e:
            revisar("appsscript.json válido", False, str(e))

    # ── datos de un despliegue concreto ─────────────────────────────────────
    # "Cero hardcoding" es una regla que se rompe sola: alguien deja un correo
    # real en una prueba, o el identificador del Sheet de producción en un
    # comentario, y eso viaja al repositorio. Esto lo busca.
    reales, ids = set(), set()
    for f in gs + html:
        texto = f.read_text(encoding="utf-8")
        for e in CORREO.findall(texto):
            if e.split("@")[1].lower() not in DOMINIOS_EJEMPLO:
                reales.add(f"{f.name}: {e}")
        for i in ID_GOOGLE.findall(texto):
            ids.add(f"{f.name}: {i[:12]}…")
    revisar("Sin correos fuera de los de ejemplo", not reales,
            ", ".join(sorted(reales)[:3]) if reales else
            f"dominios permitidos: {', '.join(sorted(DOMINIOS_EJEMPLO))}")
    revisar("Sin identificadores de Sheets o Drive en el código", not ids,
            ", ".join(sorted(ids)[:3]) if ids else "limpio")

    # ── pruebas de lógica ───────────────────────────────────────────────────
    pruebas = Path(__file__).with_name("pruebas_logica.js")
    if not tiene_node:
        revisar("Pruebas de lógica", True, "omitidas: node no está instalado", critico=False)
    elif pruebas.is_file():
        r = subprocess.run(["node", str(pruebas), str(raiz)], capture_output=True, text=True)
        resumen = next((l.strip() for l in reversed(r.stdout.splitlines()) if "pruebas pasan" in l),
                       (r.stderr.strip().splitlines() or ["sin salida"])[-1])
        revisar("Pruebas de lógica (pruebas_logica.js)", r.returncode == 0, resumen)
        for l in r.stdout.splitlines():
            if "[FALLA]" in l:
                print("        · " + l.strip().replace("[FALLA] ", ""))

    print("\n" + "  " + "─" * 56)
    print(f"  {len(fallos)} chequeos en falla\n")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
