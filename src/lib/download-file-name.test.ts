import { downloadFileName } from './download-file-name';
it.each(['提单.png', '提单.pdf'])('prefers UTF-8 filename with extension: %s', (name) => {
  expect(downloadFileName(`attachment; filename="png"; filename*=UTF-8''${encodeURIComponent(name)}`, 'BL.pdf')).toBe(name);
});
it('handles plain, malformed and path-like names without throwing', () => {
  expect(downloadFileName('attachment; filename="test.pdf"', 'BL.pdf')).toBe('test.pdf');
  expect(downloadFileName("attachment; filename*=UTF-8''%ZZ", 'BL.pdf')).toBe('BL.pdf');
  expect(downloadFileName('attachment; filename="../../test.pdf"', 'BL.pdf')).toBe('__.._test.pdf');
});
