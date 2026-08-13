#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { ServerlessRestApiStack } from '../lib/serverless-rest-api-stack';

const app = new App();
new ServerlessRestApiStack(app, 'ServerlessRestApiStack', {
  description: 'Educational serverless REST API: API Gateway, Lambda, and DynamoDB.',
});
