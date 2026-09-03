import { rechazaSinAdminKey } from '../auth.js'
import { listarLlamadas, obtenerLlamadaPorId, asignarLlamada } from '../repository/llamadas.js'
import { obtenerUsuario } from '../repository/usuarios.js'
import { registrarAuditoria } from '../repository/auditoria.js'

const schema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      asignadoA: { type: 'string' }
    }
  }
}

// El dashboard manda el usuario de la sesion (body o header x-usuario); que falte no debe
// impedir registrar la auditoria, solo queda sin atribuir
function usuarioDe(request) {
  const usuario = request.body?.usuario ?? request.headers['x-usuario']
  return typeof usuario === 'string' && usuario.trim() !== '' ? usuario.slice(0, 120) : 'desconocido'
}

export default async function (fastify, opts) {
  fastify.get('/llamadas', { schema }, async (request, reply) => {
    // El listado devuelve telefonos, resumenes y grabaciones de estudiantes: no puede ser publico
    if (rechazaSinAdminKey(request, reply)) return reply

    const { page, limit, asignadoA } = request.query

    try {
      return await listarLlamadas({ page, limit, asignadoA })
    } catch (error) {
      request.log.error(error, 'Error consultando llamadas')
      return reply.code(500).send({ error: 'Error consultando llamadas' })
    }
  })

  // El listado omite transcripcion a proposito (textos enormes); aqui si va, es una sola fila
  fastify.get('/llamadas/:callId', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const llamada = await obtenerLlamadaPorId(request.params.callId)

      if (!llamada) {
        return reply.code(404).send({ error: 'Llamada no encontrada' })
      }

      return llamada
    } catch (error) {
      request.log.error(error, 'Error consultando la llamada')
      return reply.code(500).send({ error: 'Error consultando la llamada' })
    }
  })

  fastify.patch('/llamadas/:callId/asignacion', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { callId } = request.params
    const { asignadoA } = request.body ?? {}

    if (asignadoA !== null && typeof asignadoA !== 'string') {
      return reply.code(400).send({ error: 'asignadoA debe ser un login o null para desasignar' })
    }

    try {
      const llamada = await obtenerLlamadaPorId(callId)

      if (!llamada) {
        return reply.code(404).send({ error: 'Llamada no encontrada' })
      }

      // Asignar a un login inexistente o dado de baja deja la llamada en manos de nadie
      if (asignadoA !== null) {
        const destinatario = await obtenerUsuario(asignadoA)

        if (!destinatario || !destinatario.activo) {
          return reply.code(400).send({ error: 'El usuario no existe o esta inactivo' })
        }
      }

      await asignarLlamada(callId, asignadoA)

      // La asignacion ya se aplico: un fallo de auditoria no debe tumbar la respuesta
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'asigno_llamada',
          detalle: { callId, antes: llamada.usuario_asignado, despues: asignadoA }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de asignacion de llamada')
        auditoriaRegistrada = false
      }

      return { ok: true, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error asignando la llamada')
      return reply.code(500).send({ error: 'Error asignando la llamada' })
    }
  })
}
