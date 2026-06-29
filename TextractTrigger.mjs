import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

        let nextToken = getResponse.NextToken;
        while (nextToken) {
          const nextPage = await textract.send(
            new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken })
          );
          pages.push(...nextPage.Blocks);
          nextToken = nextPage.NextToken;
        }
      } else if (jobStatus === 'FAILED') {
        throw new Error('Textract job failed.');
      }
    }

    const text = pages
      .filter(block => block.BlockType === 'LINE')
      .map(line => line.Text)
      .join('\n');
    console.log('Extracted text:', text);

    // 4. Save the result to extracted-text/
    const outputKey = key.replace('raw-docs/', 'extracted-text/').replace(/\.[^/.]+$/, '.txt');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: text,
      })
    );

    console.log('OCR Done, results have been saved to.', outputKey);
  } catch (err) {
    console.error('Processing failures:', err);
    throw err;
  }
};
