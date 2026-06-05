import { saveUploadedFile, UploadValidationError } from '@/lib/upload';

describe('upload generic file validation', () => {
  it('rejects binary content disguised as a txt file', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x13, 0x37]);
    const file = {
      name: 'payload.txt',
      type: 'text/plain',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    } as File;

    await expect(saveUploadedFile(file)).rejects.toBeInstanceOf(UploadValidationError);
  });
});
