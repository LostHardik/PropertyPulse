// Vercel turns files in /api into Node.js functions. This catch-all preserves
// the original /api/* URL so the shared Express application handles every API
// route exactly as it does in local development.
export {default} from '../index.js';
