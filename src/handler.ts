import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

const app = buildApp();
const proxy = awsLambdaFastify(app);

export const handler = async (event: any, context: any) => {
  return proxy(event, context);
};
