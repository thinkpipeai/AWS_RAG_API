import { S3Client } from '@aws-sdk/client-s3';
import { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from '@aws-sdk/client-textract';

const s3 = new S3Client({ region: 'us-east-2' });
const textract = new TextractClient({ region: 'us-east-2' });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

  try {
    const startResponse = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } }
      })
    );
    const jobId = startResponse.JobId;
    console.log(`Started Textract job with ID: ${jobId}`);

    // 2. Poll the job status
    let jobStatus = 'IN_PROGRESS';
    let pages = [];

    while (jobStatus === 'IN_PROGRESS') {
      console.log('Waiting for Textract job to complete...');
      await sleep(5000); 

      const getResponse = await textract.send(
        new GetDocumentTextDetectionCommand({ JobId: jobId })
      );

      jobStatus = getResponse.JobStatus;
      console.log(`Current Textract Job Status: ${jobStatus}`);

      if (jobStatus === 'SUCCEEDED') {
        pages.push(...getResponse.Blocks);
        // Next Step: Handle multi-page pagination using NextToken
      } else if (jobStatus === 'FAILED') {
        throw new Error('Textract job failed.');
      }
    }
  } catch (err) {
    console.error('Processing failures:', err);
    throw err;
  }
};
