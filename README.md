<p align="center">
  <img src="app-icon.png" width="96" alt="LaFe Tool">
</p>

<h1 align="center">LaFe Tool</h1>

<p align="center">
  Subtítulos estilo cartel para Premiere Pro, videos lip-sync (PNGtuber) y limpieza de metadatos con ExifCleaner.<br>
  Aplicación de escritorio nativa para Windows (Tauri v2 · Rust · React + TypeScript).
</p>

<p align="center">
  <a href="https://github.com/intidie/LaFe-tool/releases/latest/download/LaFe-Tool-Setup.exe">
    <img alt="Descargar LaFe Tool para Windows" src="https://img.shields.io/badge/Descargar%20LaFe%20Tool-Windows%20.exe-00008B?style=for-the-badge&logo=windows11&logoColor=white" height="52">
  </a>
</p>

<p align="center">
  <a href="https://github.com/intidie/LaFe-tool/actions/workflows/release.yml"><img alt="Build" src="https://github.com/intidie/LaFe-tool/actions/workflows/release.yml/badge.svg"></a>
  <a href="https://github.com/intidie/LaFe-tool/releases/latest"><img alt="Versión" src="https://img.shields.io/github/v/release/intidie/LaFe-tool?label=versi%C3%B3n"></a>
</p>

## Instalación

1. Pulsa **Descargar LaFe Tool** (descarga solo `LaFe-Tool-Setup.exe`, no el repositorio).
2. Ábrelo y sigue el asistente. Se instala para tu usuario, sin permisos de administrador.
3. Se crea el acceso directo **LaFe Tool** en el Escritorio y en el menú Inicio.

Todo va incluido en el instalador: el motor de render, FFmpeg y ExifTool. No hace falta instalar Python, Node.js
ni nada más. Si Windows muestra *SmartScreen*: **Más información → Ejecutar de todos modos** (el instalador no está
firmado). Para actualizar, descarga e instala la versión nueva: tus ajustes y tus fuentes se conservan.

## Qué hace

**Subtítulos estilo cartel.** Escribe o carga el guion, elige una voz (Edge TTS, voces de Windows o robótica con meSpeak) y genera un
video con subtítulos palabra por palabra sobre pantalla azul oscura (`#00008B`), listo para **Ultra Key** en
Premiere Pro.
- Vista previa en tiempo real, cuadro a cuadro, y reproducción de las animaciones.
- Animaciones de entrada y salida, movimiento continuo, mosaico solo sobre el subtítulo, estilo cartel, estilo meme,
  granulado, resaltado de la palabra activa y valores de *Transformar* de Premiere.
- **Subir fuentes** desde un `.zip` (o `.ttf`/`.otf`): quedan instaladas en la app para siempre. En *Ajustes →
  Carpeta de fuentes propias* puedes elegir una carpeta (por ejemplo tu colección Stamp RSPK) que se importa en cada arranque.
- *Transformar* (escala, tracking, interlineado y posición) también funciona en los estilos cartel y meme.
- La **última configuración** se guarda sola y se restaura al abrir.
- Exporta en **H.264/MP4**, **ProRes 422 HQ** o **DNxHR HQ**, todos compatibles con Premiere Pro (BT.709, fps
  constante, audio a 48 kHz, GOP corto para navegar fluido en la línea de tiempo).

**Voces de Windows (SAPI 5).** Todas las voces SAPI instaladas en el equipo aparecen como «Windows · …», de 64 y de
32 bits, con tiempos exactos por palabra. Así se usan voces clásicas como **Loquendo** si las tienes instaladas en
Windows (LaFe Tool no las incluye: son software comercial con su propia licencia).

**Lip-sync (PNGtuber).** Alterna imágenes «hablando» y «silencio» según el audio (propio o generado con la voz).

**ExifCleaner.** Cada archivo exportado pasa por la limpieza de metadatos de
[ExifCleaner](https://github.com/szTheory/exifcleaner): los mismos argumentos de ExifTool (`-all=` más el borrado de
las fechas de QuickTime) con el mismo ExifTool 13.59. Se puede desactivar en *Ajustes*. La pestaña **ExifCleaner**
limpia cualquier video, audio o imagen que arrastres a la ventana y muestra cuántas etiquetas había antes y después.

## Arquitectura

```
LaFe-tool/
├─ src/                 Interfaz: React + TypeScript (Vite)
├─ src-tauri/           Backend en Rust (Tauri v2)
│  ├─ src/engine.rs        proceso del motor de render (JSON por stdin/stdout, progreso como eventos)
│  ├─ src/exifcleaner.rs   ExifCleaner: argumentos de ExifTool idénticos a los de szTheory/exifcleaner
│  ├─ src/fonts.rs         instalación de fuentes desde .zip/.ttf/.otf
│  ├─ src/paths.rs         carpetas de la app, fuentes y PATH de FFmpeg
│  └─ src/lib.rs           comandos de Tauri, ajustes persistentes
├─ engine/              Motor de render (subtítulos ASS + FFmpeg/libass, TTS, lip-sync), empaquetado con PyInstaller
├─ public/mespeak/      meSpeak.js: la voz robótica se sintetiza en un Web Worker (sin Node.js)
└─ scripts/prepare-resources.ps1   descarga FFmpeg y ExifTool y compila el motor
```

El backend en Rust gestiona la ventana, los archivos, los ajustes, las fuentes, ExifCleaner y el ciclo de vida del
motor de render, que corre como proceso hijo persistente (las previsualizaciones no esperan a un render largo y al
cerrar la app se detiene todo, incluidos los FFmpeg en marcha).

## Desarrollo

Requisitos: Node.js 20+, Rust (MSVC), Python 3.10+.

```powershell
npm install
python -m pip install -r engine/requirements.txt
./scripts/prepare-resources.ps1 -Skip engine   # FFmpeg y ExifTool (en desarrollo el motor corre con Python)
npm run tauri dev
```

Compilar el instalador: `./scripts/prepare-resources.ps1` y luego `npm run tauri build`. Cada push a `main`
compila y publica `LaFe-Tool-Setup.exe` en [Releases](https://github.com/intidie/LaFe-tool/releases) con GitHub Actions.

## Licencias

Código de LaFe Tool: MIT. Componentes incluidos: ExifCleaner (MIT, método de limpieza), ExifTool (Phil Harvey, licencia
de Perl), FFmpeg (GPL, build de BtbN), meSpeak.js (GPL) y fuentes con licencia OFL. Ver
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). La fuente «Stamp RSPK» no se distribuye (su licencia lo prohíbe): impórtala desde tu propia copia.
