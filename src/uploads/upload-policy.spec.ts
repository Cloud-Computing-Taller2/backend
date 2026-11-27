import {
  buildObjectKey,
  fileTooLarge,
  isId,
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

  it('arma la clave users/{userId}/folders/{folderId}/{uuid}-{nombre}', () => {
    expect(buildObjectKey('1', '2', 'abc', 'Foto de Año Nuevo.jpg')).toBe(
      'users/1/folders/2/abc-Foto_de_Ano_Nuevo.jpg',
    );
  });

  it('valida ids numéricos', () => {
    expect(isId('42')).toBe(true);
    expect(isId('0')).toBe(false);
    expect(isId('-1')).toBe(false);
    expect(isId("1' OR '1'='1")).toBe(false);
  });

  it('informa el límite en MB', () => {
    expect(fileTooLarge(500 * 1024 * 1024).getResponse()).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'El archivo supera el máximo de 500 MB',
    });
  });
});
