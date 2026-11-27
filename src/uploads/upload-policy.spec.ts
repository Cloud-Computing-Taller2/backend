import {
  buildObjectKey,
  fileTooLarge,
  isUuid,
  mimeTypeFor,
  sanitizeFileName,
} from './upload-policy';

describe('upload-policy', () => {
  it.each([
    ['foto.PNG', 'image/png'],
    ['foto.jpeg', 'image/jpeg'],
    ['camara.raw', 'image/x-raw'],
    ['clase.mp4', 'video/mp4'],
    ['audio.mp3', 'audio/mpeg'],
    [
      'informe.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'slides.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    ['tarea.pdf', 'application/pdf'],
  ])('acepta %s', (name, mime) => {
    expect(mimeTypeFor(name)).toBe(mime);
  });

  it.each(['virus.exe', 'script.sh', 'sinextension', '.png', 'archivo.'])(
    'rechaza %s',
    (name) => {
      expect(mimeTypeFor(name)).toBeNull();
    },
  );

  it('limpia rutas y caracteres de control del nombre', () => {
    expect(sanitizeFileName('C:\\Users\\ana\\foto.png')).toBe('foto.png');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('  a\u0000b.pdf  ')).toBe('ab.pdf');
    expect(sanitizeFileName('..')).toBeNull();
    expect(sanitizeFileName('')).toBeNull();
    expect(sanitizeFileName('x'.repeat(300) + '.pdf')).toBeNull();
  });

  it('la clave del bucket no depende del nombre (renombrar no mueve el objeto)', () => {
    expect(buildObjectKey('u1', 'f1')).toBe('users/u1/f1');
  });

  it('valida UUID', () => {
    expect(isUuid('0b9f8a54-3c2e-4d1a-9e6f-7a8b9c0d1e2f')).toBe(true);
    expect(isUuid("1' OR '1'='1")).toBe(false);
  });

  it('informa el límite en MB', () => {
    expect(fileTooLarge(500 * 1024 * 1024).getResponse()).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'El archivo supera el máximo de 500 MB',
    });
  });
});
