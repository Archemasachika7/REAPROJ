import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp();
app.server.listen(port, () => console.log(`DREAM SURFERS running on http://localhost:${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
