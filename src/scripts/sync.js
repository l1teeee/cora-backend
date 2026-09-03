import '../env.js'
import { obtenerTodasLasLlamadas } from '../vapi/client.js'
import { normalizarDesdeApi } from '../vapi/normalize.js'
import { guardarLlamadas } from '../repository/llamadas.js'
import { cerrarPool } from '../db.js'

function leerArgumento(nombre, valorPorDefecto) {
  const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  return arg ? Number(arg.split('=')[1]) : valorPorDefecto
}

async function main() {
  const limit = leerArgumento('limit', 100)
  const maxPaginas = leerArgumento('maxPaginas', 20)

  const calls = await obtenerTodasLasLlamadas({ limit, maxPaginas })
  console.log(`Vapi devolvio ${calls.length} llamadas`)

  const llamadas = calls.map(normalizarDesdeApi).filter((l) => l.call_id)
  const resultado = await guardarLlamadas(llamadas)

  console.log('Resultado:', {
    total: resultado.total,
    insertadas: resultado.insertadas,
    actualizadas: resultado.actualizadas,
    errores: resultado.errores.length
  })

  await cerrarPool()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
