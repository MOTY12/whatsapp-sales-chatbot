import { extractPdfPagesFromBytes } from './pdf-extractor';

type ChildInput = { pdf?: Buffer | Uint8Array };

process.on('message', (message: ChildInput) => {
  void extract(message);
});

async function extract(message: ChildInput): Promise<void> {
  try {
    if (!message.pdf) throw new Error('EXTRACTION_LIMIT');
    const pages = await extractPdfPagesFromBytes(message.pdf);
    process.send?.({ pages });
  } catch (error) {
    const code =
      error instanceof Error &&
      ['ENCRYPTED_PDF', 'EXTRACTION_LIMIT', 'NO_EXTRACTABLE_TEXT'].includes(
        error.message,
      )
        ? error.message
        : 'INVALID_PDF';
    process.send?.({ error: code });
  } finally {
    process.disconnect?.();
  }
}
