import { rechazaSinAdminKey } from '../auth.js'
import {
  leerAsistente,
  actualizarAsistente,
  listarArchivos,
  subirArchivo,
  eliminarArchivo,
  urlGrabacion
} from '../vapi/asistente.js'

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
    analysisPlan: crudo.analysisPlan
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

export default async function (fastify, opts) {
  fastify.get('/vapi/asistente', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      const crudo = await leerAsistente()
      return normalizarAsistente(crudo)
    } catch (error) {
      request.log.error(error, 'Error consultando el asistente de Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.patch('/vapi/asistente', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    const { nombre, firstMessage, systemPrompt, voice, model, analysisPlan } = request.body ?? {}

    try {
      const actual = await leerAsistente()
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

      await actualizarAsistente(parche)

      return { ok: true, cambios }
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
      return reply.code(201).send({ ok: true, archivo: normalizarArchivo(archivo) })
    } catch (error) {
      request.log.error(error, 'Error subiendo el archivo a Vapi')
      return reply.code(502).send({ error: error.message })
    }
  })

  fastify.delete('/vapi/archivos/:fileId', async (request, reply) => {
    if (rechazaSinAdminKey(request, reply)) return reply

    try {
      await eliminarArchivo(request.params.fileId)
      return { ok: true }
    } catch (error) {
      request.log.error(error, 'Error eliminando el archivo de Vapi')
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
