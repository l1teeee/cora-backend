import { rechazaSinAdminKey } from '../auth.js'
import {
  listarContactos,
  obtenerContacto,
  llamadasDelContacto,
  actualizarContacto
} from '../repository/contactos.js'
import { registrarAuditoria } from '../repository/auditoria.js'

const schemaListado = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      q: { type: 'string' }
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
  fastify.get('/contactos', { schema: schemaListado }, async (request, reply) => {
    // Los contactos son datos personales de estudiantes: mismo criterio que /llamadas
    if (rechazaSinAdminKey(request, reply)) return reply

    const { page, limit, q } = request.query

    try {
      return await listarContactos({ page, limit, q })
    } catch (error) {
      request.log.error(error, 'Error consultando contactos')
      return reply.code(500).send({ error: 'Error consultando contactos' })
    }
  })

  fastify.get('/contactos/:telefono', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const contacto = await obtenerContacto(request.params.telefono)

      if (!contacto) {
        return reply.code(404).send({ error: 'Contacto no encontrado' })
      }

      const llamadas = await llamadasDelContacto(request.params.telefono)

      return { contacto, llamadas }
    } catch (error) {
      request.log.error(error, 'Error consultando el contacto')
      return reply.code(500).send({ error: 'Error consultando el contacto' })
    }
  })

  fastify.patch('/contactos/:telefono', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { telefono } = request.params
    const { nombre, notas } = request.body ?? {}

    if (nombre === undefined && notas === undefined) {
      return reply.code(400).send({ error: 'Nada que actualizar: manda nombre o notas' })
    }

    try {
      const antes = await obtenerContacto(telefono)

      if (!antes) {
        return reply.code(404).send({ error: 'Contacto no encontrado' })
      }

      await actualizarContacto(telefono, { nombre, notas })
      const despues = await obtenerContacto(telefono)

      // La edicion ya se aplico: un fallo de auditoria no debe tumbar la respuesta,
      // solo quedar visible en logs y en el flag
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'edito_contacto',
          detalle: {
            telefono,
            antes: { nombre: antes.nombre, notas: antes.notas },
            despues: { nombre: despues.nombre, notas: despues.notas }
          }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de edicion de contacto')
        auditoriaRegistrada = false
      }

      return { ok: true, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error actualizando el contacto')
      return reply.code(500).send({ error: 'Error actualizando el contacto' })
    }
  })
}
