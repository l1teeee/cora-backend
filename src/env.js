// Debe importarse ANTES que db.js: los imports ESM se evaluan en orden y db.js
// lee process.env en su cuerpo, asi que el .env tiene que estar cargado ya.
// En Railway no hay .env y las variables vienen inyectadas: el fallo es esperado.
try {
  process.loadEnvFile()
} catch {
  // sin .env local, seguimos con las variables del entorno
}
