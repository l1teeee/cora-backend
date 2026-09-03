// Logica de normalizacion de llamadas de Vapi. Sin dependencias de red/DB, solo transforma datos.
//
// Regla central: todo campo ausente, vacio o no parseable se devuelve como null (nunca '' ni undefined).
// El repositorio hace UPSERT con COALESCE(VALUES(col), col): un webhook posterior incompleto no debe
// pisar con '' los datos que ya estaban guardados. Unica excepcion: el costo 0 real de Vapi es 0, no null.

const ROLES_EXCLUIDOS = new Set(['system', 'tool_calls', 'tool_call_result'])

function texto(valor, maxLength) {
  if (valor === null || valor === undefined) return null
  const cadena = typeof valor === 'string' ? valor : String(valor)
  const recortado = cadena.trim()
  if (recortado === '') return null
  return typeof maxLength === 'number' ? recortado.slice(0, maxLength) : recortado
}

function esNumeroFinito(valor) {
  return typeof valor === 'number' && Number.isFinite(valor)
}

function etiquetaDeRole(role) {
  if (role === 'user') return 'USUARIO'
  if (role === 'bot' || role === 'assistant') return 'ASISTENTE'
  return String(role).toUpperCase()
}

function primerCostoValido(...valores) {
  for (const valor of valores) {
    if (esNumeroFinito(valor)) return valor
  }
  return null
}

export function construirTranscripcion(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null

  const lineas = []
  for (const mensaje of messages) {
    if (!mensaje || ROLES_EXCLUIDOS.has(mensaje.role)) continue
    const contenido = texto(mensaje.message)
    if (contenido === null) continue
    lineas.push(`${etiquetaDeRole(mensaje.role)}: ${contenido}`)
  }

  return lineas.length > 0 ? lineas.join('\n') : null
}

export function aFechaMysql(valor) {
  if (valor === null || valor === undefined || valor === '') return null

  const fecha = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null

  const pad = (n) => String(n).padStart(2, '0')
  const fechaStr = `${fecha.getUTCFullYear()}-${pad(fecha.getUTCMonth() + 1)}-${pad(fecha.getUTCDate())}`
  const horaStr = `${pad(fecha.getUTCHours())}:${pad(fecha.getUTCMinutes())}:${pad(fecha.getUTCSeconds())}`

  return `${fechaStr} ${horaStr}`
}

export function calcularDuracion({ durationSeconds, startedAt, endedAt, messages } = {}) {
  if (esNumeroFinito(durationSeconds)) return Math.round(durationSeconds)

  // startedAt/endedAt null explicito no debe colarse aqui: new Date(null) da 1970-01-01, no Invalid Date
  if (startedAt != null && endedAt != null) {
    const inicio = new Date(startedAt)
    const fin = new Date(endedAt)
    if (!Number.isNaN(inicio.getTime()) && !Number.isNaN(fin.getTime())) {
      return Math.round((fin.getTime() - inicio.getTime()) / 1000)
    }
  }

  if (Array.isArray(messages) && messages.length > 0) {
    let maximo = null
    for (const mensaje of messages) {
      const segundos = mensaje?.secondsFromStart
      if (esNumeroFinito(segundos) && (maximo === null || segundos > maximo)) {
        maximo = segundos
      }
    }
    if (maximo !== null) return Math.round(maximo)
  }

  return null
}

export function extraerResumen(analysis, fallbackSummary) {
  const structuredData = analysis?.structuredData
  const elegido =
    analysis?.summary ??
    structuredData?.resumen_llamada ??
    (typeof structuredData === 'string' ? structuredData : undefined) ??
    fallbackSummary

  if (elegido === null || elegido === undefined) return null
  if (typeof elegido === 'object') return JSON.stringify(elegido)

  return texto(elegido)
}

// Vapi NO deja los structured outputs en analysis: van en artifact.structuredOutputs, indexados
// por el id del output y con la forma { name, result }. analysis solo lleva el resumen generico
// de summaryPlan, que este assistant tiene desactivado, de ahi que llegue siempre vacio.
export function extraerSalidaEstructurada(artifact, nombre) {
  const salidas = artifact?.structuredOutputs

  if (!salidas || typeof salidas !== 'object') return null

  const elegido = Object.values(salidas).find((salida) => salida?.name === nombre)

  return elegido?.result ?? null
}

export function extraerResumenDeArtifact(artifact) {
  const salidas = artifact?.structuredOutputs

  if (!salidas || typeof salidas !== 'object') return null

  const valores = Object.values(salidas)
  // El fallback a la primera salida solo aplica si ninguna se llama resumen_llamada: con varios
  // outputs configurados, caer siempre en la primera guardaria el nombre o el motivo como resumen
  const hayResumenNombrado = valores.some((salida) => salida?.name === 'resumen_llamada')
  const resultado = hayResumenNombrado ? extraerSalidaEstructurada(artifact, 'resumen_llamada') : valores[0]?.result

  if (resultado === null || resultado === undefined) return null
  if (typeof resultado === 'object') return JSON.stringify(resultado)

  return texto(resultado)
}

