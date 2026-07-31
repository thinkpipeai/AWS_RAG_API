import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';

const s3 = new S3Client({ region: 'us-east-2' });
const bedrock = new BedrockRuntimeClient({ region: 'us-east-2' });
const osClient = new Client({
  node: 'https://search-hoam-ai-index-ynuioqz3gdynci5i222hxdtbia.us-east-2.es.amazonaws.com',
  auth: { username: 'admin', password: 'CS120@cs120' }
});

async function legalDocumentSplitting(text) {
  // 1. standardize formatting, remove redundant whitespace
  const cleanedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const articlePattern = /\b(ARTICLE|Article|SECTION|Section)\s+([IVX0-9]+|[0-9]+\.?[0-9]*)\s*\.?\s*[-—]?\s*([^\n]+)/g;

  // 2. Find all chapter markers
  const sections = [];
  let match;
  while ((match = articlePattern.exec(cleanedText)) !== null) {
    sections.push({
      type: match[1],
      number: match[2],
      title: match[3],
      position: match.index
    });
  }

  // Sort by location
  sections.sort((a, b) => a.position - b.position);

  // 3. Chapter-based chunking
  const chunks = [];

  // If no obvious chapter structure is found, use an alternate strategy
  if (sections.length === 0) {
    // Alternate strategy: use paragraph or numeric list items as separators
    const paragraphMatches = cleanedText.split(/\n\n+/);
    let currentChunk = "";

    for (const paragraph of paragraphMatches) {
      // If adding this paragraph would make the block too big, save the current block first.
      if (currentChunk.length + paragraph.length > 800) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = "";
        }

        // If a single paragraph is too long, split it further
        if (paragraph.length > 1000) {
          // Try to split at sentence boundaries
          const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
          let sentenceChunk = "";

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length > 800) {
              if (sentenceChunk.length > 0) {
                chunks.push(sentenceChunk);
                sentenceChunk = "";
              }
              if (sentence.length > 800) {
                // Extremely long sentences, add directly
                chunks.push(sentence);
              } else {
                sentenceChunk = sentence;
              }
            } else {
              sentenceChunk += sentence;
            }
          }

          if (sentenceChunk.length > 0) {
            chunks.push(sentenceChunk);
          }
        } else {
          // Normal length paragraphs, add directly
          chunks.push(paragraph);
        }
      } else {
        // Accumulate to current block
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }

    // Adding the final block
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
  } else {
    // Chunking using the recognized chapter structure
    for (let i = 0; i < sections.length; i++) {
      const currentSection = sections[i];
      const nextSection = i < sections.length - 1 ? sections[i + 1] : null;

      // Calculate the starting and ending positions of chapter content
      const contentStart = currentSection.position + currentSection.type.length +
        currentSection.number.length + currentSection.title.length + 3; // +3 for spaces
      const contentEnd = nextSection ? nextSection.position : cleanedText.length;

      // Extract chapter titles and content
      const sectionHeader = cleanedText.substring(currentSection.position, contentStart);
      let sectionContent = cleanedText.substring(contentStart, contentEnd).trim();

      // Construct full chapter text
      const fullSectionText = `${sectionHeader}\n${sectionContent}`;

      // Check chapter size
      if (fullSectionText.length <= 1000) {
        // Smaller chapters as separate blocks
        chunks.push(fullSectionText);
      } else {
        // Chapters are large and need to be split further, but keep the chapter titles 
        // Start by adding a lead block with a title and short content
        const introSize = Math.min(300, sectionContent.length);
        const introText = sectionContent.substring(0, introSize);
        chunks.push(`${sectionHeader}\n${introText}...`);

        // Then split the rest of the content into multiple chunks, each with contextual references
        const remainingContent = sectionContent.substring(introSize);
        const contextHeader = `${currentSection.type} ${currentSection.number} - ${currentSection.title} (continued)`;

        // Split by paragraph
        const contentParagraphs = remainingContent.split(/\n\n+/);
        let currentChunk = "";

        for (const para of contentParagraphs) {
          if (currentChunk.length + para.length > 700) {
            if (currentChunk.length > 0) {
              chunks.push(`${contextHeader}\n${currentChunk}`);
              currentChunk = "";
            }

            if (para.length > 800) {
              // Further segmentation by sentence
              const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
              let sentenceChunk = "";

              for (const sentence of sentences) {
                if (sentenceChunk.length + sentence.length > 700) {
                  if (sentenceChunk.length > 0) {
                    chunks.push(`${contextHeader}\n${sentenceChunk}`);
                    sentenceChunk = "";
                  }
                  if (sentence.length > 800) {
                    chunks.push(`${contextHeader}\n${sentence}`);
                  } else {
                    sentenceChunk = sentence;
                  }
                } else {
                  sentenceChunk += sentence;
                }
              }

              if (sentenceChunk.length > 0) {
                chunks.push(`${contextHeader}\n${sentenceChunk}`);
              }
            } else {
              chunks.push(`${contextHeader}\n${para}`);
            }
          } else {
            currentChunk += (currentChunk ? "\n\n" : "") + para;
          }
        }

        if (currentChunk.length > 0) {
          chunks.push(`${contextHeader}\n${currentChunk}`);
        }
      }
    }
  }

  // 4. Post-processing: merge too-small chunks and make sure each has enough context
  const finalChunks = [];
  let currentMergedChunk = "";

  for (const chunk of chunks) {
    if (currentMergedChunk.length + chunk.length + 1 <= 900) {
      // Can be merged
      currentMergedChunk += (currentMergedChunk ? "\n\n" : "") + chunk;
    } else {
      // Can't merge, save the current block and start a new one.
      if (currentMergedChunk.length > 0) {
        finalChunks.push(currentMergedChunk);
      }

      if (chunk.length > 900) {
        // A single block is already large, just add the
        finalChunks.push(chunk);
        currentMergedChunk = "";
      } else {
        currentMergedChunk = chunk;
      }
    }
  }

  // Add the last merge block
  if (currentMergedChunk.length > 0) {
    finalChunks.push(currentMergedChunk);
  }

  return finalChunks;
}

// Generate embedding vectors
async function generateEmbedding(text) {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: text })
    })
  );
  const result = JSON.parse(Buffer.from(response.body).toString());
  return result.embedding;
}

export const handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

  try {
    // Read OCR text file
    const s3Response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await s3Response.Body.transformToString();
    // console.log("!!!!!!!text: ", text);

    const chunks = await legalDocumentSplitting(text);
    const documentId = key.split('/').pop().replace('.txt', ''); // Extract Document ID

    console.log(`Created ${chunks.length} legal document chunks`);

    // Processing each block
    for (let i = 0; i < chunks.length; i++) {
      console.log("!!!!!!!chunks:", chunks[i]);
      const embedding = await generateEmbedding(chunks[i]);
      console.log("!!!!!!!embedding: ", embedding);
      // Write to OpenSearch
      await osClient.index({
        index: 'hoam-ai-index',
        body: {
          text: chunks[i],
          embedding,
          document_id: documentId,
          chunk_id: i
        }
      });
    }

    console.log(`Successfully processed ${chunks.length} blocks`);
  } catch (err) {
    console.error('Processing failures:', err);
    throw err;
  }
};
