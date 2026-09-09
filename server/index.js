import backend from './index.cjs'

export const main_handler = backend.main_handler
export const handler = backend.handler

// Tencent Cloud Web Functions expect the uploaded process to listen on the
// configured port. Keep the SCF handler export above for compatible runtimes.
const port = Number(process.env.PORT || process.env.SCF_CUSTOM_PORT || 9000)
if (!backend.app.listening) backend.app.listen(port, '0.0.0.0', () => console.log(`Web function listening on ${port}`))
