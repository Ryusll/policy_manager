import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

const pdfBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${pdfBase}pdf.worker.mjs`;

async function extractFromPdf(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const chunks: string[] = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? String(item.str) : ''))
      .filter(Boolean)
      .join(' ');
    chunks.push(text);
  }
  return chunks.join('\n');
}

async function extractFromDocx(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return String(result.value || '');
}

export async function extractPolicyText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.txt') || type === 'text/plain') {
    return await file.text();
  }
  if (
    name.endsWith('.docx') ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return await extractFromDocx(file);
  }
  if (name.endsWith('.pdf') || type === 'application/pdf') {
    return await extractFromPdf(file);
  }
  throw new Error('지원하지 않는 형식입니다. txt, docx, pdf 파일만 가져올 수 있습니다.');
}

