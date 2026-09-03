import './env.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { query, cerrarPool } from './db.js'

// MySQL 8 no soporta ADD COLUMN IF NOT EXISTS y schema.sql se ejecuta entero en cada arranque:
// los ALTER que agregan columnas o indices ya aplicados vuelven a correr y fallan. Solo en ALTER
// se tolera "ya existe" / "no existe"; en CREATE TABLE y demas cualquier error sigue siendo fatal.
const CODIGOS_ALTER_TOLERADOS = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY'])
const ERRNOS_ALTER_TOLERADOS = new Set([1060, 1061, 1091])

function esAlterYaAplicado(sentencia, error) {
  if (!/^ALTER\b/i.test(sentencia)) return false

  return CODIGOS_ALTER_TOLERADOS.has(error?.code) || ERRNOS_ALTER_TOLERADOS.has(error?.errno)
}

export async function ejecutarMigracion() {
  const rutaSchema = fileURLToPath(new URL('./schema.sql', import.meta.url))
  const contenido = await readFile(rutaSchema, 'utf8')

  const sentencias = contenido
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const sentencia of sentencias) {
    try {
      await query(sentencia)
    } catch (error) {
      if (!esAlterYaAplicado(sentencia, error)) throw error
    }
  }

  console.log('Schema listo')
}

// Detecta ejecucion directa (node src/migrate.js) vs. import desde server.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await ejecutarMigracion()
    await cerrarPool()
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
