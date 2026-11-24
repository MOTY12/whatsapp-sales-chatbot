export async function extractPdfPagesFromBytes(
  input: Uint8Array,
): Promise<string[]> {
  if (input.byteLength > 10 * 1024 * 1024) throw new Error('EXTRACTION_LIMIT');
  if (Buffer.from(input).subarray(0, 5).toString('ascii') !== '%PDF-')
    throw new Error('INVALID_PDF');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const document = await loadingTask.promise;
  try {
    if (document.numPages < 1 || document.numPages > 100)
      throw new Error('EXTRACTION_LIMIT');
    const pages: string[] = [];
    let total = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const extracted = content.items
        .map((item) =>
          'str' in item && typeof item.str === 'string' ? item.str : '',
        )
        .join('');
      const text = [...extracted]
        .filter((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code >= 32 && !(code >= 127 && code <= 159);
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 50000) throw new Error('EXTRACTION_LIMIT');
      total += text.length;
      if (total > 500000) throw new Error('EXTRACTION_LIMIT');
      pages.push(text);
      page.cleanup();
    }
    if (pages.some((page) => page.trim().length < 10))
      throw new Error('NO_EXTRACTABLE_TEXT');
    return pages;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'PasswordException'
    ) {
      throw new Error('ENCRYPTED_PDF');
    }
    if (
      error instanceof Error &&
      ['ENCRYPTED_PDF', 'EXTRACTION_LIMIT', 'NO_EXTRACTABLE_TEXT'].includes(
        error.message,
      )
    ) {
      throw error;
    }
    throw new Error('INVALID_PDF');
  } finally {
    await loadingTask.destroy();
  }
}
