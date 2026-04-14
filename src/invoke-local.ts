import 'dotenv/config';
import { buildApp } from './app.js';

const start = async () => {
  const app = buildApp();
  await app.listen({ port: 3000, host: '0.0.0.0' });
  console.log('API rodando em http://localhost:3000');
};

start();
