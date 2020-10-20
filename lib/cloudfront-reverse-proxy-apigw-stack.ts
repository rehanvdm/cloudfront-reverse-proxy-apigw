import * as cdk from '@aws-cdk/core';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as s3 from '@aws-cdk/aws-s3';
import * as s3deploy from '@aws-cdk/aws-s3-deployment';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as lambda from '@aws-cdk/aws-lambda';
import * as cert from '@aws-cdk/aws-certificatemanager';

export class CloudfrontReverseProxyApigwStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const allowCors = true; /* Set to false for production, no longer needed */

    let defaultCorsOptions: apigateway.CorsOptions | undefined = undefined;
    if(allowCors)
    {
      defaultCorsOptions = {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowCredentials: true,
        allowHeaders: ["*"],
        maxAge: cdk.Duration.days(1)
      };
    }

    const name = (resourceName: string) => {
      return id + "-" + resourceName;
    };

    const custDomainCertArn: string = this.node.tryGetContext('custDomainCertArn');
    const custDomainName: string = this.node.tryGetContext('custDomainName');
    const customDomainMappingPath = "default";
    const cloudFrontApiGwPath = "cf-apigw";
    const cloudFrontCustDomainPath = "cf-cust-domain";
    const apiStageName = "prod";
    const api = new apigateway.RestApi(this, name("rest-api"), {
      restApiName: name("rest-api"),
      deployOptions: {
        stageName: apiStageName,
      }
    });

    const apiLambda = new lambda.Function(this, name("api-lambda"), {
      functionName: name("api-lambda"),
      code: new lambda.AssetCode('./src/backend/lambda/api'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: cdk.Duration.seconds(25),
    });
    const apiLambdaAuth = new lambda.Function(this, name("api-lambda-auth"), {
      functionName: name("api-lambda-auth"),
      code: new lambda.AssetCode('./src/backend/lambda/api-auth'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: cdk.Duration.seconds(25),
    });

    /* Add default non protected route that will catch all if no path exists. */
    /* ANY /* */
    api.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(apiLambda),
      defaultCorsPreflightOptions: defaultCorsOptions,
      anyMethod: true,
    });


    /* --------------------------- Paths used for the CloudFront to APIGW proxy ------------------------------------- */
    /* Creates a top level resource that is required because CloudFront prepends the path with the `pathPattern` when forwarding */
    let cloudFrontApiGwResource =  api.root.addResource(cloudFrontApiGwPath, { defaultCorsPreflightOptions: defaultCorsOptions });

    /* Add specific route for Custom Lambda Token Authorizer which requires the Authorization header */
    /* GET /cf-apigw/auth */
    let cfApiGwAuthResource = cloudFrontApiGwResource.addResource("auth", { defaultCorsPreflightOptions: defaultCorsOptions });
    cfApiGwAuthResource.addMethod("GET",  new apigateway.LambdaIntegration(apiLambda), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: new apigateway.TokenAuthorizer(this, name("api-apigw-auth"), { handler: apiLambdaAuth })
    });

    /* Add specific route for IAM Authorization which requires the Authorization header */
    /* GET /cf-apigw/auth-iam */
    let cfApiGwAuthIamResource = cloudFrontApiGwResource.addResource("auth-iam", { defaultCorsPreflightOptions: defaultCorsOptions });
    cfApiGwAuthIamResource.addMethod("GET",  new apigateway.LambdaIntegration(apiLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    });
    /* -------------------------------------------------------------------------------------------------------------- */


    /* ------------------------ Paths used for the CloudFront to Custom Domain proxy --------------------------------- */
    /* Creates a top level resource that is required because CloudFront prepends the path with the `pathPattern` when forwarding */
    let cloudFrontCustDomainResource =  api.root.addResource(cloudFrontCustDomainPath, { defaultCorsPreflightOptions: defaultCorsOptions });

    /* Add specific route for Custom Lambda Token Authorizer which requires the Authorization header */
    /* GET /cf-cust-domain/auth */
    let cfCustDomainAuthResource = cloudFrontCustDomainResource.addResource("auth", { defaultCorsPreflightOptions: defaultCorsOptions });
    cfCustDomainAuthResource.addMethod("GET",  new apigateway.LambdaIntegration(apiLambda), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: new apigateway.TokenAuthorizer(this, name("api-cust-domain-auth"), { handler: apiLambdaAuth })
    });

    /* Add specific route for IAM Authorization which requires the Authorization header */
    /* GET /cf-cust-domain/auth-iam */
    let cfCustDomainAuthIamResource = cloudFrontCustDomainResource.addResource("auth-iam", { defaultCorsPreflightOptions: defaultCorsOptions });
    cfCustDomainAuthIamResource.addMethod("GET",  new apigateway.LambdaIntegration(apiLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    });
    /* -------------------------------------------------------------------------------------------------------------- */


    let originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', { comment: id });
    const siteBucket = new s3.Bucket(this, name('web-bucket'), {
      bucketName:  name('web-bucket'),
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    siteBucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.CloudFrontWebDistribution(this, name("web-dist"), {
      comment: name("web-dist"),
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: siteBucket,
            originAccessIdentity: originAccessIdentity
          },
          behaviors : [ {isDefaultBehavior: true} ],
        },
        /* --------------------------------- Reverse proxy path to API GW ------------------------------------------- */
        {
          behaviors: [{
              pathPattern: "/"+cloudFrontApiGwPath+"/*",
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
              maxTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              defaultTtl: cdk.Duration.seconds(0),
              compress: false,
              forwardedValues: {
                queryString: true,
                headers: ["Authorization"]
              }
          }],
          customOriginSource: {
            /* domainName: api.url.replace('https://', '')
               Won't resolve at runtime, only after the stack is deployed. To get around this use multiple stacks and pass the
               output from the api(backend) stack to the frontend stack. Just keeping one now to reduce complexity. */

            /* Replace manually in the AWS Console after deploy with the API GW domain
               example: "xxxxxxxxxx.execute-api.us-east-1.amazonaws.com"*/
            domainName: "repalce.after-deployment-with-apigw-domain.com",
            originPath: "/"+apiStageName,
            originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }
        },
       /* --------------------------- Reverse proxy path to API GW Custom Domain ------------------------------------ */
        {
          behaviors: [{
              pathPattern: "/"+cloudFrontCustDomainPath+"/*",
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
              maxTtl: cdk.Duration.seconds(0),
              minTtl: cdk.Duration.seconds(0),
              defaultTtl: cdk.Duration.seconds(0),
              compress: false,
              forwardedValues: {
                queryString: true,
                headers: ["Authorization"]
              }
          }],
          customOriginSource: {
            domainName: custDomainName,
            originPath: "/"+customDomainMappingPath,
            originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }
        }
      ]
    });

    new s3deploy.BucketDeployment(this, name('deploy-with-invalidation'), {
      sources: [ s3deploy.Source.asset("./src/frontend/dist") ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*']
    });

    /* Remember to replace these with your own domain and change the value for custDomainCertArn and custDomainCertArn
       values in the package.json that gets passed as context variables  */
    const apiGwDomain = new apigateway.DomainName(this, name('cust-domain'), {
      domainName: custDomainName,
      certificate: cert.Certificate.fromCertificateArn(this, name('cust-domain-cert'), custDomainCertArn),
      endpointType: apigateway.EndpointType.EDGE,
      securityPolicy: apigateway.SecurityPolicy.TLS_1_2
    });
    apiGwDomain.addBasePathMapping(api, { basePath: customDomainMappingPath, stage: api.deploymentStage});

    /* TODO: After deployment copy the API Gateway domain name from the AWS console of the Custom domain name
     *  and create a cname record that points to `custDomainName`   */

    new cdk.CfnOutput(this, name("output-apigw-endpoint"), { value: api.url + "/" + apiStageName });
    new cdk.CfnOutput(this, name("output-apigw-custom-domain-endpoint"), { value: apiGwDomain.domainName + "/" + customDomainMappingPath });
    new cdk.CfnOutput(this, name("output-cloudfront-endpoint"), { value: distribution.distributionDomainName });
  }
}