// Cliente de administracion del asistente de Vapi (config, archivos de conocimiento, grabaciones).
// Mismo patron que client.js: fetch con Bearer, error si !res.ok.

const VAPI_BASE_URL = 'https://api.vapi.ai'

let idAsistenteCacheado

async function pedirVapi(ruta, init = {}) {
  const apiKey = process.env.VAPI_API_KEY

  if (!apiKey) {
    throw new Error('Falta VAPI_API_KEY')
  }

  const res = await fetch(`${VAPI_BASE_URL}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...init.headers }
  })

  if (!res.ok) {
    throw new Error(`Vapi ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  if (res.status === 204) return null

  return res.json()
}

export async function idAsistente() {
  if (idAsistenteCacheado) return idAsistenteCacheado

  if (process.env.VAPI_ASSISTANT_ID) {
    idAsistenteCacheado = process.env.VAPI_ASSISTANT_ID
    return idAsistenteCacheado
  }

  const asistentes = await pedirVapi('/assistant')
  idAsistenteCacheado = asistentes?.[0]?.id

  return idAsistenteCacheado
}

// Cache de lectura muy corto: la config del asistente cambia poco y cada carga del panel
// pegaba a Vapi. No es una segunda fuente de verdad, solo evita repetir la misma llamada
// en rafaga. Toda ruta de escritura pide { refrescar: true } porque necesita el estado real.
const TTL_CACHE_MS = 45_000

let cacheAsistente = null

export async function leerAsistente({ refrescar = false } = {}) {
  if (!refrescar && cacheAsistente !== null && Date.now() < cacheAsistente.expiraEn) {
    return cacheAsistente.datos
  }

  const id = await idAsistente()
  const datos = await pedirVapi(`/assistant/${encodeURIComponent(id)}`)

  cacheAsistente = { datos, expiraEn: Date.now() + TTL_CACHE_MS }

  return datos
}

export async function actualizarAsistente(parche) {
  const id = await idAsistente()

  const actualizado = await pedirVapi(`/assistant/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parche)
  })

  // Vapi devuelve el asistente ya actualizado: se aprovecha para dejar el cache al dia
  // en lugar de invalidarlo y obligar a la siguiente lectura a ir a la red.
  cacheAsistente = { datos: actualizado, expiraEn: Date.now() + TTL_CACHE_MS }

  return actualizado
}

export async function listarArchivos() {
  return pedirVapi('/file')
}

export async function subirArchivo({ nombre, tipo, base64 }) {
  const bytes = Buffer.from(base64, 'base64')
  const form = new FormData()
  form.append('file', new File([bytes], nombre, { type: tipo }))

  // Sin Content-Type manual: fetch tiene que generar el boundary del multipart solo
  return pedirVapi('/file', { method: 'POST', body: form })
}

export async function eliminarArchivo(fileId) {
  return pedirVapi(`/file/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
}

export async function urlGrabacion(callId) {
  const apiKey = process.env.VAPI_API_KEY

  if (!apiKey) {
    throw new Error('Falta VAPI_API_KEY')
  }

  // Vapi guarda las grabaciones en un bucket privado y responde 302 hacia una URL firmada
  // de vida corta: con redirect manual se lee esa URL del header en vez de seguirla aqui
  const res = await fetch(`${VAPI_BASE_URL}/call/${encodeURIComponent(callId)}/stereo-recording`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'manual'
  })

  if (res.status >= 300 && res.status < 400) {
    return res.headers.get('location')
  }

  // La grabacion no existe o no hay permiso: no es un fallo del servidor
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return null
  }

  throw new Error(`Vapi ${res.status}: ${(await res.text()).slice(0, 300)}`)
}
