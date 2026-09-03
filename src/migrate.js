import './env.js'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { query, cerrarPool } from './db.js'

export async function ejecutarMigracion() {
  const rutaSchema = fileURLToPath(new URL('./schema.sql', import.meta.url))
  const contenido = await readFile(rutaSchema, 'utf8')

  const sentencias = contenido
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const sentencia of sentencias) {
    await query(sentencia)
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
