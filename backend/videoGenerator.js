const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Ensure outputs directory exists
const OUTPUT_DIR = path.join(__dirname, 'public', 'outputs');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function generateVideo(text, voiceModel, taskId, onProgress) {
    const sessionDir = path.join(TEMP_DIR, taskId);
    fs.mkdirSync(sessionDir);

    try {
        onProgress('Analizando texto y escenas...', 5);
        const segments = text.split(/[.!?]+/).filter(s => s.trim().length > 0).map(s => s.trim());

        onProgress('Generando audio (Google TTS)...', 20);
        const audioPath = path.join(sessionDir, 'narration.wav');
        
        // Support longer texts by splitting into chunks (200 chars limit for standard Google TTS)
        const results = googleTTS.getAllAudioUrls(text, {
            lang: 'es',
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: '.,!? ',
        });

        // Download and concat all audio buffers
        const audioBuffers = [];
        for (const res of results) {
            console.log(`Downloading audio chunk from Google...`);
            const audioChunk = await axios.get(res.url, { responseType: 'arraybuffer' });
            if (audioChunk.data) {
                audioBuffers.push(Buffer.from(audioChunk.data));
            }
        }
        
        const finalAudioBuffer = Buffer.concat(audioBuffers);
        console.log(`Audio generated. Total size: ${finalAudioBuffer.length} bytes`);
        
        if (finalAudioBuffer.length < 100) {
            throw new Error("El audio generado es demasiado pequeño o está corrupto.");
        }
        
        fs.writeFileSync(audioPath, finalAudioBuffer);

        onProgress('Generando imágenes (Pollinations.ai)...', 40);
        const imagePaths = [];
        
        for (let i = 0; i < segments.length; i++) {
            onProgress(`Generando escena ${i + 1}/${segments.length}...`, 40 + (i / segments.length) * 30);
            const imgPath = path.join(sessionDir, `img_${i}.jpg`);
            
            // Pollinations.ai URL-based generation
            const prompt = encodeURIComponent(segments[i] + ", vertical cinematic, high detail, colorful, 4k");
            const pollUrl = `https://pollinations.ai/p/${prompt}?width=1080&height=1920&seed=${Math.floor(Math.random() * 100000)}&nologo=true`;
            
            console.log(`Requesting image ${i}: ${pollUrl}`);
            const imgRes = await axios.get(pollUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
            imagePaths.push(imgPath);
        }

        onProgress('Calculando duración...', 75);
        const duration = await getAudioDuration(audioPath);
        const segmentDuration = duration / segments.length;
        console.log(`Total duration: ${duration}s, per segment: ${segmentDuration}s`);

        onProgress('Ensamblando video final (FFmpeg)...', 85);
        const outputFilename = `video_${taskId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        await assembleVideo(imagePaths, audioPath, outputPath, segmentDuration);

        onProgress('¡Video completado con éxito!', 100);
        return `/outputs/${outputFilename}`;

    } catch (error) {
        console.error('Error detallado en generateVideo:', error);
        throw error;
    }
}

function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) return reject(new Error(`Fallo al analizar audio: ${err.message}`));
            resolve(metadata.format.duration || 0);
        });
    });
}

function assembleVideo(imagePaths, audioPath, outputPath, segmentDuration) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();

        // 1. Add all images
        imagePaths.forEach((img) => {
            command.input(img).inputOptions(['-loop 1']).inputOptions([`-t ${segmentDuration}`]);
        });

        // 2. Add audio
        command.input(audioPath);

        const audioIndex = imagePaths.length;
        console.log(`FFmpeg Assembly Started: ${imagePaths.length} images, audio at index ${audioIndex}`);

        // 3. Build robust filter complex
        const filterStr = [];
        
        // Scale each image and label it
        imagePaths.forEach((_, i) => {
            filterStr.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v${i}]`);
        });

        // Concat video streams if more than 1 image
        if (imagePaths.length > 1) {
            const videoInputs = imagePaths.map((_, i) => `[v${i}]`).join('');
            filterStr.push(`${videoInputs}concat=n=${imagePaths.length}:v=1:a=0[vout]`);
        } else {
            filterStr.push(`[v0]null[vout]`);
        }

        // Label the audio stream explicitly to avoid index errors
        filterStr.push(`[${audioIndex}:a]anull[aout]`);

        command
            .complexFilter(filterStr.join('; '))
            .map('[vout]')
            .map('[aout]')
            .videoCodec('libx264')
            .audioCodec('aac')
            .addOptions([
                '-pix_fmt yuv420p',
                '-shortest',
                '-y'
            ])
            .on('start', (cmd) => console.log('FFmpeg command:', cmd))
            .on('end', () => resolve())
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg Error:', err.message);
                console.error('FFmpeg stderr:', stderr);
                reject(err);
            })
            .save(outputPath);
    });
}

module.exports = { generateVideo };
