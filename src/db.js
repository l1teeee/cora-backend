import mysql from 'mysql2/promise'

const OPCIONES_POOL = {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: true,
  enableKeepAlive: true,
  // mysql2 activa CLIENT_FOUND_ROWS por defecto, y con ese flag un UPSERT que no cambia
  // nada devuelve affectedRows=1, indistinguible de un INSERT nuevo. Sin el flag vale la
  // semantica documentada de MySQL: 1 = insertado, 2 = actualizado, 0 = sin cambios.
  flags: ['-FOUND_ROWS'],
}

function resolverConfiguracion() {
  const uri = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL
  if (uri) return { uri }

  const { MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE } = process.env
  if (MYSQLHOST) {
    return {
      host: MYSQLHOST,
      port: Number(MYSQLPORT) || 3306,
      user: MYSQLUSER,
      password: MYSQLPASSWORD,
      database: MYSQLDATABASE,
    }
  }

  throw new Error('Falta configuracion de MySQL: define DATABASE_URL o MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE')
}

const configuracion = resolverConfiguracion()

// mysql2 acepta { uri, ...opciones } en createPool: parsea el uri y lo mezcla con el resto
export const pool = mysql.createPool({ ...configuracion, ...OPCIONES_POOL })

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return rows
}

export async function cerrarPool() {
  await pool.end()
}

// Version segura para logs: nunca exponer el password (ni el embebido en el uri)
export function configuracionDb() {
  if (configuracion.uri) {
    return { uri: configuracion.uri.replace(/:\/\/([^:/@]+):([^@]+)@/, '://$1:***@') }
  }
  const { password, ...resto } = configuracion
  return { ...resto, password: password ? '***' : undefined }
}
