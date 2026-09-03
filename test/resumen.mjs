// Verifica el polling del structured output sin tocar la API real de Vapi: se stubea fetch.
import '../src/env.js'
process.env.VAPI_API_KEY = 'key-de-prueba'
process.env.RESUMEN_ESPERA_MS = '80'

const { programarBusquedaDeResumen } = await import('../src/vapi/resumen-pendiente.js')
const { query, cerrarPool } = await import('../src/db.js')

const CALL_ID = 'test-resumen-polling'
const log = { info(){}, warn(){}, error(){} }
const esperar = (ms) => new Promise(r => setTimeout(r, ms))

let fallos = 0
const check = (n, ok, extra='') => { console.log(`${ok?'OK  ':'FALLA'}  ${n}${extra?'  -> '+extra:''}`); if(!ok) fallos++ }

// respuestas: lista de lo que devuelve analysis en cada llamada; 'error' lanza
function stubFetch(respuestas) {
  let i = 0
  globalThis.fetch = async (url) => {
    const actual = respuestas[Math.min(i, respuestas.length - 1)]
    i++
    if (actual === 'error') return { ok: false, status: 500, text: async () => 'boom' }
    return { ok: true, json: async () => ({ id: CALL_ID, analysis: actual }) }
  }
  return () => i
}

async function escenario(nombre, respuestas, esperado, msEspera) {
  await query('DELETE FROM llamadas WHERE call_id = ?', [CALL_ID])
  await query('INSERT INTO llamadas (call_id, transcripcion) VALUES (?, ?)', [CALL_ID, 'USUARIO: hola'])
  const llamadas = stubFetch(respuestas)
  programarBusquedaDeResumen(CALL_ID, log)
  await esperar(msEspera)
  const fila = (await query('SELECT resumen, transcripcion FROM llamadas WHERE call_id = ?', [CALL_ID]))[0]
  check(nombre, fila.resumen === esperado, `resumen=${JSON.stringify(fila.resumen)} intentos=${llamadas()}`)
  check(`  ${nombre}: transcripcion intacta`, fila.transcripcion === 'USUARIO: hola')
  return llamadas()
}

const listo = { structuredData: { resumen_llamada: 'Consulta sobre inscripciones, resuelta.' } }

await escenario('resumen listo al 1er intento', [listo], 'Consulta sobre inscripciones, resuelta.', 250)
await escenario('vacio al 1ro, listo al 2do', [{}, listo], 'Consulta sobre inscripciones, resuelta.', 350)
const n1 = await escenario('nunca listo -> queda NULL', [{}], null, 400)
check('nunca listo: exactamente 2 intentos, no mas', n1 === 2, `intentos=${n1}`)
const n2 = await escenario('la API falla -> no rompe, reintenta', ['error'], null, 400)
check('API falla: exactamente 2 intentos', n2 === 2, `intentos=${n2}`)

// prioridad del structured output sobre el summary generico
await escenario('prioriza resumen_llamada sobre analysis.summary',
  [{ summary: 'generico de vapi', structuredData: { resumen_llamada: 'el bueno' } }], 'el bueno', 250)
await escenario('usa analysis.summary si no hay structured output',
  [{ summary: 'generico de vapi' }], 'generico de vapi', 250)

await query('DELETE FROM llamadas WHERE call_id = ?', [CALL_ID])
console.log(`\n${fallos === 0 ? 'TODO VERDE' : fallos + ' FALLAS'}`)
await cerrarPool()
process.exit(fallos === 0 ? 0 : 1)
