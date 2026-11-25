# Componentes de terceros

| Componente | Uso en LaFe Tool | Licencia |
|---|---|---|
| [ExifCleaner](https://github.com/szTheory/exifcleaner) (szTheory) | Método de limpieza de metadatos: argumentos de ExifTool replicados en `src-tauri/src/exifcleaner.rs` | MIT |
| [ExifTool](https://exiftool.org) 13.59 (Phil Harvey) | Motor de ExifCleaner, incluido en el instalador | Licencia de Perl (Artistic / GPL) |
| [FFmpeg](https://ffmpeg.org) (build GPL de [BtbN](https://github.com/BtbN/FFmpeg-Builds)) | Render, previsualización y análisis de audio | GPL v3 |
| [meSpeak.js](https://www.masswerk.at/mespeak/) (N. Landsteiner) / eSpeak | Voz robótica (`public/mespeak`) | GPL v3 |
| [edge-tts](https://github.com/rany2/edge-tts) | Voces neuronales de Microsoft Edge | LGPL v3 |
| [fontTools](https://github.com/fonttools/fonttools), [Pillow](https://python-pillow.org) | Métricas de fuentes | MIT / HPND |
| [Tauri](https://tauri.app), [React](https://react.dev) | Aplicación de escritorio e interfaz | MIT / Apache-2.0 |
| Fuentes Anton, Bebas Neue, Cousine, Gelasio, Poppins | Subtítulos | SIL Open Font License 1.1 (ver `src-tauri/resources/fonts/OFL-*.txt`) |
