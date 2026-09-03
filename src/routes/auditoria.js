import { rechazaSinAdminKey } from '../auth.js'
import { registrarAuditoria, listarAuditoria } from '../repository/auditoria.js'

const schemaPost = {
  body: {
    type: 'object',
    required: ['usuario', 'accion'],
    properties: {
      usuario: { type: 'string' },
      accion: { type: 'string' },
      detalle: {}
    }
  }
}

const schemaGet = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      accion: { type: 'string' }
    }
  }
}

function esCadenaNoVacia(valor) {
  return typeof valor === 'string' && valor.trim() !== ''
}

export default async function (fastify, opts) {
  // attachValidation: el error automatico de Fastify no trae el shape que pide este endpoint;
  // se deja pasar al handler y la validacion real (incluyendo campos ausentes) la hace esCadenaNoVacia
  fastify.post('/auditoria', { schema: schemaPost, attachValidation: true }, async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { usuario, accion, detalle } = request.body ?? {}

    if (!esCadenaNoVacia(usuario) || !esCadenaNoVacia(accion)) {
      return reply.code(400).send({ error: 'usuario y accion son obligatorios' })
    }

    try {
      const { id } = await registrarAuditoria({
        usuario: usuario.slice(0, 120),
        accion: accion.slice(0, 60),
        detalle
      })

      return reply.code(201).send({ ok: true, id })
    } catch (error) {
      request.log.error(error, 'Error registrando la auditoria')
      return reply.code(500).send({ error: 'Error registrando la auditoria' })
    }
  })

  fastify.get('/auditoria', { schema: schemaGet }, async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { page, limit, accion } = request.query

    try {
      return await listarAuditoria({ page, limit, accion })
    } catch (error) {
      request.log.error(error, 'Error consultando la auditoria')
      return reply.code(500).send({ error: 'Error consultando la auditoria' })
    }
  })
}
