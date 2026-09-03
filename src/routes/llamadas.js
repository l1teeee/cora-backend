import { listarLlamadas } from '../repository/llamadas.js'

const schema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  }
}

export default async function (fastify, opts) {
  fastify.get('/llamadas', { schema }, async (request, reply) => {
    const { page, limit } = request.query

    try {
      return await listarLlamadas({ page, limit })
    } catch (error) {
      request.log.error(error, 'Error consultando llamadas')
      return reply.code(500).send({ error: 'Error consultando llamadas' })
    }
  })
}
