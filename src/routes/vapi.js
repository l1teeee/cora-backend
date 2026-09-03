import { rechazaSinAdminKey } from '../auth.js'
import {
  leerAsistente,
  actualizarAsistente,
  listarArchivos,
  subirArchivo,
  eliminarArchivo,
  urlGrabacion,
  idAsistente
} from '../vapi/asistente.js'
import { registrarAuditoria } from '../repository/auditoria.js'
import { guardarSnapshot, listarSnapshots, obtenerSnapshot } from '../repository/historial.js'

const EXTENSIONES_PERMITIDAS = ['.pdf', '.docx', '.txt']
const TAMANO_MAXIMO_BYTES = 300 * 1024

function extraerSystemPrompt(model) {
  const mensajes = model?.messages
  if (!Array.isArray(mensajes)) return ''

  const systemMsg = mensajes.find((mensaje) => mensaje?.role === 'system')
  return systemMsg?.content ?? ''
}

// Copia el model completo y sustituye (o inserta) el mensaje de system: un PATCH parcial de
// `model` en Vapi pisa el resto de la config (provider, temperature, tools), asi que siempre
// hay que mandar el objeto entero.
function conSystemPromptInsertado(model, systemPrompt) {
  const mensajes = Array.isArray(model?.messages) ? [...model.messages] : []
  const idx = mensajes.findIndex((mensaje) => mensaje?.role === 'system')

  if (idx === -1) {
    mensajes.unshift({ role: 'system', content: systemPrompt })
  } else {
    mensajes[idx] = { ...mensajes[idx], content: systemPrompt }
  }

  return { ...model, messages: mensajes }
}

function normalizarAsistente(crudo) {
  return {
    id: crudo.id,
    nombre: crudo.name,
    firstMessage: crudo.firstMessage,
    systemPrompt: extraerSystemPrompt(crudo.model),
    voice: crudo.voice,
    model: crudo.model,
    analysisPlan: crudo.analysisPlan,
    // Version optimista: el dashboard la devuelve en el PATCH para que dos admins
    // editando a la vez no se pisen en silencio
    updatedAt: crudo.updatedAt ?? null
  }
}

function normalizarArchivo(item) {
  return {
    id: item.id,
    nombre: item.name ?? item.originalName ?? item.id,
    tamano: item.bytes ?? item.size ?? null,
    creado: item.createdAt ?? null
  }
}

function difierenJson(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b)
}

// El dashboard manda el usuario de la sesion (body o header x-usuario); que falte no debe
// impedir registrar el snapshot/auditoria, solo queda sin atribuir
function usuarioDe(request) {
  const usuario = request.body?.usuario ?? request.headers['x-usuario']
  return typeof usuario === 'string' && usuario.trim() !== '' ? usuario.slice(0, 120) : 'desconocido'
}

// Lista blanca de campos restaurables al revertir: excluye explicitamente los de solo lectura
// de Vapi (id, orgId, createdAt, updatedAt, isServerUrlSecretSet) en vez de borrarlos con delete
function parcheRevertibleDesde(config) {
  const parche = {}

  if (config.name !== undefined) parche.name = config.name
  if (config.firstMessage !== undefined) parche.firstMessage = config.firstMessage
  if (config.model !== undefined) parche.model = config.model
  if (config.voice !== undefined) parche.voice = config.voice
  if (config.analysisPlan !== undefined) parche.analysisPlan = config.analysisPlan

  return parche
}

