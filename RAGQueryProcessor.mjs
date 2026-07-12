import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';

const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const osClient = new Client({
  node: 'https://search-hoam-ai-index-ynuioqz3gdynci5i222hxdtbia.us-east-2.es.amazonaws.com',
  auth: { username: 'admin', password: 'CS120@cs120' }
});

// Generate query vector
async function generateEmbedding(text) {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text  // Make sure the key names match exactly
      })
    })
  );
  return JSON.parse(Buffer.from(response.body).toString()).embedding;
}

export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  let query;
  try {
    const body = JSON.parse(event.body || '{}');
    query = body.query;
    console.log('Query:', query);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  if (!query) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'query' parameter" })
    };
  }

  try {
    // 1. Generate query vector
    const queryEmbedding = await generateEmbedding(query);

    // 2. Retrieving Relevant Document Blocks in OpenSearch
    const osResponse = await osClient.search({
      index: 'hoam-ai-index',
      body: {
        size: 5,
        query: {
          knn: {
            embedding: {
              vector: queryEmbedding,
              k: 5
            }
          }
        }
      }
    });

    const top5Texts = osResponse.body.hits.hits.map(hit => hit._source.text);
    const combinedText = top5Texts.join('###');

    // const temp = 'context1.........................###context2.....................###context3......###context4...................................................................###context5.......................';

    return {
      statusCode: 200,
      body: JSON.stringify({ results: combinedText })

    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
