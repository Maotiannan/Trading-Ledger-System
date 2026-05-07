import { getSystemSettings } from '@/lib/system-settings';
import { recognizeSwift, recognizeSwiftPdf } from '@/lib/ocr';

jest.mock('@/lib/system-settings', () => ({
  getSystemSettings: jest.fn(),
}));

const mockGetSystemSettings = getSystemSettings as jest.Mock;

describe('ocr provider request building', () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetSystemSettings.mockResolvedValue({
      OCR_DISABLED: 'false',
      OCR_API_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      OCR_API_KEY: 'test-key',
      OCR_MODEL: 'glm-4.6v',
      OCR_MAX_RETRIES: '1',
      OCR_TIMEOUT_MS: '10000',
      OCR_RETRY_BASE_DELAY_MS: '100',
      OCR_INPUT_COST_PER_1K: '0',
      OCR_OUTPUT_COST_PER_1K: '0',
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                amount: 30040,
                date: '2026-05-06',
                senderName: 'SUPER DT2',
                senderAddress: 'CONAKRY',
                receiverName: 'MARKET UNION CO LTD',
                receiverAccount: '1234567890',
              }),
            },
          },
        ],
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it('sends remote PDF OCR URLs as file_url content blocks', async () => {
    const pdfUrl = 'https://cdn.example.com/swift.pdf';

    await recognizeSwift(pdfUrl);

    const [, request] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    const content = body.messages[0].content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      { type: 'file_url', file_url: { url: pdfUrl } },
    ]));
    expect(content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url' }),
    ]));
  });

  it('extracts multi-page PDF text with BigModel parser sync before SWIFT JSON extraction', async () => {
    const pdfBytes = Buffer.from('%PDF-1.5\n1 0 obj\n<<>>\nendobj\n');
    const file = new File([pdfBytes], 'swift.pdf', { type: 'application/pdf' });
    (global.fetch as jest.Mock).mockImplementation(async (url: string, request: RequestInit) => {
      if (url.endsWith('/files/parser/sync')) {
        expect(request.method).toBe('POST');
        expect(request.headers).toEqual(expect.objectContaining({
          Authorization: 'Bearer test-key',
        }));
        expect(request.body).toBeInstanceOf(FormData);
        const formData = request.body as FormData;
        expect(formData.get('tool_type')).toBe('prime-sync');
        expect(formData.get('file_type')).toBe('PDF');
        expect(formData.has('file')).toBe(true);
        return {
          ok: true,
          json: async () => ({
            status: 'succeeded',
            content: [
              'Message Header',
              'Amount: 30040 Currency: USD Value Date: 06/05/26',
              'Message Text',
              ':32A:260506USD30040,',
              ':50K:/123',
              'SUPER DT2',
              'CONAKRY',
              ':59:/76881488000007249',
              'MARKET UNION CO LTD',
            ].join('\n'),
          }),
          text: async () => '',
        };
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  amount: 30040,
                  date: '2026-05-06',
                  senderName: 'SUPER DT2',
                  senderAddress: 'CONAKRY',
                  receiverName: 'MARKET UNION CO LTD',
                  receiverAccount: '76881488000007249',
                }),
              },
            },
          ],
        }),
        text: async () => '',
      };
    });

    const result = await recognizeSwiftPdf(file);

    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
      'https://open.bigmodel.cn/api/paas/v4/files/parser/sync',
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    ]);
    const [, chatRequest] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    const chatBody = JSON.parse(String(chatRequest.body));
    expect(chatBody.messages[0].content).toContain('SUPER DT2');
    expect(chatBody.messages[0].content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image_url' }),
      expect.objectContaining({ type: 'file_url' }),
    ]));
    expect(result).toEqual({
      amount: 30040,
      date: '2026-05-06',
      senderName: 'SUPER DT2',
      senderAddress: 'CONAKRY',
      receiverName: 'MARKET UNION CO LTD',
      receiverAccount: '76881488000007249',
    });
  });

  it('repairs model JSON when a string value contains raw line breaks', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                '```json',
                '{',
                '  "amount": "30040",',
                '  "date": "2026-05-06",',
                '  "senderName": "ETS MAMADOU DIALLO",',
                '  "senderAddress": "MADINA C/MATAM',
                'CONAKRY',
                'REPUBLIQUE DE GUINEE",',
                '  "receiverName": "MARKET UNION CO LTD",',
                '  "receiverAccount": "76881488000007249"',
                '}',
                '```',
              ].join('\n'),
            },
          },
        ],
      }),
      text: async () => '',
    });

    const result = await recognizeSwift('data:image/jpeg;base64,abc');

    expect(result.senderAddress).toBe('MADINA C/MATAM CONAKRY REPUBLIQUE DE GUINEE');
  });
});