export default async function (fastify, opts) {
  fastify.get('/vapi/asistente', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    // ?refrescar=1 salta el cache: es el boton de recargar del panel
    const refrescar = request.query?.refrescar === '1' || request.query?.refrescar === 'true'

    try {
      const crudo = await leerAsistente({ refrescar })
      return normalizarAsistente(crudo)
    } catch (error) {
      request.log.error(error, 'Error consultando el asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.patch('/vapi/asistente', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { nombre, firstMessage, systemPrompt, voice, model, analysisPlan, updatedAt } = request.body ?? {}
    const usuario = usuarioDe(request)

    try {
      // Nunca desde cache: el chequeo de concurrencia y el parche de `model` necesitan
      // el estado real de Vapi, no uno de hace unos segundos
      const actual = await leerAsistente({ refrescar: true })

      // Concurrencia optimista: si quien edita leyo una version mas vieja que la vigente,
      // guardar borraria el cambio del otro admin sin que ninguno se entere
      if (updatedAt !== undefined && actual.updatedAt !== undefined && updatedAt !== actual.updatedAt) {
        return reply.code(409).send({
          error: 'La configuracion cambio desde que la abriste',
          actualizadoEn: actual.updatedAt
        })
      }

      const parche = {}
      const cambios = []

      if (nombre !== undefined && nombre !== actual.name) {
        parche.name = nombre
        cambios.push('nombre')
      }

      if (firstMessage !== undefined && firstMessage !== actual.firstMessage) {
        parche.firstMessage = firstMessage
        cambios.push('firstMessage')
      }

      if (systemPrompt !== undefined && systemPrompt !== extraerSystemPrompt(actual.model)) {
        cambios.push('systemPrompt')
      }

      if (model !== undefined && difierenJson(model, actual.model)) {
        cambios.push('model')
      }

      // Un solo PATCH de `model` cubre tanto el reemplazo directo como el cambio de systemPrompt
      if (cambios.includes('model') || cambios.includes('systemPrompt')) {
        const modeloBase = model !== undefined ? model : actual.model
        parche.model = systemPrompt !== undefined
          ? conSystemPromptInsertado(modeloBase, systemPrompt)
          : modeloBase
      }

      if (voice !== undefined) {
        const voiceFinal = { ...actual.voice, ...voice }
        if (difierenJson(voiceFinal, actual.voice)) {
          parche.voice = voiceFinal
          cambios.push('voice')
        }
      }

      if (analysisPlan !== undefined && difierenJson(analysisPlan, actual.analysisPlan)) {
        parche.analysisPlan = analysisPlan
        cambios.push('analysisPlan')
      }

      if (cambios.length === 0) {
        return { ok: true, cambios: [] }
      }

      let snapshotId

      // Bloqueante y ANTES del PATCH: si no se puede guardar la version anterior no hay que
      // aplicar el cambio, porque ese snapshot es lo que permite revertirlo despues
      try {
        const snapshot = await guardarSnapshot({ assistantId: actual.id, config: actual, usuario })
        snapshotId = snapshot.id
      } catch (error) {
        request.log.error(error, 'Error guardando snapshot antes de actualizar el asistente de Vapi')
        return reply.code(500).send({ error: 'No se pudo guardar la version anterior del asistente' })
      }

      const actualizado = await actualizarAsistente(parche)

      // El PATCH en Vapi ya se aplico y es irreversible desde aqui: un fallo de auditoria no
      // debe tumbar la respuesta, solo quedar visible en logs y en el flag de la respuesta
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({ usuario, accion: 'edito_asistente', detalle: { cambios, snapshotId } })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de edicion del asistente de Vapi')
        auditoriaRegistrada = false
      }

      // La version nueva vuelve al cliente para que su siguiente guardado no choque
      // contra su propio cambio
      return {
        ok: true,
        cambios,
        snapshotId,
        auditoriaRegistrada,
        updatedAt: actualizado?.updatedAt ?? null
      }
    } catch (error) {
      request.log.error(error, 'Error actualizando el asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.get('/vapi/archivos', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const archivos = await listarArchivos()
      return { archivos: archivos.map(normalizarArchivo) }
    } catch (error) {
      request.log.error(error, 'Error consultando los archivos de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.post('/vapi/archivos', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { nombre, tipo, base64 } = request.body ?? {}

    if (typeof nombre !== 'string' || !EXTENSIONES_PERMITIDAS.some((ext) => nombre.toLowerCase().endsWith(ext))) {
      return reply.code(400).send({ error: 'El archivo debe ser .pdf, .docx o .txt' })
    }

    const bytes = Buffer.from(base64 ?? '', 'base64')

    if (bytes.length > TAMANO_MAXIMO_BYTES) {
      return reply.code(400).send({ error: 'El archivo supera el tamano maximo de 300KB' })
    }

    try {
      const archivo = await subirArchivo({ nombre, tipo, base64 })
      const archivoNormalizado = normalizarArchivo(archivo)

      // Un fallo de auditoria no debe romper la subida, que ya se completo en Vapi
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'subio_archivo',
          detalle: { nombre, tamano: bytes.length, fileId: archivoNormalizado.id }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de subida de archivo')
        auditoriaRegistrada = false
      }

      return reply.code(201).send({ ok: true, archivo: archivoNormalizado, auditoriaRegistrada })
    } catch (error) {
      request.log.error(error, 'Error subiendo el archivo a Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.delete('/vapi/archivos/:fileId', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      await eliminarArchivo(request.params.fileId)

      // Un fallo de auditoria no debe romper el borrado, que ya se completo en Vapi
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario: usuarioDe(request),
          accion: 'elimino_archivo',
          detalle: { fileId: request.params.fileId }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de eliminacion de archivo')
        auditoriaRegistrada = false
      }

      return { ok: true, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error eliminando el archivo de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  const schemaHistorial = {
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, default: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
      }
    }
  }

  fastify.get('/vapi/historial', { schema: schemaHistorial }, async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { page, limit } = request.query

    try {
      const assistantId = await idAsistente()
      return await listarSnapshots({ assistantId, page, limit })
    } catch (error) {
      request.log.error(error, 'Error consultando el historial del asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.get('/vapi/historial/:id', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const snapshot = await obtenerSnapshot(request.params.id)

      if (!snapshot) {
        return reply.code(404).send({ error: 'Snapshot no encontrado' })
      }

      return snapshot
    } catch (error) {
      request.log.error(error, 'Error consultando el snapshot del asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.post('/vapi/historial/:id/revertir', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const usuario = usuarioDe(request)

    try {
      const snapshot = await obtenerSnapshot(request.params.id)

      if (!snapshot) {
        return reply.code(404).send({ error: 'Snapshot no encontrado' })
      }

      // Igual que el PATCH: el snapshot previo tiene que retratar el estado real, no el cacheado
      const actual = await leerAsistente({ refrescar: true })
      let snapshotPrevioId

      // Revertir es tambien un cambio: sin este snapshot del estado actual no se podria
      // deshacer una reversion equivocada. Mismo criterio que el PATCH: bloqueante antes de tocar Vapi
      try {
        const previo = await guardarSnapshot({ assistantId: actual.id, config: actual, usuario })
        snapshotPrevioId = previo.id
      } catch (error) {
        request.log.error(error, 'Error guardando snapshot antes de revertir el asistente de Vapi')
        return reply.code(500).send({ error: 'No se pudo guardar el estado actual antes de revertir' })
      }

      const parche = parcheRevertibleDesde(snapshot.config_json)
      await actualizarAsistente(parche)

      // Igual que en el PATCH: la reversion en Vapi ya se aplico, un fallo de auditoria no debe tumbar la respuesta
      let auditoriaRegistrada = true
      try {
        await registrarAuditoria({
          usuario,
          accion: 'revirtio_asistente',
          detalle: { snapshotId: snapshot.id, snapshotPrevioId }
        })
      } catch (error) {
        request.log.error(error, 'Error registrando la auditoria de reversion del asistente de Vapi')
        auditoriaRegistrada = false
      }

      return { ok: true, revertidoA: snapshot.id, snapshotPrevioId, auditoriaRegistrada }
    } catch (error) {
      request.log.error(error, 'Error revirtiendo el asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.get('/vapi/grabacion/:callId', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const url = await urlGrabacion(request.params.callId)

      if (!url) {
        return reply.code(404).send({ error: 'Grabacion no disponible' })
      }

      // Se redirige en vez de hacer proxy de los bytes: el <audio> del navegador usa peticiones
      // Range para la barra de busqueda, y reenviarlas por aqui las romperia
      return reply.redirect(url, 302)
    } catch (error) {
      request.log.error(error, 'Error obteniendo la grabacion de Vapi')
      return reply.code(502).send({ error: 'Grabacion no disponible' })
    }
  })
}
