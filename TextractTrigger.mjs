import { S3Client } from '@aws-sdk/client-s3';
import { TextractClient, StartDocumentTextDetectionCommand } from '@aws-sdk/client-textract';

const s3 = new S3Client({ region: 'us-east-2' });
const textract = new TextractClient({ region: 'us-east-2' });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

  try {
    // 1. Start asynchronous document text detection
    const startResponse = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
      })
    );

    const jobId = startResponse.JobId;
    console.log(`Started Textract job with ID: ${jobId}`);
    
    // Next Step: Poll job status
  } catch (err) {
    console.error('Processing failures:', err);
    throw err;
  }
};
