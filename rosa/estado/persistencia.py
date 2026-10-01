"""Estado por claves: solo se escriben las partes que cambiaron.

La vista `estado` conserva la lectura SQL anterior. Sus triggers permiten
importaciones completas; un servidor antiguo obtiene rowcount=0 al actualizar
la vista y revierte por su control de versión, sin sobrescribir datos.
La migración es transaccional y no cambia el JSON público ni la auditoría.
"""
from __future__ import annotations

import sqlite3


def preparar(con: sqlite3.Connection) -> None:
    tipo = con.execute("SELECT type FROM sqlite_master WHERE name='estado'").fetchone()
    if tipo and tipo[0] == "view":
        return
    # json_each.value devuelve SQL escalar para primitivas y JSON para objetos.
    valor = "CASE type WHEN 'text' THEN json_quote(value) WHEN 'null' THEN 'null' WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(value AS TEXT) END"
    con.executescript(f"""
BEGIN IMMEDIATE;
CREATE TABLE estado_meta (clave TEXT PRIMARY KEY, version INTEGER NOT NULL, actualizado_en INTEGER NOT NULL);
CREATE TABLE estado_partes (estado TEXT NOT NULL, clave TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(estado, clave));
INSERT INTO estado_meta SELECT clave, version, actualizado_en FROM estado;
INSERT INTO estado_partes SELECT estado.clave, j.key, {valor} FROM estado, json_each(estado.json) AS j;
DROP TABLE estado;
CREATE VIEW estado AS SELECT m.clave, m.version,
  COALESCE((SELECT '{{' || group_concat(json_quote(p.clave) || ':' || p.json, ',') || '}}'
    FROM estado_partes AS p WHERE p.estado=m.clave), '{{}}') AS json,
  m.actualizado_en FROM estado_meta AS m;
CREATE TRIGGER estado_insertar INSTEAD OF INSERT ON estado BEGIN
  INSERT INTO estado_meta VALUES (NEW.clave, NEW.version, NEW.actualizado_en);
  INSERT INTO estado_partes SELECT NEW.clave, key, {valor} FROM json_each(NEW.json);
END;
CREATE TRIGGER estado_actualizar INSTEAD OF UPDATE ON estado BEGIN
  UPDATE estado_meta SET version=NEW.version, actualizado_en=NEW.actualizado_en WHERE clave=OLD.clave;
  DELETE FROM estado_partes WHERE estado=OLD.clave;
  INSERT INTO estado_partes SELECT NEW.clave, key, {valor} FROM json_each(NEW.json);
END;
COMMIT;
""")
