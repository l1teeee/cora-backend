const VAPI_API_URL = 'https://api.vapi.ai/call'

export async function obtenerLlamadas({ limit = 100, createdAtLt } = {}) {
  const apiKey = process.env.VAPI_API_KEY

  if (!apiKey) {
    throw new Error('Falta VAPI_API_KEY')
  }

  const params = new URLSearchParams({ limit: String(limit) })

  if (createdAtLt) {
    params.set('createdAtLt', createdAtLt)
  }

  const res = await fetch(`${VAPI_API_URL}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })

  if (!res.ok) {
    throw new Error(`Vapi API ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()

  return Array.isArray(data) ? data : (data.results ?? [])
}

export async function obtenerTodasLasLlamadas({ limit = 100, maxPaginas = 20 } = {}) {
  const todas = new Map()
  let createdAtLt

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const calls = await obtenerLlamadas({ limit, createdAtLt })

    if (calls.length === 0) break

    for (const call of calls) {
      todas.set(call.id, call)
    }

    if (calls.length < limit) break

    // Vapi no da cursor de paginacion: se usa la fecha de la llamada mas antigua de la pagina
    // como limite superior (exclusivo) de la siguiente pagina
    const masAntigua = calls.reduce((min, call) => (call.createdAt < min.createdAt ? call : min))

    if (!masAntigua.createdAt) break

    createdAtLt = masAntigua.createdAt
  }

  return Array.from(todas.values())
}
