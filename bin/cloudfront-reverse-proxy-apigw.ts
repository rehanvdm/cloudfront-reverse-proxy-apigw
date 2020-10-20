#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CloudfrontReverseProxyApigwStack } from '../lib/cloudfront-reverse-proxy-apigw-stack';


const app = new cdk.App();
new CloudfrontReverseProxyApigwStack(app, 'cloudfront-reverse-proxy-apigw');
