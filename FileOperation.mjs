import { S3Client, PutObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize the S3 client
const s3Client = new S3Client();
const BUCKET = "cs120-project4";
const PREFIX = "raw-docs/";
const EXTRACTED_TEXT_PREFIX = "extracted-text/";
const URL_EXPIRATION = 3600;

export const handler = async (event, context) => {
  const action = event.params?.querystring?.action || "upload";
  const headers = event.headers || {};
  const filename = headers.filename || "default_name.pdf";
  const s3Key = `${PREFIX}${filename}`;

  // Check if the file is a text file
  const isTextFile = filename.toLowerCase().endsWith('.txt');

  try {
    switch (action) {
      case "upload":
        const fileContent = event["body-json"];
        const decodedContent = Buffer.from(fileContent, 'base64');

        // Check if the file size exceeds 5MB (5 * 1024 * 1024 bytes)
        const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
        if (decodedContent.length > MAX_FILE_SIZE) {
          return {
            statusCode: 413, // Payload Too Large
            body: JSON.stringify({
              error: "File size exceeds limit",
              message: `File size (${(decodedContent.length / (1024 * 1024)).toFixed(2)}MB) exceeds the maximum allowed size (5MB)`
            })
          };
        }

        // Upload to raw-docs directory
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: s3Key,
          Body: decodedContent
        }));

        // If it's a text file, also upload to extracted-text directory
        if (isTextFile) {
          const extractedKey = `${EXTRACTED_TEXT_PREFIX}${filename}`;
          await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: extractedKey,
            Body: decodedContent
          }));

          return {
            statusCode: 200,
            body: JSON.stringify(`${filename} uploaded successfully to both raw-docs and extracted-text!`)
          };
        }

        return {
          statusCode: 200,
          body: JSON.stringify(`${filename} uploaded successfully!`)
        };

      case "list":
        const listResponse = await s3Client.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: PREFIX
        }));

        // Create pre-signed URLs for each file
        const filesWithUrls = await Promise.all((listResponse.Contents || []).map(async (obj) => {
          const fileName = obj.Key.replace(PREFIX, '');
          const getCommand = new GetObjectCommand({
            Bucket: BUCKET,
            Key: obj.Key
          });

          // Generate pre-signed URLs
          const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: URL_EXPIRATION });

          return {
            filename: fileName,
            size: obj.Size,
            lastModified: obj.LastModified,
            downloadUrl: presignedUrl
          };
        }));

        return {
          statusCode: 200,
          body: JSON.stringify(filesWithUrls)
        };

      case "delete":
        try {
          // Check if file exists
          await s3Client.send(new HeadObjectCommand({
            Bucket: BUCKET,
            Key: s3Key
          }));
        } catch (err) {
          if (err.$metadata?.httpStatusCode === 404) {
            return {
              statusCode: 404,
              body: JSON.stringify(`File '${filename}' not found`)
            };
          } else {
            return {
              statusCode: 500,
              body: JSON.stringify(`Error checking file: ${err.message}`)
            };
          }
        }

        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: s3Key
        }));

        return {
          statusCode: 200,
          body: JSON.stringify(`${filename} deleted successfully!`)
        };

      case "download":
        try {
          const getResponse = await s3Client.send(new GetObjectCommand({
            Bucket: BUCKET,
            Key: s3Key
          }));

          // Convert the readable stream to a buffer
          const streamToBuffer = async (stream) => {
            const chunks = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            return Buffer.concat(chunks);
          };

          const buffer = await streamToBuffer(getResponse.Body);
          const encoded = buffer.toString('base64');

          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="${filename}"`
            },
            isBase64Encoded: true,
            body: encoded
          };
        } catch (err) {
          if (err.$metadata?.httpStatusCode === 404) {
            return {
              statusCode: 404,
              body: JSON.stringify("File not found")
            };
          } else {
            return {
              statusCode: 500,
              body: JSON.stringify(`Error downloading file: ${err.message}`)
            };
          }
        }

      default:
        return {
          statusCode: 400,
          body: JSON.stringify("Invalid action")
        };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify(`Error: ${err.message}`)
    };
  }
};
