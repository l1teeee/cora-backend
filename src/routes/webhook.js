import { comparaSecreto, enProduccion } from '../auth.js'
import { normalizarDesdeWebhook } from '../vapi/normalize.js'
import { guardarLlamada } from '../repository/llamadas.js'

export default async function (fastify, opts) {
  const secret = process.env.VAPI_SERVER_SECRET

  // Sin secret el endpoint es abierto: tolerable en local para probar con curl, nunca desplegado.
  // Fail closed en Railway: mejor un webhook que responde 503 que uno que acepta llamadas falsas.
  if (!secret && enProduccion) {
    fastify.log.error('VAPI_SERVER_SECRET no definido en produccion: /webhook/vapi respondera 503')
  } else if (!secret) {
    fastify.log.warn('VAPI_SERVER_SECRET no definido: el webhook acepta cualquier peticion (solo local)')
  }

  fastify.addHook('preHandler', async (request, reply) => {
    if (!secret && enProduccion) {
      return reply.code(503).send({ error: 'VAPI_SERVER_SECRET no configurado' })
    }

    if (!secret) return

    const headerNombre = (process.env.VAPI_SECRET_HEADER || 'x-vapi-secret').toLowerCase()
    if (!comparaSecreto(request.headers[headerNombre], secret)) {
      return reply.code(401).send({ error: 'Secret invalido' })
    }
  })

  fastify.post('/webhook/vapi', async (request, reply) => {
    const message = request.body?.message

    if (!message) {
      return reply.code(400).send({ error: 'Payload sin campo message' })
    }

    if (message.type !== 'end-of-call-report') {
      return reply.code(200).send({ ok: true, ignorado: message.type })
    }

    const llamada = normalizarDesdeWebhook(message)

    if (!llamada.call_id) {
      request.log.warn('Webhook end-of-call-report sin call_id, no se puede guardar')
      return reply.code(400).send({ error: 'Payload sin call_id' })
    }

    try {
      const resultado = await guardarLlamada(llamada)

      request.log.info(
        {
          call_id: resultado.call_id,
          tieneResumen: !!llamada.resumen,
          tieneTranscripcion: !!llamada.transcripcion,
          duracion: llamada.duracion
        },
        'Llamada procesada desde webhook'
      )

      return reply.code(200).send({ ok: true, call_id: resultado.call_id, insertada: resultado.insertada })
    } catch (error) {
      request.log.error(error, 'Error guardando llamada desde webhook')
      return reply.code(500).send({ ok: false, error: 'Error guardando la llamada' })
    }
  })
}
