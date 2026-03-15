# AI Video Narrator - Setup Instructions

Esta aplicación transforma texto en un video vertical narrado con imágenes generadas por IA utilizando la API de **Hugging Face**.

## Requisitos Previos

Debes tener instalados los siguientes programas en tu sistema Windows:

1.  **Node.js (v18 o superior)**
    *   Descárgalo en: [nodejs.org](https://nodejs.org/)
    *   Verifica con: `node -v` y `npm -v`

2.  **FFmpeg**
    *   Descárgalo en: [ffmpeg.org](https://ffmpeg.org/download.html) o usa `choco install ffmpeg` si tienes Chocolatey.
    *   **IMPORTANTE**: Asegúrate de que FFmpeg esté en tu variable de entorno PATH.
    *   Verifica con: `ffmpeg -version`

## Configuración

### 1. Backend
Navega a la carpeta `backend/` y realiza lo siguiente:
1.  Instala las dependencias:
    ```bash
    npm install
    ```
2.  El archivo `.env` ya fue creado con tu API Key de Hugging Face.
3.  Inicia el servidor:
    ```bash
    npm start
    ```
    El servidor correrá en `http://localhost:5000`.

### 2. Frontend
Navega a la carpeta `frontend/` y realiza lo siguiente:
1.  Instala las dependencias:
    ```bash
    npm install
    ```
2.  Inicia la aplicación de React:
    ```bash
    npm run dev
    ```
    La aplicación estará disponible en `http://localhost:3000`.

## Uso
1.  Abre `http://localhost:3000` en tu navegador.
2.  Escribe un texto (guion) para tu video.
3.  Selecciona la voz deseada.
4.  Haz clic en **"Generar Video"**.
5.  Espera a que el progreso llegue al 100%. Las imágenes y el audio tardarán unos segundos dependiendo de la longitud del texto.
6.  Previsualiza y descarga tu video.

## Despliegue en Vercel
Para desplegar el frontend en Vercel:
1.  Sube el código a un repositorio de GitHub.
2.  Conecta tu repo a Vercel.
3.  **Nota**: El backend requiere un servidor con FFmpeg instalado. Puedes usar una instancia de EC2, Render, o Railway que soporte FFmpeg para el backend.