const MOTIVOS_VALIDOS = new Set(['consulta', 'queja', 'tramite', 'transferencia'])

// Un objeto o un array como salida no es un texto: devolverlo con String() guardaria "[object Object]"
function textoDeSalida(valor, maxLength) {
  if (valor !== null && typeof valor === 'object') return null
  return texto(valor, maxLength)
}

function motivoDeSalida(valor) {
  const crudo = textoDeSalida(valor)
  if (crudo === null) return null

  const normalizado = crudo.toLowerCase()

  return MOTIVOS_VALIDOS.has(normalizado) ? normalizado : null
}

function seguimientoDeSalida(valor) {
  if (valor === true) return 1
  if (valor === false) return 0

  if (typeof valor === 'string') {
    const normalizado = valor.trim().toLowerCase()
    if (normalizado === 'true') return 1
    if (normalizado === 'false') return 0
  }

  return null
}

// Para el polling posterior: "resumen_llamada" es el structured output que configura el assistant
// y es el que se quiere guardar. analysis.summary es el resumen generico de Vapi, solo respaldo.
export function extraerResumenEstructurado(analysis) {
  const structuredData = analysis?.structuredData
  const elegido = structuredData?.resumen_llamada ?? analysis?.summary ?? structuredData

  if (elegido === null || elegido === undefined) return null
  if (typeof elegido === 'object') return JSON.stringify(elegido)

  return texto(elegido)
}

export function normalizarDesdeWebhook(message) {
  const call = message?.call ?? message?.artifact?.call ?? {}
  const messages = message?.artifact?.messages ?? message?.messages
  const customer = message?.customer ?? message?.artifact?.customer ?? call.customer
  const artifact = message?.artifact

  return {
    call_id: texto(call.id ?? message?.callId ?? message?.artifact?.call?.id),
    fecha: aFechaMysql(message?.startedAt ?? call.startedAt ?? call.createdAt ?? message?.timestamp),
    duracion: calcularDuracion({
      durationSeconds: message?.durationSeconds,
      startedAt: message?.startedAt ?? call.startedAt,
      endedAt: message?.endedAt ?? call.endedAt,
      messages
    }),
    costo: primerCostoValido(message?.cost, call.cost),
    transcripcion: construirTranscripcion(messages) ?? texto(message?.transcript ?? message?.artifact?.transcript),
    resumen: extraerResumenDeArtifact(artifact) ?? extraerResumen(message?.analysis, message?.summary),
    razon_finalizacion: texto(message?.endedReason ?? call.endedReason, 100),
    numero_telefono: texto(customer?.number, 32),
    url_grabacion: texto(
      message?.recordingUrl ??
        message?.artifact?.recordingUrl ??
        message?.stereoRecordingUrl ??
        message?.artifact?.stereoRecordingUrl ??
        message?.artifact?.recording?.mono?.combinedUrl,
      1024
    ),
    nombre_capturado: textoDeSalida(extraerSalidaEstructurada(artifact, 'nombre_persona'), 160),
    motivo: motivoDeSalida(extraerSalidaEstructurada(artifact, 'motivo')),
    requiere_seguimiento: seguimientoDeSalida(extraerSalidaEstructurada(artifact, 'requiere_seguimiento'))
  }
}

export function normalizarDesdeApi(call) {
  const messages = call?.messages ?? call?.artifact?.messages
  const artifact = call?.artifact

  return {
    call_id: texto(call?.id),
    fecha: aFechaMysql(call?.startedAt ?? call?.createdAt),
    duracion: calcularDuracion({
      startedAt: call?.startedAt,
      endedAt: call?.endedAt,
      messages
    }),
    costo: primerCostoValido(call?.cost),
    transcripcion: construirTranscripcion(messages) ?? texto(call?.transcript || call?.artifact?.transcript),
    resumen: extraerResumenDeArtifact(artifact) ?? extraerResumen(call?.analysis, call?.summary),
    razon_finalizacion: texto(call?.endedReason, 100),
    numero_telefono: texto(call?.customer?.number, 32),
    url_grabacion: texto(call?.recordingUrl ?? call?.stereoRecordingUrl ?? call?.artifact?.recordingUrl, 1024),
    nombre_capturado: textoDeSalida(extraerSalidaEstructurada(artifact, 'nombre_persona'), 160),
    motivo: motivoDeSalida(extraerSalidaEstructurada(artifact, 'motivo')),
    requiere_seguimiento: seguimientoDeSalida(extraerSalidaEstructurada(artifact, 'requiere_seguimiento'))
  }
}
