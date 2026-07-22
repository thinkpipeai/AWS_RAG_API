import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-2' });

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
  console.log(`Found ${sections.length} sections`);

  return [cleanedText.substring(0, 500)]; // Temporary return for testing
}

export const handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

  try {
    const s3Response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await s3Response.Body.transformToString();

    const chunks = await legalDocumentSplitting(text);
    console.log(`Created ${chunks.length} test chunks`);
  } catch (err) {
    console.error('Processing failures:', err);
    throw err;
  }
};

async function legalDocumentSplitting(text) {
  const cleanedText = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const articlePattern = /\b(ARTICLE|Article|SECTION|Section)\s+([IVX0-9]+|[0-9]+\.?[0-9]*)\s*\.?\s*[-—]?\s*([^\n]+)/g;

  const sections = [];
  let match;
  while ((match = articlePattern.exec(cleanedText)) !== null) {
    sections.push({ type: match[1], number: match[2], title: match[3], position: match.index });
  }
  sections.sort((a, b) => a.position - b.position);

  // 3. Chapter-based chunking
  const chunks = [];

  // If no obvious chapter structure is found, use an alternate strategy
  if (sections.length === 0) {
    const paragraphMatches = cleanedText.split(/\n\n+/);
    let currentChunk = "";

    for (const paragraph of paragraphMatches) {
      if (currentChunk.length + paragraph.length > 800) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = "";
        }

        if (paragraph.length > 1000) {
          const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
          let sentenceChunk = "";

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length > 800) {
              if (sentenceChunk.length > 0) {
                chunks.push(sentenceChunk);
                sentenceChunk = "";
              }
              if (sentence.length > 800) chunks.push(sentence);
              else sentenceChunk = sentence;
            } else {
              sentenceChunk += sentence;
            }
          }
          if (sentenceChunk.length > 0) chunks.push(sentenceChunk);
        } else {
          chunks.push(paragraph);
        }
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);
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
        // TODO: Handle splitting of large chapters with contextual headers
      }
    }
  }

  return chunks;
}
