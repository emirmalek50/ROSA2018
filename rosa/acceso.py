"""Acceso corporativo con contraseña y sesión revocable.

Dos clases de cuenta, las dos del dominio @alzheimerproject.com:

- La cuenta administradora, fijada en ``.env`` (abajo). Entra siempre y es la
  que aprueba a las demás.
- Las del equipo (25 de septiembre de 2026, a petición de Emir): cualquiera con
  un correo @alzheimerproject.com se registra con su contraseña, y la cuenta queda
  PENDIENTE hasta que la cuenta administradora la aprueba con un botón. Sin esa
  aprobación, cualquiera que llegara a la pantalla podría registrarse con el
  correo de otra persona del equipo, que es justo el agujero que se cerró el 18
  de septiembre al retirar la entrada sin verificar. Cuando esta instalación tenga
  el correo conectado, la aprobación se podrá sustituir por un enlace al buzón
  (`solicitar` y `confirmar` siguen aquí para eso).

Solo se persisten hashes de las sesiones. La contraseña de la cuenta
administradora se compara con una huella scrypt configurada fuera del
repositorio, en ``.env``::

    ROSA_LOGIN_EMAIL=persona@alzheimerproject.com
    ROSA_LOGIN_PASSWORD_HASH=<64 caracteres hexadecimales>
    ROSA_ADMIN=persona@alzheimerproject.com   (opcional)

La huella se genera con ``python -m rosa.acceso --huella``: pide la contraseña
sin mostrarla y escribe la línea para ``.env``. ``python -m rosa.acceso
--comprobar`` dice si lo que hay en ``.env`` sirve, sin imprimir valores.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sys
import time

from rosa import config
from rosa.correo import direccion

COOKIE = "rosa_sesion"
DURACION = 12 * 3600
DOMINIO = "alzheimerproject.com"
_SAL_CONTRASENA = b"rosa-acceso-contrasena-v1"
# Lo que recibe quien llama a la puerta sin verificación (cerrada el 18 de
# septiembre de 2026 al llegar la contraseña): que ya no existe y cómo entrar.
# El servidor lo devuelve tal cual con 410 Gone. No promete entrada a cualquier
# cuenta del dominio: solo entra la que reparte quien administra.
MENSAJE_PUERTA_CERRADA = (
    "La entrada sin verificación está desactivada y ya no existe. Entra en la pantalla de acceso con el "
    "correo y la contraseña que te haya dado quien administra ROSA2018."
)
# Lo que recibe quien intenta entrar cuando .env no tiene credenciales válidas:
# no hay con qué comparar, así que no es "contraseña incorrecta" ni gasta intentos.
MENSAJE_SIN_CONFIGURAR = (
    "El acceso con contraseña de ROSA2018 no está configurado en este servidor; avisa a quien lo administra."
)


# Contraseñas de las cuentas del equipo: más largas que la de la cuenta
# administradora, porque se eligen desde una pantalla abierta.
MIN_CONTRASENA_EQUIPO = 10
ESTADOS_CUENTA = ("pendiente", "activa", "rechazada")
MENSAJE_PENDIENTE = "Tu cuenta está pendiente de aprobación. Avisa a quien administra ROSA2018 para que la apruebe."
MENSAJE_RECHAZADA = "Esta solicitud de acceso fue rechazada. Habla con quien administra ROSA2018."


def huella(token):
    return hashlib.sha256(token.encode()).hexdigest()


def huella_equipo(contrasena, sal=None):
    """La huella de la contraseña de una cuenta del equipo: scrypt con sal propia
    por cuenta, guardada como `scrypt$<sal>$<huella>`. Cadena vacía si la
    contraseña no es válida."""
    if not isinstance(contrasena, str) or not 1 <= len(contrasena) <= 256:
        return ""
    sal = sal if sal is not None else secrets.token_bytes(16)
    return "scrypt$" + sal.hex() + "$" + hashlib.scrypt(contrasena.encode("utf-8"), salt=sal, n=2**14, r=8, p=1, dklen=32).hex()


def _coincide_equipo(contrasena, guardada):
    """Si la contraseña coincide con la huella guardada, en tiempo constante."""
    try:
        _, sal_hex, _ = str(guardada or "").split("$", 2)
        sal = bytes.fromhex(sal_hex)
    except ValueError:
        return False
    calculada = huella_equipo(contrasena, sal)
    return bool(calculada) and secrets.compare_digest(calculada.encode("ascii"), str(guardada).encode("ascii"))


def correo_admin():
    """La cuenta administradora fijada por configuración (ROSA_ADMIN), en
    minúsculas, o cadena vacía. Se lee de `config` si ya la expone y, si no,
    del entorno."""
    valor = getattr(config, "ROSA_ADMIN", None)
    if valor is None:
        valor = os.environ.get("ROSA_ADMIN", "")
    return str(valor or "").strip().lower()


def _leer_credenciales():
    email = str(getattr(config, "ROSA_LOGIN_EMAIL", "") or "").strip().lower()
    huella_configurada = str(getattr(config, "ROSA_LOGIN_PASSWORD_HASH", "") or "").strip().lower()
    return email, huella_configurada


def _es_hexadecimal(texto):
    try:
        bytes.fromhex(texto)
    except ValueError:
        return False
    return True


def diagnostico_credenciales():
    """Qué falla en ROSA_LOGIN_EMAIL y ROSA_LOGIN_PASSWORD_HASH, o cadena vacía
    si el acceso con contraseña está bien configurado.

    Nunca incluye los valores: se imprime al arrancar y lo lee quien opera el
    servidor. Es la única regla de validez; `_credenciales_configuradas` la
    aplica al entrar y `es_admin` al decidir quién administra.
    """
    email, huella_configurada = _leer_credenciales()
    fallos = []
    if not email:
        fallos.append("falta ROSA_LOGIN_EMAIL")
    else:
        try:
            # `direccion` solo admite ASCII: un correo con tilde o ñ no pasa, y así
            # la comparación de abajo nunca revienta con TypeError.
            if direccion(email).rsplit("@", 1)[1] != DOMINIO:
                raise ValueError("fuera del dominio")
        except ValueError:
            fallos.append(f"ROSA_LOGIN_EMAIL no es una dirección @{DOMINIO} válida (sin tildes, ñ ni espacios)")
    if not huella_configurada:
        fallos.append("falta ROSA_LOGIN_PASSWORD_HASH")
    elif len(huella_configurada) != 64 or not _es_hexadecimal(huella_configurada):
        fallos.append(
            f"ROSA_LOGIN_PASSWORD_HASH no es una huella de 64 caracteres hexadecimales (tiene {len(huella_configurada)}); "
            "genérala con python -m rosa.acceso --huella"
        )
    return "; ".join(fallos)


def _credenciales_configuradas():
    """Devuelve el correo y huella configurados, o dos cadenas vacías.

    Se acepta solo una huella scrypt de 32 bytes en hexadecimal y un correo
    ASCII del dominio. Así, un .env incompleto o mal pegado no abre por
    accidente una ruta de autenticación débil ni se disfraza de contraseña
    errónea.
    """
    if diagnostico_credenciales():
        return "", ""
    return _leer_credenciales()


def _huella_contrasena(contrasena):
    if not isinstance(contrasena, str) or not 1 <= len(contrasena) <= 256:
        return ""
    return hashlib.scrypt(contrasena.encode("utf-8"), salt=_SAL_CONTRASENA, n=2**14, r=8, p=1, dklen=32).hex()


class Acceso:
    def __init__(self, correo):
        self.correo = correo
        self.db = correo.db
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS cuentas (correo TEXT PRIMARY KEY, creada REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS enlaces (hash TEXT PRIMARY KEY, correo TEXT NOT NULL, vence REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sesiones (hash TEXT PRIMARY KEY, correo TEXT NOT NULL, vence REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS limites_acceso (correo TEXT NOT NULL, ip TEXT NOT NULL, t REAL NOT NULL);
        """)
        # Cuándo se confirmó la cuenta (por enlace o por contraseña); NULL si
        # entró por la puerta antigua sin verificar.
        columnas = {fila[1] for fila in self.db.execute("PRAGMA table_info(cuentas)")}
        if "verificada" not in columnas:
            with self.db:
                self.db.execute("ALTER TABLE cuentas ADD COLUMN verificada REAL")
        # Las cuentas del equipo (25 de septiembre de 2026): su contraseña, su estado
        # y quién la aprobó. Las filas antiguas quedan con estado NULL: no son del
        # registro, así que no entran por él.
        for columna, tipo in (("contrasena", "TEXT"), ("estado", "TEXT"), ("aprobadaPor", "TEXT"), ("aprobadaEn", "REAL")):
            if columna not in columnas:
                with self.db:
                    self.db.execute(f"ALTER TABLE cuentas ADD COLUMN {columna} {tipo}")

    def _dominio_corporativo(self, email):
        email = direccion(email.strip().lower())
        if email.rsplit("@", 1)[1] != DOMINIO:
            raise ValueError(f"Solo se admiten cuentas @{DOMINIO}")
        return email

    def _limitar_y_purgar(self, email, ip, ahora):
        """Purga enlaces y sesiones caducados y aplica los topes de intentos (3
        por correo en 15 minutos, 20 por IP y 100 en total por hora). Lo
        comparten `solicitar` y `entrar_con_contrasena`. Debe llamarse dentro de
        una transacción abierta."""
        self.db.execute("DELETE FROM limites_acceso WHERE t<?", (ahora - 3600,))
        self.db.execute("DELETE FROM enlaces WHERE vence<?", (ahora,))
        self.db.execute("DELETE FROM sesiones WHERE vence<?", (ahora,))
        cuenta = self.db.execute("SELECT COUNT(*) FROM limites_acceso WHERE correo=? AND t>?", (email, ahora - 900)).fetchone()[0]
        desde_ip = self.db.execute("SELECT COUNT(*) FROM limites_acceso WHERE ip=?", (ip,)).fetchone()[0]
        total = self.db.execute("SELECT COUNT(*) FROM limites_acceso").fetchone()[0]
        if cuenta >= 3 or desde_ip >= 20 or total >= 100:
            raise ValueError("Demasiados intentos. Espera unos minutos antes de volver a intentarlo")
        self.db.execute("INSERT INTO limites_acceso VALUES (?,?,?)", (email, ip, ahora))

    def solicitar(self, email, ip):
        """Enlace de un solo uso por correo. Desde el 18 de septiembre de 2026 no
        es una vía de entrada desde la web (el servidor no expone la ruta); la
        clase lo conserva para el día que vuelva el enlace."""
        email = self._dominio_corporativo(email)
        c = self.correo._config()
        if not c["clave"] or not c["remitente"]:
            raise ValueError("El administrador debe conectar el servicio de correo antes de iniciar sesión")
        ahora = time.time()
        with self.db:
            self._limitar_y_purgar(email, ip, ahora)
            token = secrets.token_urlsafe(32)
            self.db.execute("INSERT INTO enlaces VALUES (?,?,?)", (huella(token), email, ahora + 900))
            self.correo._encolar("acceso", email,
                "Confirma tu acceso a ROSA2018 con este enlace de un solo uso (caduca en 15 minutos):\n\n"
                + c["url"].rstrip("/") + "/#acceso=" + token + "\n\n"
                "Si no lo has solicitado, no abras el enlace. Nadie puede entrar sin confirmar tu correo.", ahora)

    def registrar(self, email, contrasena, ip="desconocida"):
        """Una persona con correo @alzheimerproject.com pide una cuenta. Queda
        pendiente hasta que la cuenta administradora la aprueba; hasta entonces no
        entra. Devuelve el estado.

        No se puede pisar una solicitud pendiente con otra contraseña: si alguien
        se adelantara a la persona real, la administradora vería la solicitud y no
        la aprobaría sin preguntar, pero si se pudiera sobrescribir, el que llegara
        el último decidiría la contraseña de una cuenta que otro pidió."""
        email = self._dominio_corporativo(email)
        if not isinstance(contrasena, str) or not MIN_CONTRASENA_EQUIPO <= len(contrasena) <= 256:
            raise ValueError(f"La contraseña debe tener al menos {MIN_CONTRASENA_EQUIPO} caracteres")
        configurado, _ = _credenciales_configuradas()
        if configurado and email == configurado:
            raise ValueError("Esa cuenta ya existe: entra con tu contraseña")
        ahora = time.time()
        # El intento se confirma en su propia transacción, como al entrar: si
        # compartiera la del error de abajo, el rollback lo borraría y el tope no
        # frenaría a quien prueba correos en bucle.
        with self.db:
            self._limitar_y_purgar(email, ip, ahora)
        fila = self.db.execute("SELECT estado, contrasena FROM cuentas WHERE correo=?", (email,)).fetchone()
        if fila and fila[0] == "activa":
            raise ValueError("Ese correo ya tiene cuenta: entra con tu contraseña")
        if fila and fila[0] == "pendiente":
            raise ValueError("Ya hay una solicitud pendiente para ese correo. Espera a que la aprueben")
        if fila and fila[0] == "rechazada":
            raise ValueError(MENSAJE_RECHAZADA)
        guardada = huella_equipo(contrasena)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO cuentas(correo, creada) VALUES (?,?)", (email, ahora))
            self.db.execute("UPDATE cuentas SET contrasena=?, estado='pendiente', creada=? WHERE correo=?", (guardada, ahora, email))
            # Registrarse bien no es un intento sospechoso, como acertar al entrar: si
            # contara, quien se registra y luego se equivoca una vez al teclear se
            # quedaría fuera quince minutos.
            self.db.execute("DELETE FROM limites_acceso WHERE correo=?", (email,))
        return "pendiente"

    def solicitudes(self):
        """Las cuentas del equipo, para la pantalla de la administradora: las
        pendientes primero, y de cada una solo el correo, cuándo se pidió y quién la
        aprobó. Nunca la huella de la contraseña."""
        filas = self.db.execute("SELECT correo, estado, creada, aprobadaPor, aprobadaEn FROM cuentas WHERE estado IS NOT NULL ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'activa' THEN 1 ELSE 2 END, creada").fetchall()
        return [{"correo": c, "estado": e, "creada": int(cr * 1000), "aprobadaPor": ap, "aprobadaEn": int(ae * 1000) if ae else None} for c, e, cr, ap, ae in filas]

    def decidir_cuenta(self, email, estado, quien):
        """La administradora aprueba o rechaza una cuenta del equipo. Rechazar una
        cuenta activa la deja sin acceso y cierra sus sesiones abiertas."""
        if estado not in ("activa", "rechazada"):
            raise ValueError("Solo se puede aprobar o rechazar")
        email = str(email or "").strip().lower()
        with self.db:
            fila = self.db.execute("SELECT estado FROM cuentas WHERE correo=? AND estado IS NOT NULL", (email,)).fetchone()
            if not fila:
                raise ValueError("No hay ninguna solicitud con ese correo")
            self.db.execute("UPDATE cuentas SET estado=?, aprobadaPor=?, aprobadaEn=? WHERE correo=?", (estado, str(quien or "")[:200], time.time(), email))
            if estado == "rechazada":
                self.db.execute("DELETE FROM sesiones WHERE correo=?", (email,))
        return estado

    def entrar_con_contrasena(self, email, contrasena, ip="desconocida"):
        """Crea una sesión solo si coincide la cuenta corporativa configurada.

        El mismo mensaje se usa para correo y contraseña incorrectos para no
        revelar qué cuentas existen. Sin credenciales válidas en .env se dice
        que el acceso no está configurado, sin gastar intentos: no hay con qué
        comparar. Los límites se aplican antes de comparar la huella para
        contener intentos automatizados, y se confirman en su propia
        transacción: si el intento se registrara en la misma que lanza el
        error, el rollback lo borraría y los fallos no contarían para el tope.
        Acertar borra los intentos del correo: el tope frena fallos, no aciertos.
        """
        email = self._dominio_corporativo(email)
        configurado, esperada = _credenciales_configuradas()
        fila = self.db.execute("SELECT contrasena, estado FROM cuentas WHERE correo=? AND contrasena IS NOT NULL", (email,)).fetchone()
        if not configurado and not fila:
            raise ValueError(MENSAJE_SIN_CONFIGURAR)
        ahora = time.time()
        with self.db:
            self._limitar_y_purgar(email, ip, ahora)
        if configurado and secrets.compare_digest(email.encode("utf-8"), configurado.encode("utf-8")):
            # La cuenta administradora, con la huella de .env.
            recibida = _huella_contrasena(contrasena)
            # Se comparan bytes: `compare_digest` sobre str lanza TypeError si algún
            # carácter no es ASCII.
            acierta = bool(recibida) and secrets.compare_digest(recibida.encode("ascii"), esperada.encode("ascii"))
            estado = "activa"
        elif fila:
            # Una cuenta del equipo. El estado solo se revela a quien acierta la
            # contraseña: a los demás, el mismo mensaje que a un correo sin cuenta.
            acierta = _coincide_equipo(contrasena, fila[0])
            estado = fila[1]
        else:
            # Sin cuenta: se calcula una huella igual para no revelar por el tiempo
            # de respuesta qué correos tienen cuenta.
            huella_equipo(contrasena if isinstance(contrasena, str) and contrasena else "x")
            acierta, estado = False, None
        if not acierta:
            raise ValueError("Correo o contraseña incorrectos")
        if estado == "pendiente":
            raise ValueError(MENSAJE_PENDIENTE)
        if estado != "activa":
            raise ValueError(MENSAJE_RECHAZADA)
        with self.db:
            self.db.execute("DELETE FROM limites_acceso WHERE correo=?", (email,))
            self.db.execute("INSERT OR IGNORE INTO cuentas(correo, creada) VALUES (?,?)", (email, ahora))
            self.db.execute("UPDATE cuentas SET verificada=COALESCE(verificada, ?) WHERE correo=?", (ahora, email))
            sesion = secrets.token_urlsafe(32)
            self.db.execute("INSERT INTO sesiones VALUES (?,?,?)", (huella(sesion), email, ahora + DURACION))
        return sesion, email

    def confirmar(self, token):
        """Canjea un enlace de `solicitar`. Ver la nota de `solicitar`: la web ya
        no lo expone."""
        if not isinstance(token, str) or not 30 <= len(token) <= 100:
            raise ValueError("Enlace inválido o caducado; solicita otro")
        ahora = time.time()
        with self.db:
            fila = self.db.execute("DELETE FROM enlaces WHERE hash=? AND vence>? RETURNING correo", (huella(token), ahora)).fetchone()
            if not fila:
                raise ValueError("Enlace inválido, ya utilizado o caducado; solicita otro")
            email = fila[0]
            self.db.execute("INSERT OR IGNORE INTO cuentas(correo, creada) VALUES (?,?)", (email, ahora))
            self.db.execute("UPDATE cuentas SET verificada=COALESCE(verificada, ?) WHERE correo=?", (ahora, email))
            self.db.execute("DELETE FROM enlaces WHERE correo=?", (email,))
            sesion = secrets.token_urlsafe(32)
            self.db.execute("INSERT INTO sesiones VALUES (?,?,?)", (huella(sesion), email, ahora + DURACION))
        return sesion, email

    def entrar_sin_verificar(self, email, ip="desconocida"):
        """La puerta abierta al dominio del 15 de septiembre de 2026 quedó cerrada
        el 18 al llegar la contraseña. Se conserva el nombre para que un llamador
        antiguo reciba la explicación; no crea cuenta ni sesión ni consume intentos."""
        raise ValueError(MENSAJE_PUERTA_CERRADA)

    def es_admin(self, email):
        """Administra la cuenta de ROSA_ADMIN. Sin ROSA_ADMIN, la cuenta de
        ROSA_LOGIN_EMAIL, que es la única que puede entrar; solo si tampoco hay
        credenciales válidas, la primera confirmada por enlace. Nunca una que
        entró por la puerta antigua sin verificar (verificada NULL), ni una que
        confirmó un enlace antes del 18 de septiembre de 2026 y ya no puede
        entrar."""
        if not email:
            return False
        email = str(email).strip().lower()
        fijado = correo_admin()
        if fijado:
            return email == fijado
        configurado, _ = _credenciales_configuradas()
        if configurado:
            return email == configurado
        fila = self.db.execute("SELECT correo FROM cuentas WHERE verificada IS NOT NULL ORDER BY verificada, rowid LIMIT 1").fetchone()
        return bool(fila and fila[0] == email)

    def usuario(self, token):
        if not token or len(token) > 100:
            return None
        fila = self.db.execute("SELECT correo FROM sesiones WHERE hash=? AND vence>?", (huella(token), time.time())).fetchone()
        return fila[0] if fila else None

    def salir(self, token):
        with self.db:
            self.db.execute("DELETE FROM sesiones WHERE hash=?", (huella(token or ""),))


