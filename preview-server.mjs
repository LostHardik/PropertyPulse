import { createApp } from './server/app.js';
import { createDemoRepository } from './server/demo-repository.js';

const app = createApp(createDemoRepository(), { secret: 'local-preview-secret-with-at-least-thirty-two-characters', staticFiles: true, logging: true, demoMode: true });
const server = app.listen(3000, '127.0.0.1', () => {
  console.log('PropertyPulse local review server listening on http://127.0.0.1:3000');
  console.log('Choose Administrator or Viewer directly from the demo screen.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
