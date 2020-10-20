exports.handler = async (event, context) =>
{
    return {
        statusCode: 200,
        body: JSON.stringify(event),
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*"
        },
        isBase64Encoded: false
    };
};
