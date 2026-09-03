import { obtenerLlamada } from './client.js'
import { extraerResumenDeArtifact, extraerResumenEstructurado } from './normalize.js'
import { actualizarResumen } from '../repository/llamadas.js'

// Vapi procesa el structured output de forma asincrona y NO dispara un webhook cuando termina,
// asi que hay que ir a buscarlo. Tres intentos (15s, 30s, 45s) y se abandona: el resumen no es
// critico y un reintento infinito dejaria timers colgados por cada llamada que nunca lo genere.
// Configurable para poder testear el retry sin esperar 30s reales, y por si 15s se quedan cortos
const ESPERA_MS = Number(process.env.RESUMEN_ESPERA_MS) || 15_000
const MAX_INTENTOS = 3

export function programarBusquedaDeResumen(callId, log) {
  if (!process.env.VAPI_API_KEY) {
    log.warn({ call_id: callId }, 'Sin VAPI_API_KEY: no se buscara el resumen')
    return
  }

  agendarIntento(callId, 1, log)
}

function agendarIntento(callId, intento, log) {
  // unref: un resumen pendiente no debe impedir que el proceso termine (scripts, redeploys de Railway)
  setTimeout(() => buscarResumen(callId, intento, log), ESPERA_MS).unref()
}

async function buscarResumen(callId, intento, log) {
  try {
    const call = await obtenerLlamada(callId)
    const resumen = extraerResumenDeArtifact(call?.artifact) ?? extraerResumenEstructurado(call?.analysis)

    if (resumen) {
      await actualizarResumen(callId, resumen)
      log.info({ call_id: callId, intento }, 'Resumen encontrado y guardado')
      return
    }

    if (intento < MAX_INTENTOS) {
      log.info({ call_id: callId, intento }, 'Resumen aun no listo, se reintenta')
      agendarIntento(callId, intento + 1, log)
      return
    }

    log.warn({ call_id: callId }, `Sin resumen tras ${MAX_INTENTOS} intentos, queda NULL`)
  } catch (error) {
    // Nadie hace await de esta funcion: si la excepcion escapa, tumba el proceso. Y el resumen
    // no justifica eso, asi que se loguea y se reintenta si quedan intentos.
    log.error({ call_id: callId, intento, err: error.message }, 'Error buscando el resumen en Vapi')

    if (intento < MAX_INTENTOS) {
      agendarIntento(callId, intento + 1, log)
    }
  }
}
