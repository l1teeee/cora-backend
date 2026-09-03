import '../src/env.js'
import { readFile } from 'node:fs/promises'
import { normalizarDesdeWebhook } from '../src/vapi/normalize.js'
import { guardarLlamada, listarLlamadas } from '../src/repository/llamadas.js'
import { query, cerrarPool } from '../src/db.js'

const CALL_ID = 'b7f2c1a4-9d3e-4c88-a1f5-demo00000001'
const leer = async (f) => JSON.parse(await readFile(f, 'utf8'))
const fila = () => query('SELECT * FROM llamadas WHERE call_id = ?', [CALL_ID]).then(r => r[0])

let fallos = 0
const check = (nombre, ok, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'FALLA'}  ${nombre}${extra ? '  -> ' + extra : ''}`)
  if (!ok) fallos++
}

await query('DELETE FROM llamadas WHERE call_id = ?', [CALL_ID])

// --- 1er webhook: llamada completa, analysis vacio ---
const p1 = await leer(new URL('./payload-ejemplo.json', import.meta.url))
const n1 = normalizarDesdeWebhook(p1.message)
console.log('\n--- normalizado (webhook 1) ---')
console.log(JSON.stringify({ ...n1, transcripcion: n1.transcripcion?.slice(0, 90) + '...' }, null, 2))

check('call_id extraido', n1.call_id === CALL_ID, n1.call_id)
check('fecha en formato MySQL', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(n1.fecha || ''), n1.fecha)
check('duracion en segundos', n1.duracion === 74, String(n1.duracion))
check('costo', Number(n1.costo) === 0.0912, String(n1.costo))
check('transcripcion construida desde messages', !!n1.transcripcion && n1.transcripcion.includes('USUARIO:') && n1.transcripcion.includes('ASISTENTE:'))
check('transcripcion excluye el rol system', !n1.transcripcion?.includes('SYSTEM'))
check('resumen es null con analysis vacio', n1.resumen === null, String(n1.resumen))
check('numero_telefono', n1.numero_telefono === '+50371234567', n1.numero_telefono)
check('url_grabacion', !!n1.url_grabacion)
check('razon_finalizacion', n1.razon_finalizacion === 'customer-ended-call', n1.razon_finalizacion)

const r1 = await guardarLlamada(n1)
check('primer guardado = INSERT', r1.insertada === true)
const f1 = await fila()
const transcripcionOriginal = f1.transcripcion

// --- 2do webhook: mismo call_id, solo analysis, sin messages ---
const p2 = await leer(new URL('./payload-resumen.json', import.meta.url))
const n2 = normalizarDesdeWebhook(p2.message)
console.log('\n--- normalizado (webhook 2, el del resumen) ---')
console.log(JSON.stringify(n2, null, 2))

check('mismo call_id', n2.call_id === CALL_ID)
check('resumen extraido del analysis', !!n2.resumen)
check('transcripcion null (no venia en el payload)', n2.transcripcion === null)

const r2 = await guardarLlamada(n2)
check('segundo guardado = UPDATE, no INSERT', r2.insertada === false)

const f2 = await fila()
console.log('\n--- fila final en MySQL ---')
console.log(JSON.stringify({ ...f2, transcripcion: f2.transcripcion?.slice(0, 70) + '...' }, null, 2))

check('>>> LA TRANSCRIPCION SOBREVIVIO AL 2do WEBHOOK', f2.transcripcion === transcripcionOriginal)
check('>>> EL RESUMEN SE AGREGO', !!f2.resumen)
check('duracion no se perdio', f2.duracion === 74)
check('costo no se perdio', Number(f2.costo) === 0.0912)
check('numero no se perdio', f2.numero_telefono === '+50371234567')
check('url_grabacion no se perdio', !!f2.url_grabacion)
check('una sola fila para ese call_id', (await query('SELECT COUNT(*) c FROM llamadas WHERE call_id=?', [CALL_ID]))[0].c === 1)

// --- listado paginado ---
const listado = await listarLlamadas({ page: 1, limit: 10 })
check('listado devuelve data + paginacion', Array.isArray(listado.data) && !!listado.paginacion)
check('listado NO incluye transcripcion', !('transcripcion' in (listado.data[0] || {})))
check('limit se capa en 100', (await listarLlamadas({ page: 1, limit: 5000 })).paginacion.limit === 100)

console.log(`\n${fallos === 0 ? 'TODO VERDE' : fallos + ' FALLAS'}`)
await cerrarPool()
process.exit(fallos === 0 ? 0 : 1)