def _principal(argv, pedir=None, salida=None, errores=None):
    """`python -m rosa.acceso --huella` genera la línea de .env sin mostrar la
    contraseña; `--comprobar` dice si las credenciales de .env sirven."""
    import argparse
    import getpass

    pedir = pedir or getpass.getpass
    salida = salida or sys.stdout
    errores = errores or sys.stderr
    parser = argparse.ArgumentParser(prog="python -m rosa.acceso", description="Credenciales de acceso de ROSA2018 para .env")
    parser.add_argument("--huella", action="store_true", help="pide la contraseña sin mostrarla y escribe la línea ROSA_LOGIN_PASSWORD_HASH=... para .env")
    parser.add_argument("--comprobar", action="store_true", help="dice si ROSA_LOGIN_EMAIL y ROSA_LOGIN_PASSWORD_HASH de .env sirven, sin mostrar valores")
    args = parser.parse_args(argv)
    if args.huella:
        una = pedir("Contraseña de acceso a ROSA2018 (no se muestra): ")
        dos = pedir("Repítela: ")
        if una != dos:
            print("Las dos contraseñas no coinciden; no se ha generado nada.", file=errores)
            return 2
        generada = _huella_contrasena(una)
        if not generada:
            print("La contraseña debe tener entre 1 y 256 caracteres.", file=errores)
            return 2
        print(f"ROSA_LOGIN_PASSWORD_HASH={generada}", file=salida)
        print(f"Pega esa línea en .env junto a ROSA_LOGIN_EMAIL=<cuenta @{DOMINIO}> y reinicia ROSA2018.", file=errores)
        return 0
    if args.comprobar:
        problema = diagnostico_credenciales()
        print("El acceso con contraseña está bien configurado." if not problema else f"El acceso con contraseña no está configurado: {problema}.", file=salida)
        return 0 if not problema else 1
    parser.print_help(salida)
    return 2


if __name__ == "__main__":
    raise SystemExit(_principal(sys.argv[1:]))
