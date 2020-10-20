var aws4 = require('aws4');

module.exports = {
    doRequests: function(cloudFrontDomain, cloudFrontApiProxyPath, cloudFrontCustDomainProxyPath,
                         apiGwDomain, apiGwStagePath, apiGwCustDomain, apiGwCustMapping, accessKeyId, secretAccessKey, sessionToken)
    {
        const region = "us-east-1";

        async function request(url, resource, method, body, headers = {})
        {
            let requestUrl = `${url}${resource}`;

            console.log("Fetch options:", {
                url: requestUrl,
                method: method,
                headers: headers,
                body: body
            });

            let response = await fetch(requestUrl, {
                method: method,
                headers: headers,
                body: body
            });

            console.log(response);
        }

        /**
         *
         * @param url
         * @param resource
         * @param method
         * @param body
         * @param headers
         * @param signHost This is the API GW domain name |OR| the Custom Domain
         * @param signHostPath If signHost is the API GW then this is the Stage. If signHost is a Custom Domain then this is the Mapping path.
         * @returns {Promise<void>}
         */
        async function signedRequest(url, resource, method, body, headers = {}, { signHost, signHostPath })
        {
            let requestUrl = `${url}${resource}`;

            const opts = {
                host: signHost,
                path: `${signHostPath}${resource}`,
                method: method,
                headers: headers,
                url:`https://${signHost}`,
                region: region,
                service: "execute-api"
            };

            if (body !== null)
                opts.body = body;

            /* Create the signed request object */
            const signedRequest = aws4.sign(opts, { accessKeyId, secretAccessKey, sessionToken });

            console.log("Signing options:", signedRequest);
            console.log("Fetch options:", {
                url: requestUrl,
                method: method,
                headers: signedRequest.headers,
                body: body
            });

            /* Add the signed headers to the request */
            let response = await fetch(requestUrl, {
                method: method,
                headers: signedRequest.headers,
                body: body
            });

            console.log(response);
        }

        let url = `https://${cloudFrontDomain}`;

        /* Use the proxy path to the API GW */
        request(url, `/${cloudFrontApiProxyPath}/no-auth`, "GET");
        request(url, `/${cloudFrontApiProxyPath}/auth`, "GET", null, { "Authorization": "allow" });
        signedRequest(url, `/${cloudFrontApiProxyPath}/auth-iam`, "GET", null, { },
                        {
                            signHost: apiGwDomain,
                            signHostPath: apiGwStagePath,
                        });


        /* Use the proxy path to the the Custom Domain */
        request(url, `/${cloudFrontCustDomainProxyPath}/no-auth`, "GET");
        request(url, `/${cloudFrontCustDomainProxyPath}/auth`, "GET", null, { "Authorization": "allow" });
        signedRequest(url, `/${cloudFrontCustDomainProxyPath}/auth-iam`, "GET", null, { },
                        {
                            signHost: apiGwCustDomain,
                            signHostPath: apiGwCustMapping,
                        });
    }
}



